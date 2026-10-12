-- Direct, atomic correction of the medication card's two physical balances.
-- Quantities remain consumption units; historic batch and clinical prices remain
-- unchanged. Apply after warehouse v5 and the medication-deletion v7 migration.
begin;
set local lock_timeout='10s';

create or replace function private.crm_stock_totals_v18(p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();request_row private.warehouse_requests%rowtype;
 medication_row public.medications%rowtype;medication_id_value uuid;
 reserve_target numeric;work_target numeric;reserve_expected numeric;work_expected numeric;
 reserve_before numeric;work_before numeric;package_price numeric;expiry_value date;
 reserve_difference numeric;work_difference numeric;move_quantity numeric;
 expiry_text text;reason_value text;location_value text;remaining_delta numeric;
 batch_row record;batch_available numeric;take_quantity numeric;result_value jsonb;
 before_value jsonb;after_value jsonb;
begin
 -- Current database membership is checked on every call, including a replay.
 if actor is null or not exists(select 1 from public.staff s
  where s.auth_user_id=actor and s.active and s.role in ('owner','admin')) then
  raise exception 'Изменять остатки может только администратор или владелец' using errcode='42501';
 end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then
  raise exception 'Проверьте данные остатков' using errcode='22023';
 end if;
 if p_payload-array['id','expected_reserve','expected_work','reserve','work','expiry_date','purchase_price','reason']<>'{}'::jsonb then
  raise exception 'Неизвестные параметры остатков' using errcode='22023';
 end if;

 -- Claim the outer request before any medication locks. Concurrent retries wait
 -- for the first transaction, then return its receipt before checking old CAS.
 insert into private.warehouse_requests(id,staff_user,action,payload)
  values(p_request_id,actor,'v18_stock_totals',p_payload) on conflict do nothing;
 select r.* into request_row from private.warehouse_requests r where r.id=p_request_id for update;
 if request_row.staff_user is distinct from actor
  or request_row.action is distinct from 'v18_stock_totals'
  or request_row.payload is distinct from p_payload then
  raise exception 'Номер операции уже используется для другого сохранения' using errcode='22023';
 end if;
 if request_row.result is not null then return request_row.result;end if;

 begin
  medication_id_value:=nullif(p_payload->>'id','')::uuid;
  reserve_target:=(p_payload->>'reserve')::numeric;
  work_target:=(p_payload->>'work')::numeric;
  reserve_expected:=(p_payload->>'expected_reserve')::numeric;
  work_expected:=(p_payload->>'expected_work')::numeric;
 exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Количество: целое число от нуля. Обновите карточку, если данные устарели' using errcode='22023';
 end;
 if reserve_target is null or work_target is null
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
 reason_value:=coalesce(nullif(trim(p_payload->>'reason'),''),'Пересчёт фактического остатка');
 if length(reason_value)>1000 then
  raise exception 'Комментарий: не более 1000 символов' using errcode='22023';
 end if;

 -- Existing warehouse helpers lock the medication, FEFO batches, then stock.
 -- Retain that order, locking both locations before verifying either target.
 select m.* into medication_row from public.medications m
  where m.id=medication_id_value and m.active for update;
 if not found or exists(select 1 from private.crm_deleted_medications_v7 d
  where d.medication_id=medication_id_value) then
  raise exception 'Препарат недоступен';
 end if;
 perform b.id from public.medication_batches b where b.medication_id=medication_id_value
  order by b.expiry_date nulls last,b.received_date,b.id for update;
 perform s.medication_id from public.stock s where s.medication_id=medication_id_value
  order by s.location for update;
 perform private.assert_stock_v3(medication_id_value);
 select coalesce(sum(s.quantity) filter(where s.location='reserve'),0),
  coalesce(sum(s.quantity) filter(where s.location='work'),0)
  into reserve_before,work_before from public.stock s where s.medication_id=medication_id_value;
 if reserve_before is distinct from reserve_expected or work_before is distinct from work_expected then
  raise exception 'Остаток уже изменился. Обновите карточку и проверьте количество' using errcode='40001';
 end if;
 before_value:=jsonb_build_object('id',medication_id_value,'reserve_qty',reserve_before,
  'work_qty',work_before,'total_qty',reserve_before+work_before);

 reserve_difference:=reserve_target-reserve_before;
 work_difference:=work_target-work_before;
 -- Only a net increase introduces additional units. Opposite location changes
 -- are paired as real movements first, keeping the original batch/cost/expiry.
 if reserve_target+work_target>reserve_before+work_before then
  expiry_text:=nullif(trim(p_payload->>'expiry_date'),'');
  if expiry_text is null or expiry_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   raise exception 'Для добавляемого количества укажите действующий срок годности' using errcode='22023';
  end if;
  begin expiry_value:=expiry_text::date;
  exception when datetime_field_overflow or invalid_datetime_format then
   raise exception 'Проверьте срок годности: такой даты нет в календаре' using errcode='22023';
  end;
  if expiry_value<(now() at time zone 'Europe/Moscow')::date then
   raise exception 'Для добавляемого количества укажите действующий срок годности' using errcode='22023';
  end if;
  begin
   package_price:=coalesce((p_payload->>'purchase_price')::numeric,medication_row.purchase_price,0);
  exception when invalid_text_representation or numeric_value_out_of_range then
   raise exception 'Проверьте закупочную цену упаковки' using errcode='22023';
  end;
  if package_price<0 or package_price::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Проверьте закупочную цену упаковки' using errcode='22023';
  end if;
 end if;

 if reserve_difference<0 and work_difference>0 then
  move_quantity:=least(-reserve_difference,work_difference);
  perform private.warehouse_v5('transfer',jsonb_build_object('id',medication_id_value,
   'quantity',move_quantity,'comment',reason_value),gen_random_uuid());
  reserve_difference:=reserve_difference+move_quantity;
  work_difference:=work_difference-move_quantity;
 elsif reserve_difference>0 and work_difference<0 then
  move_quantity:=least(reserve_difference,-work_difference);
  perform private.warehouse_v5('return',jsonb_build_object('id',medication_id_value,
   'quantity',move_quantity,'comment',reason_value),gen_random_uuid());
  reserve_difference:=reserve_difference-move_quantity;
  work_difference:=work_difference+move_quantity;
 end if;

 foreach location_value in array array['reserve','work'] loop
  remaining_delta:=case when location_value='reserve' then reserve_difference else work_difference end;
  if remaining_delta<0 then
   remaining_delta:=-remaining_delta;
   -- Expired or unknown batches can be reduced too. Their expiry and cost are
   -- retained; existing v5 correction records actor, quantity and location.
   for batch_row in select b.* from public.medication_batches b
    where b.medication_id=medication_id_value
     and case when location_value='work' then b.work_quantity else b.quantity_remaining-b.work_quantity end>0
    order by b.expiry_date nulls last,b.received_date,b.id for update
   loop
    exit when remaining_delta=0;
    batch_available:=case when location_value='work' then batch_row.work_quantity
     else batch_row.quantity_remaining-batch_row.work_quantity end;
    take_quantity:=least(remaining_delta,batch_available);
    perform private.warehouse_v5('inventory',jsonb_build_object('id',medication_id_value,
     'batch_id',batch_row.id,'location',location_value,'actual_quantity',batch_available-take_quantity,
     'reason',reason_value),gen_random_uuid());
    remaining_delta:=remaining_delta-take_quantity;
   end loop;
   if remaining_delta<>0 then raise exception 'Остатки и партии не совпадают. Обновите карточку';end if;
  elsif remaining_delta>0 then
   perform private.warehouse_v5('opening',jsonb_build_object('id',medication_id_value,
    'quantity',remaining_delta,'location',location_value,'expiry',expiry_value,
    'price',package_price,'comment',reason_value),gen_random_uuid());
  end if;
 end loop;

 perform private.assert_stock_v3(medication_id_value);
 -- Reuse the current inventory builder so the UI receives the same fields as
 -- its list, including usable quantities and nearest expiry after corrections.
 select row_value.value into result_value from jsonb_array_elements(private.warehouse_v5('list')) row_value
  where row_value.value->>'id'=medication_id_value::text;
 if result_value is null then raise exception 'Не удалось обновить карточку препарата';end if;
 result_value:=result_value||jsonb_build_object('total_qty',reserve_target+work_target);
 if (result_value->>'reserve_qty')::numeric is distinct from reserve_target
  or (result_value->>'work_qty')::numeric is distinct from work_target then
  raise exception 'Остатки и партии не совпадают. Требуется сверка склада';
 end if;
 if reserve_target<>reserve_before or work_target<>work_before then
  after_value:=jsonb_build_object('request_id',p_request_id,'id',medication_id_value,
   'reserve_qty',reserve_target,'work_qty',work_target,'total_qty',reserve_target+work_target,
   'reserve_difference',reserve_target-reserve_before,'work_difference',work_target-work_before);
  perform private.crm_audit_v5('stock_totals_corrected','medications',medication_id_value::text,
   before_value,after_value,reason_value);
 end if;
 update private.warehouse_requests r set result=result_value where r.id=p_request_id;
 return result_value;
end $$;
revoke all on function private.crm_stock_totals_v18(jsonb,uuid) from public,anon;
grant execute on function private.crm_stock_totals_v18(jsonb,uuid) to authenticated;

create or replace function public.crm_stock_totals_v18(p_payload jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.crm_stock_totals_v18(p_payload,p_request_id);
$$;
revoke all on function public.crm_stock_totals_v18(jsonb,uuid) from public,anon;
grant execute on function public.crm_stock_totals_v18(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
