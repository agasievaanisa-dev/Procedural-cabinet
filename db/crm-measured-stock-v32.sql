-- Owner stock operations must retain exact milligram balances after measured
-- treatments. Apply after crm-measured-quantity-v31.sql. Package sizes/counts
-- stay whole; all existing permissions, FEFO, audit and request checks remain.
begin;
set local lock_timeout='10s';

do $migration$
begin
 if to_regprocedure('private.crm_valid_quantity_v31(uuid,numeric,boolean)') is null then
  raise exception 'v32: apply measured quantity v31 first';
 end if;
end $migration$;

-- Patch only the released integer gates, preserving every function's original
-- OID, owner and ACL. Stop on an unexpected source; never replace a live wrapper
-- with an older complete implementation. The v28 list wrapper stays untouched.
do $migration$
declare patch record;source_n text;old_count integer;new_count integer;
 original_oid oid;original_acl aclitem[];original_owner oid;
begin
 for patch in select * from(values
  ('private.warehouse_v2(text,jsonb,uuid)',2,
   $old$v_qty is null or v_qty<=0 or v_qty<>trunc(v_qty) or v_qty::text in ('NaN','Infinity','-Infinity')$old$,
   $new$not private.crm_valid_quantity_v31(v_id,v_qty)$new$),
  ('private.warehouse_v2(text,jsonb,uuid)',2,
   $old$raise exception 'Введите целое положительное число единиц';$old$,
   $new$raise exception 'Количество препарата: больше нуля; для мг — до трёх знаков после запятой, для остальных единиц — целое число';$new$),
  ('private.warehouse_v5_before_v28(text,jsonb,uuid)',1,
   $old$if actual is null or actual<0 or actual<>trunc(actual) or actual::text in ('NaN','Infinity','-Infinity') then raise exception 'Фактический остаток: целое число от нуля';end if;$old$,
   $new$if not private.crm_valid_quantity_v31(med_id,actual,true) then raise exception 'Фактический остаток: от нуля; для мг — до трёх знаков после запятой, для остальных единиц — целое число';end if;$new$),
  ('private.crm_stock_correction_v6(text,jsonb,uuid)',1,
   $old$if v_actual is null or v_actual<0 or v_actual<>trunc(v_actual)
     or v_actual::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Фактический остаток: целое число от нуля';
  end if;$old$,
   $new$if not private.crm_valid_quantity_v31(v_id,v_actual,true) then
   raise exception 'Фактический остаток: от нуля; для мг — до трёх знаков после запятой, для остальных единиц — целое число';
  end if;$new$),
  ('private.crm_stock_correction_v6(text,jsonb,uuid)',1,
   $old$if v_expected is null or v_expected<0 or v_expected<>trunc(v_expected)
     or v_expected::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Обновите остатки перед корректировкой';
  end if;$old$,
   $new$if not private.crm_valid_quantity_v31(v_id,v_expected,true) then
   raise exception 'Обновите остатки перед корректировкой';
  end if;$new$),
  ('private.crm_stock_totals_v18(jsonb,uuid)',1,
   $old$raise exception 'Количество: целое число от нуля. Обновите карточку, если данные устарели'$old$,
   $new$raise exception 'Проверьте количество и обновите карточку, если данные устарели'$new$),
  ('private.crm_stock_totals_v18(jsonb,uuid)',1,
   $old$ if reserve_target is null or work_target is null
  or reserve_target<0 or work_target<0
  or reserve_target<>trunc(reserve_target) or work_target<>trunc(work_target)
  or reserve_target::text in ('NaN','Infinity','-Infinity') or work_target::text in ('NaN','Infinity','-Infinity') then
  raise exception 'Количество в запасе и в работе: целое число от нуля' using errcode='22023';
 end if;
 if reserve_expected is null or work_expected is null
  or reserve_expected<0 or work_expected<0
  or reserve_expected<>trunc(reserve_expected) or work_expected<>trunc(work_expected)
  or reserve_expected::text in ('NaN','Infinity','-Infinity') or work_expected::text in ('NaN','Infinity','-Infinity') then
  raise exception 'Обновите карточку препарата перед изменением остатка' using errcode='22023';
 end if;
$old$,
   $new$ -- v32: quantity/unit validation follows the medication row lock below.
$new$),
  ('private.crm_stock_totals_v18(jsonb,uuid)',1,
   $old$  raise exception 'Препарат недоступен';
 end if;
 perform b.id from public.medication_batches b where b.medication_id=medication_id_value
  order by b.expiry_date nulls last,b.received_date,b.id for update;$old$,
   $new$  raise exception 'Препарат недоступен';
 end if;
 -- Unit changes use the same medication lock. Validate targets and CAS
 -- expectations now, so an earlier unlocked unit lookup cannot race a save.
 if not private.crm_valid_quantity_v31(medication_id_value,reserve_target,true)
  or not private.crm_valid_quantity_v31(medication_id_value,work_target,true) then
  raise exception 'Количество в запасе и в работе: от нуля; для мг — до трёх знаков после запятой, для остальных единиц — целое число' using errcode='22023';
 end if;
 if not private.crm_valid_quantity_v31(medication_id_value,reserve_expected,true)
  or not private.crm_valid_quantity_v31(medication_id_value,work_expected,true) then
  raise exception 'Обновите карточку препарата перед изменением остатка' using errcode='22023';
 end if;
 perform b.id from public.medication_batches b where b.medication_id=medication_id_value
  order by b.expiry_date nulls last,b.received_date,b.id for update;$new$),
  ('private.crm_medication_delete_v7(text,jsonb,uuid)',1,
   $old$if v_expected_reserve is null or v_expected_reserve<0 or v_expected_reserve<>trunc(v_expected_reserve)
     or v_expected_reserve::text in ('NaN','Infinity','-Infinity')
     or v_expected_work is null or v_expected_work<0 or v_expected_work<>trunc(v_expected_work)
     or v_expected_work::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Обновите остатки перед удалением';
  end if;$old$,
   $new$if not private.crm_valid_quantity_v31(v_id,v_expected_reserve,true)
     or not private.crm_valid_quantity_v31(v_id,v_expected_work,true) then
   raise exception 'Обновите остатки перед удалением';
  end if;$new$)
 ) as changes(signature,expected_count,old_fragment,new_fragment) loop
  original_oid:=to_regprocedure(patch.signature);
  if original_oid is null then raise exception 'v32: missing released function %',patch.signature;end if;
  select proacl,proowner into original_acl,original_owner from pg_proc where oid=original_oid;
  source_n:=pg_get_functiondef(original_oid);
  old_count:=(length(source_n)-length(replace(source_n,patch.old_fragment,'')))/length(patch.old_fragment);
  new_count:=(length(source_n)-length(replace(source_n,patch.new_fragment,'')))/length(patch.new_fragment);
  if old_count=0 and new_count=patch.expected_count then continue;end if;
  if old_count<>patch.expected_count or new_count<>0 then
   raise exception 'v32: expected % released checks in %, found % old/% new',patch.expected_count,patch.signature,old_count,new_count;
  end if;
  execute replace(source_n,patch.old_fragment,patch.new_fragment);
  if to_regprocedure(patch.signature)::oid is distinct from original_oid
   or (select proacl from pg_proc where oid=original_oid) is distinct from original_acl
   or (select proowner from pg_proc where oid=original_oid) is distinct from original_owner then
   raise exception 'v32: function identity, owner or grants changed for %',patch.signature;
  end if;
 end loop;
end $migration$;

-- Deleted-card history records the exact balances removed. Row constraints
-- retain finite, nonnegative precision; the trigger also retains whole units
-- for ordinary medications, using the server's unit rather than client input.
alter table private.crm_deleted_medications_v7
 drop constraint crm_deleted_medications_v7_reserve_removed_check,
 drop constraint crm_deleted_medications_v7_work_removed_check,
 add constraint crm_deleted_medications_v7_reserve_removed_check check(
  reserve_removed>=0 and reserve_removed::text not in ('NaN','Infinity','-Infinity') and reserve_removed=round(reserve_removed,3)),
 add constraint crm_deleted_medications_v7_work_removed_check check(
  work_removed>=0 and work_removed::text not in ('NaN','Infinity','-Infinity') and work_removed=round(work_removed,3));

create or replace function private.crm_tombstone_quantity_guard_v32()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not private.crm_valid_quantity_v31(new.medication_id,new.reserve_removed,true)
  or not private.crm_valid_quantity_v31(new.medication_id,new.work_removed,true) then
  raise exception 'Проверьте единицу расхода и остатки удаляемого препарата' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function private.crm_tombstone_quantity_guard_v32() from public,anon,authenticated;
drop trigger if exists crm_tombstone_quantity_guard_v32 on private.crm_deleted_medications_v7;
create trigger crm_tombstone_quantity_guard_v32
 before insert or update of medication_id,reserve_removed,work_removed on private.crm_deleted_medications_v7
 for each row execute function private.crm_tombstone_quantity_guard_v32();

notify pgrst,'reload schema';
commit;
