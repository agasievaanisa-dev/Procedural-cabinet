-- Owner corrections for mistyped package size and counted batch balances.
-- Additive: quantities stay in the existing consumption unit. A package-size
-- correction never rewrites existing batch costs, balances or clinical history.
-- Apply after the CRM v5 management / warehouse migrations.

create or replace function private.crm_stock_correction_v6(
 p_action text,p_payload jsonb default '{}'::jsonb,p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_request private.warehouse_requests%rowtype;
 v_med public.medications%rowtype;
 v_batch public.medication_batches%rowtype;
 v_id uuid;
 v_batch_id uuid;
 v_action text;
 v_reason text;
 v_location text;
 v_actual numeric;
 v_expected numeric;
 v_before numeric;
 v_result jsonb;
begin
 if auth.uid() is null or not private.is_manager() then
  raise exception 'Корректировка доступна только владельцу';
 end if;
 if p_action is null or p_action not in ('package','inventory') then
  raise exception 'Неизвестная корректировка';
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then
  raise exception 'Проверьте данные корректировки';
 end if;
 if p_request_id is null then raise exception 'Нужен номер операции';end if;

 -- Claim the request BEFORE the medication lock. Concurrent retries wait here,
 -- then return the saved result before checking the now-outdated expectations.
 -- Inventory uses the existing v5 request contract for the delegated mutation.
 v_action:=case p_action when 'package' then 'v6_package' else 'v5_inventory' end;
 insert into private.warehouse_requests(id,staff_user,action,payload)
  values(p_request_id,auth.uid(),v_action,p_payload) on conflict do nothing;
 select * into v_request from private.warehouse_requests where id=p_request_id for update;
 if v_request.staff_user is distinct from auth.uid()
    or v_request.action is distinct from v_action
    or v_request.payload is distinct from p_payload then
  raise exception 'Номер операции уже используется';
 end if;
 if v_request.result is not null then return v_request.result;end if;

 v_reason:=nullif(trim(p_payload->>'reason'),'');
 if v_reason is null then raise exception 'Укажите причину корректировки';end if;
 if length(v_reason)>1000 then raise exception 'Причина: не более 1000 символов';end if;
 v_id:=nullif(p_payload->>'id','')::uuid;
 select * into v_med from public.medications where id=v_id and active for update;
 if not found then raise exception 'Препарат недоступен';end if;
 perform private.assert_stock_v3(v_id);

 if p_action='package' then
  v_actual:=(p_payload->>'units_per_package')::numeric;
  v_expected:=(p_payload->>'expected_units_per_package')::numeric;
  if v_actual is null or v_actual<1 or v_actual<>trunc(v_actual)
     or v_actual::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Единиц в упаковке: целое число от 1';
  end if;
  if v_expected is null or v_expected<1 or v_expected<>trunc(v_expected)
     or v_expected::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Обновите карточку препарата перед корректировкой';
  end if;
  if v_med.units_per_package is distinct from v_expected then
   raise exception 'Размер упаковки уже изменился. Обновите карточку и проверьте данные';
  end if;
  v_before:=v_med.units_per_package;
  if v_actual<>v_before then
   update public.medications set units_per_package=v_actual where id=v_id;
   perform private.crm_audit_v5('package_corrected','medications',v_id::text,
    jsonb_build_object('units_per_package',v_before),
    jsonb_build_object('units_per_package',v_actual,'request_id',p_request_id),v_reason);
  end if;
  v_result:=jsonb_build_object('id',v_id,'before',v_before,
   'units_per_package',v_actual,'difference',v_actual-v_before);
  update private.warehouse_requests set result=v_result where id=p_request_id;
 else
  v_batch_id:=nullif(p_payload->>'batch_id','')::uuid;
  v_location:=p_payload->>'location';
  v_actual:=(p_payload->>'actual_quantity')::numeric;
  v_expected:=(p_payload->>'expected_quantity')::numeric;
  if v_location is null or v_location not in ('reserve','work') then
   raise exception 'Выберите место хранения';
  end if;
  if v_actual is null or v_actual<0 or v_actual<>trunc(v_actual)
     or v_actual::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Фактический остаток: целое число от нуля';
  end if;
  if v_expected is null or v_expected<0 or v_expected<>trunc(v_expected)
     or v_expected::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Обновите остатки перед корректировкой';
  end if;
  select * into v_batch from public.medication_batches
   where id=v_batch_id and medication_id=v_id for update;
  if not found then raise exception 'Партия не найдена';end if;
  v_before:=case when v_location='work' then v_batch.work_quantity
   else v_batch.quantity_remaining-v_batch.work_quantity end;
  if v_before is distinct from v_expected then
   raise exception 'Остаток уже изменился. Обновите карточку и повторно пересчитайте препарат';
  end if;
  -- Keep the v5 mutation and its stock movement / actor audit as the one source
  -- of inventory accounting. Locks are held until this whole request commits.
  v_result:=private.warehouse_v5('inventory',p_payload,p_request_id);
 end if;

 perform private.assert_stock_v3(v_id);
 return v_result;
end $$;
revoke all on function private.crm_stock_correction_v6(text,jsonb,uuid) from public,anon;
grant execute on function private.crm_stock_correction_v6(text,jsonb,uuid) to authenticated;

create or replace function public.crm_stock_correction_v6(
 p_action text,p_payload jsonb default '{}'::jsonb,p_request_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
 select private.crm_stock_correction_v6(p_action,p_payload,p_request_id);
$$;
revoke all on function public.crm_stock_correction_v6(text,jsonb,uuid) from public,anon;
grant execute on function public.crm_stock_correction_v6(text,jsonb,uuid) to authenticated;

notify pgrst,'reload schema';
