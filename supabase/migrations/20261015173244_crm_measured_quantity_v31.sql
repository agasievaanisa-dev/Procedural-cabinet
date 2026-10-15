-- Milligrams support measured quantities; every other consumption unit remains
-- whole. Existing treatments, prices, stock and medication metadata are unchanged.
begin;
set local lock_timeout='10s';

create or replace function private.crm_valid_quantity_v31(
 p_med uuid,p_qty numeric,p_allow_zero boolean default false
) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.medications m
  where m.id=p_med
   and p_qty is not null
   and p_qty::text not in ('NaN','Infinity','-Infinity')
   and p_qty>=0 and (coalesce(p_allow_zero,false) or p_qty>0)
   and p_qty=round(p_qty,3)
   and (m.consumption_unit='мг' or p_qty=trunc(p_qty))
 );
$$;
revoke all on function private.crm_valid_quantity_v31(uuid,numeric,boolean) from public,anon,authenticated;

-- Patch the released functions in place. CREATE OR REPLACE preserves their
-- OIDs, ownership and grants; reject unexpected source rather than replacing
-- financial, idempotency, dose, permission or FEFO logic with an older version.
do $migration$
declare patch record;source_n text;old_count integer;new_count integer;
 original_oid oid;original_acl aclitem[];
begin
 for patch in select * from(values
  ('private.crm_prepare_treatment_v10(text,jsonb,jsonb)',
   $old$if nullif(i->>'medication_id','') is null or q is null or q<=0 or q<>trunc(q) or q>1000000 or q::text in ('NaN','Infinity','-Infinity') then raise exception 'Укажите целое количество препарата';end if;$old$,
   $new$if nullif(i->>'medication_id','') is null or not private.crm_valid_quantity_v31(nullif(i->>'medication_id','')::uuid,q) or q>1000000 then raise exception 'Количество препарата: больше нуля; для мг — до трёх знаков после запятой, для остальных единиц — целое число';end if;$new$),
  ('private.crm_prepare_treatment_v10(text,jsonb,jsonb)',
   $old$if not found then raise exception 'Препарат не найден';end if;$old$,
   $new$if not found then raise exception 'Препарат не найден';end if;
  if not private.crm_valid_quantity_v31(m.id,(i->>'quantity')::numeric) or (i->>'quantity')::numeric>1000000 then raise exception 'Количество препарата: больше нуля; для мг — до трёх знаков после запятой, для остальных единиц — целое число';end if;$new$),
  ('private.crm_management_v5(text,jsonb)',
   $old$if qty is null or qty<=0 or qty<>trunc(qty) or qty::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Количество препарата должно быть целым числом больше нуля';end if;$old$,
   $new$if not private.crm_valid_quantity_v31(item_med,qty) then
    raise exception 'Количество препарата: больше нуля; для мг — до трёх знаков после запятой, для остальных единиц — целое число';end if;$new$),
  ('private.move_stock_v3(uuid,numeric,text,text,text,text,uuid,uuid,uuid)',
   $old$if p_qty is null or p_qty<=0 or p_qty<>trunc(p_qty) or p_qty::text in ('NaN','Infinity','-Infinity') then raise exception 'Укажите целое количество единиц больше нуля';end if;$old$,
   $new$if p_qty is null or p_qty<=0 or p_qty<>round(p_qty,3) or p_qty::text in ('NaN','Infinity','-Infinity') then raise exception 'Количество препарата: больше нуля; для мг — до трёх знаков после запятой, для остальных единиц — целое число';end if;$new$),
  ('private.move_stock_v3(uuid,numeric,text,text,text,text,uuid,uuid,uuid)',
   $old$if not found then raise exception 'Препарат не найден';end if;$old$,
   $new$if not found then raise exception 'Препарат не найден';end if;
 if not private.crm_valid_quantity_v31(p_med,p_qty) then raise exception 'Количество препарата: больше нуля; для мг — до трёх знаков после запятой, для остальных единиц — целое число';end if;$new$)
 ) as changes(signature,old_fragment,new_fragment) loop
  original_oid:=to_regprocedure(patch.signature);
  if original_oid is null then raise exception 'v31: missing released function %',patch.signature;end if;
  select proacl into original_acl from pg_proc where oid=original_oid;
  source_n:=pg_get_functiondef(original_oid);
  new_count:=(length(source_n)-length(replace(source_n,patch.new_fragment,'')))/length(patch.new_fragment);
  -- An added post-lock check retains its original not-found guard. Ignore that
  -- embedded anchor when recognizing an already applied patch.
  old_count:=(length(replace(source_n,patch.new_fragment,''))-length(replace(replace(source_n,patch.new_fragment,''),patch.old_fragment,'')))/length(patch.old_fragment);
  if old_count=0 and new_count=1 then continue;end if;
  if old_count<>1 or new_count<>0 then
   raise exception 'v31: expected exactly one released check in %, found % old/% new',patch.signature,old_count,new_count;
  end if;
  execute replace(source_n,patch.old_fragment,patch.new_fragment);
  if to_regprocedure(patch.signature)::oid is distinct from original_oid
   or (select proacl from pg_proc where oid=original_oid) is distinct from original_acl then
   raise exception 'v31: function identity or grants changed for %',patch.signature;
  end if;
 end loop;
end $migration$;

-- These private accounting lines may now contain measured quantities. The
-- clinical and stock helpers enforce the medication's unit before writing them.
-- Preserve nonnegative, finite values and the precision used by exact returns;
-- retain the separate requested = deducted + pending and reason constraints.
alter table private.crm_partial_stock_lines_v28
 drop constraint crm_partial_stock_lines_v28_requested_qty_check,
 drop constraint crm_partial_stock_lines_v28_deducted_qty_check,
 drop constraint crm_partial_stock_lines_v28_pending_qty_check,
 add constraint crm_partial_stock_lines_v28_requested_qty_check check(
  requested_qty>=0 and requested_qty::text not in ('NaN','Infinity','-Infinity') and requested_qty=round(requested_qty,3)),
 add constraint crm_partial_stock_lines_v28_deducted_qty_check check(
  deducted_qty>=0 and deducted_qty::text not in ('NaN','Infinity','-Infinity') and deducted_qty=round(deducted_qty,3)),
 add constraint crm_partial_stock_lines_v28_pending_qty_check check(
  pending_qty>=0 and pending_qty::text not in ('NaN','Infinity','-Infinity') and pending_qty=round(pending_qty,3));

notify pgrst,'reload schema';
commit;
