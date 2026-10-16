-- Package receipts with an explicit size in the same retry-safe transaction.
-- Apply after v32. Existing unit balances, historical batch costs, treatments,
-- and sale prices are never converted when a package size is corrected.
begin;
set local lock_timeout='10s';

do $migration$
declare source_n text; patch record; old_count integer;new_count integer;
 original_oid oid;original_acl aclitem[];original_owner oid;
begin
 original_oid:=to_regprocedure('private.warehouse_v2(text,jsonb,uuid)');
 if original_oid is null or to_regprocedure('private.crm_valid_quantity_v31(uuid,numeric,boolean)') is null
  or to_regprocedure('private.warehouse_v5_before_v28(text,jsonb,uuid)') is null then
  raise exception 'v35: apply the released warehouse and measured stock migrations first';
 end if;
 select proacl,proowner into original_acl,original_owner from pg_proc where oid=original_oid;
 source_n:=pg_get_functiondef(original_oid);
 for patch in select * from(values
  (1,$old$  v_qty numeric; v_packs numeric; v_price numeric; v_reserve numeric;$old$,
   $new$  v_qty numeric; v_packs numeric; v_price numeric; v_reserve numeric;
  v_package_size_v35 numeric; v_package_expected_v35 numeric; v_package_before_v35 numeric;$new$),
  (1,$old$  case p_action
  when 'list' then$old$,
   $new$  -- v35: the released request claim/replay and medication lock above
  -- cover both the metadata correction and the incoming stock. Keep the
  -- original payload unchanged so the v5 wrapper stores the same receipt.
  if p_action in ('receive','opening') and
   (p_payload ? 'units_per_package' or p_payload ? 'expected_units_per_package') then
    if not v_med.active then raise exception 'Сначала восстановите препарат из архива';end if;
    v_package_size_v35:=(p_payload->>'units_per_package')::numeric;
    v_package_expected_v35:=(p_payload->>'expected_units_per_package')::numeric;
    if v_package_size_v35 is null or v_package_size_v35<1 or v_package_size_v35>999999999
     or v_package_size_v35<>trunc(v_package_size_v35)
     or v_package_size_v35::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Количество единиц в упаковке: целое число от 1 до 999999999';
    end if;
    if v_package_expected_v35 is null or v_package_expected_v35<1
     or v_package_expected_v35<>trunc(v_package_expected_v35)
     or v_package_expected_v35::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Обновите карточку препарата перед оформлением прихода';
    end if;
    if v_med.units_per_package is distinct from v_package_expected_v35 then
      raise exception 'Размер упаковки уже изменился. Обновите карточку и проверьте приход';
    end if;
    v_package_before_v35:=v_med.units_per_package;
    if v_package_size_v35 is distinct from v_package_before_v35 then
      update public.medications set units_per_package=v_package_size_v35 where id=v_id;
      perform private.crm_audit_v5('package_corrected','medications',v_id::text,
       jsonb_build_object('units_per_package',v_package_before_v35),
       jsonb_build_object('units_per_package',v_package_size_v35,'request_id',p_request_id,'receipt_action',p_action),
       'Размер упаковки уточнён при оформлении прихода');
      v_med.units_per_package:=v_package_size_v35;
    end if;
  end if;
  case p_action
  when 'list' then$new$),
  (1,$old$    v_qty:=v_packs*v_med.units_per_package;
    insert into public.medication_batches$old$,
   $new$    v_qty:=v_packs*v_med.units_per_package;
    if v_qty>999999999 or not private.crm_valid_quantity_v31(v_id,v_qty) then
      raise exception 'Проверьте количество упаковок и единиц в упаковке: приход не более 999999999 единиц';
    end if;
    insert into public.medication_batches$new$),
  (1,$old$  when 'opening' then
    if not v_med.active then raise exception 'Сначала восстановите препарат из архива'; end if;
    v_qty:=(p_payload->>'quantity')::numeric;$old$,
   $new$  when 'opening' then
    if not v_med.active then raise exception 'Сначала восстановите препарат из архива'; end if;
    v_qty:=(p_payload->>'quantity')::numeric;
    -- v35: opening balances may be supplied as whole packages as well as
    -- individual units. An explicit quantity must agree with the server's
    -- multiplication; it is never multiplied for a second time.
    if p_payload ? 'packages' then
      v_packs:=(p_payload->>'packages')::numeric;
      if v_packs is null or v_packs<=0 or v_packs<>trunc(v_packs)
       or v_packs::text in ('NaN','Infinity','-Infinity') then
        raise exception 'Введите целое положительное число упаковок';
      end if;
      if v_med.units_per_package is null or v_med.units_per_package<1 then raise exception 'Проверьте размер упаковки';end if;
      if v_packs*v_med.units_per_package>999999999 then
        raise exception 'Проверьте количество упаковок и единиц в упаковке: приход не более 999999999 единиц';
      end if;
      if p_payload ? 'quantity' and v_qty is distinct from v_packs*v_med.units_per_package then
        raise exception 'Количество единиц не совпадает с числом упаковок. Проверьте приход';
      end if;
      v_qty:=v_packs*v_med.units_per_package;
    end if;$new$)
 ) as changes(expected_count,old_fragment,new_fragment) loop
  old_count:=(length(source_n)-length(replace(source_n,patch.old_fragment,'')))/length(patch.old_fragment);
  new_count:=(length(source_n)-length(replace(source_n,patch.new_fragment,'')))/length(patch.new_fragment);
  if new_count=patch.expected_count and old_count=patch.expected_count*
   ((length(patch.new_fragment)-length(replace(patch.new_fragment,patch.old_fragment,'')))/length(patch.old_fragment)) then continue;end if;
  if old_count<>patch.expected_count or new_count<>0 then
   raise exception 'v35: unexpected released warehouse source, expected %, found % old / % new',patch.expected_count,old_count,new_count;
  end if;
  source_n:=replace(source_n,patch.old_fragment,patch.new_fragment);
 end loop;
 execute source_n;
 if to_regprocedure('private.warehouse_v2(text,jsonb,uuid)')::oid is distinct from original_oid
  or (select proacl from pg_proc where oid=original_oid) is distinct from original_acl
  or (select proowner from pg_proc where oid=original_oid) is distinct from original_owner then
  raise exception 'v35: warehouse identity, owner or grants changed';
 end if;
end $migration$;

notify pgrst,'reload schema';
commit;
