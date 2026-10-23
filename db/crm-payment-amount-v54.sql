-- Correct a mistaken amount of an existing ordinary collection. This is not
-- another collection or a refund. Installation changes no financial rows.
begin;
set local lock_timeout='10s';

create function private.crm_payment_amount_v54(p_action text,p_payload jsonb,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_user_n uuid:=auth.uid();actor_staff_n uuid;kind_n text;id_n uuid;
 event_type_n text;event_id_n uuid;version_n integer;reason_n text;pay_n jsonb;expected_n jsonb;
 req_n private.warehouse_requests%rowtype;treatment_n jsonb;before_event_n jsonb;after_event_n jsonb;answer_n jsonb;
 allocation_n private.crm_payment_allocations%rowtype;receipt_n private.crm_receipts_v10%rowtype;
 source_shift_n uuid;event_shift_n uuid;amount_n numeric;unclassified_n numeric;key_n text;number_n numeric;
 allocation_count_n bigint;initial_n numeric;receipts_n numeric;received_n numeric;new_received_n numeric;new_initial_n numeric;
 charge_n numeric;list_n numeric;pending_n boolean;remaining_status_n text;discount_reason_n text;discount_comment_n text;
 charge_changed_n boolean;
begin
 -- Authorization is live and precedes reads and committed-request replays.
 if actor_user_n is null then raise exception 'Войдите в программу' using errcode='42501';end if;
 select s.id into actor_staff_n from public.staff s where s.auth_user_id=actor_user_n
  and s.active and s.role in('owner','admin') limit 1 for share;
 if actor_staff_n is null then
  raise exception 'Сумму сохранённой оплаты исправляет администратор или владелец' using errcode='42501';
 end if;
 if p_action is null or p_action not in('get','save') or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Проверьте параметры исправления суммы оплаты' using errcode='22023';end if;
 kind_n:=p_payload->>'kind';id_n:=nullif(p_payload->>'id','')::uuid;
 if kind_n is null or kind_n not in('procedure','sale') or id_n is null then
  raise exception 'Выберите сохранённую процедуру или продажу' using errcode='22023';end if;
 if p_action='get' then
  if kind_n='procedure' and exists(select 1 from private.crm_cancelled_procedures_v51 where procedure_id=id_n) then
   raise exception 'Процедура удалена из действующих записей' using errcode='22023';end if;
  if kind_n='sale' and exists(select 1 from private.crm_cancelled_sales_v52 where sale_id=id_n) then
   raise exception 'Продажа удалена из действующих записей' using errcode='22023';end if;
  return private.crm_payment_methods_snapshot_v51(kind_n,id_n)||jsonb_build_object('amount_correction_available',true);
 end if;
 if p_request_id is null or p_payload->'confirmed' is distinct from 'true'::jsonb then
  raise exception 'Подтвердите исправление суммы уже полученной оплаты' using errcode='22023';end if;
 reason_n:=nullif(trim(p_payload->>'reason'),'');
 if reason_n is null or length(reason_n)>2000 then
  raise exception 'Укажите причину исправления суммы оплаты' using errcode='22023';end if;
 event_type_n:=p_payload->>'event_type';event_id_n:=nullif(p_payload->>'event_id','')::uuid;
 if event_type_n is null or event_type_n not in('allocation','receipt') or event_id_n is null then
  raise exception 'Выберите сохранённую оплату' using errcode='22023';end if;
 if coalesce(p_payload->>'expected_version','')!~'^[1-9][0-9]*$' then
  raise exception 'Откройте запись заново: не указана версия' using errcode='22023';end if;
 version_n:=(p_payload->>'expected_version')::integer;
 expected_n:=p_payload->'expected_payments';
 if jsonb_typeof(expected_n) is distinct from 'object' then
  raise exception 'Откройте оплату заново: не указано прежнее распределение суммы' using errcode='22023';end if;
 if not(expected_n ?& array['cash','terminal','owner_card','other_card','unclassified'])
  or exists(select 1 from jsonb_object_keys(expected_n) k where k not in('cash','terminal','owner_card','other_card','unclassified')) then
  raise exception 'Откройте оплату заново: не указано прежнее распределение суммы' using errcode='22023';end if;
 foreach key_n in array array['cash','terminal','owner_card','other_card','unclassified'] loop
  if jsonb_typeof(expected_n->key_n) not in('number','string') or expected_n->>key_n is null then
   raise exception 'Проверьте прежние суммы оплаты' using errcode='22023';end if;
  number_n:=(expected_n->>key_n)::numeric;
  if number_n<0 or number_n<>round(number_n,2) or number_n::text in('NaN','Infinity','-Infinity') or number_n>9999999999.99 then
   raise exception 'Проверьте прежние суммы оплаты' using errcode='22023';end if;
  expected_n:=jsonb_set(expected_n,array[key_n],to_jsonb(number_n));
 end loop;
 -- Omitted channels mean zero; explicitly supplied null or structured values
 -- must not be silently interpreted as an instruction to erase money.
 if jsonb_typeof(p_payload->'payments')='object' then
  foreach key_n in array array['cash','terminal','owner_card','other_card','cash_received'] loop
   if (p_payload->'payments')?key_n then
    if jsonb_typeof(p_payload->'payments'->key_n) not in('number','string')
     or nullif(trim(p_payload->'payments'->>key_n),'') is null then
     raise exception 'Проверьте суммы оплаты: укажите число вместо пустого значения' using errcode='22023';end if;
   end if;
  end loop;
 end if;
 pay_n:=private.crm_validate_payment_v10(p_payload->'payments');
 if p_payload?'charge_total' then
  if jsonb_typeof(p_payload->'charge_total') not in('number','string') or p_payload->>'charge_total' is null then
   raise exception 'Укажите окончательную стоимость' using errcode='22023';end if;
  charge_n:=(p_payload->>'charge_total')::numeric;
  if charge_n<0 or charge_n<>round(charge_n,2) or charge_n::text in('NaN','Infinity','-Infinity') or charge_n>9999999999.99 then
   raise exception 'Проверьте окончательную стоимость' using errcode='22023';end if;
 end if;
 remaining_status_n:=p_payload->>'remaining_status';
 if remaining_status_n is not null and remaining_status_n not in('pending','debt') then
  raise exception 'Укажите, ожидается оплата остатка или это долг' using errcode='22023';end if;

 insert into private.warehouse_requests(id,staff_user,action,payload)
  values(p_request_id,actor_user_n,'payment_amount_v54_save',p_payload) on conflict do nothing;
 select r.* into req_n from private.warehouse_requests r where r.id=p_request_id for update;
 if req_n.staff_user is distinct from actor_user_n or req_n.action is distinct from 'payment_amount_v54_save'
  or req_n.payload is distinct from p_payload then
  raise exception 'Номер операции уже использован' using errcode='22023';end if;
 if req_n.result is not null then return req_n.result;end if;

 -- Keep the released shift -> treatment -> payment lock order. A collection's
 -- original staff, dates and receiving shift can never move in this endpoint.
 if kind_n='procedure' then select p.shift_id into source_shift_n from public.procedures p where p.id=id_n;
 else select s.shift_id into source_shift_n from public.sales s where s.id=id_n;end if;
 if source_shift_n is null then raise exception 'Запись не найдена' using errcode='22023';end if;
 event_shift_n:=source_shift_n;
 if event_type_n='receipt' then
  select r.shift_id into event_shift_n from private.crm_receipts_v10 r where r.id=event_id_n and r.voided_at is null
   and not r.is_debt_repayment and((kind_n='procedure' and r.procedure_id=id_n)or(kind_n='sale' and r.sale_id=id_n));
  if not found then raise exception 'Обычная оплата не найдена. Погашения долга учитываются отдельно' using errcode='22023';end if;
 end if;
 perform 1 from public.shifts s where s.id in(source_shift_n,event_shift_n) order by s.id for update;
 if kind_n='procedure' then perform 1 from public.procedures p where p.id=id_n for update;
 else perform 1 from public.sales s where s.id=id_n for update;end if;
 if not found then raise exception 'Запись не найдена' using errcode='22023';end if;
 if kind_n='procedure' and exists(select 1 from private.crm_cancelled_procedures_v51 where procedure_id=id_n) then
  raise exception 'Процедура удалена из действующих записей' using errcode='22023';end if;
 if kind_n='sale' and exists(select 1 from private.crm_cancelled_sales_v52 where sale_id=id_n) then
  raise exception 'Продажа удалена из действующих записей' using errcode='22023';end if;
 treatment_n:=private.crm_treatment_snapshot_v10(kind_n,id_n);
 if(treatment_n->>'version')::integer<>version_n or(treatment_n->>'shift_id')::uuid<>source_shift_n then
  raise exception 'Запись или оплата уже изменена. Откройте её заново' using errcode='40001';end if;
 if event_type_n='allocation' then
  select count(*) into allocation_count_n from private.crm_payment_allocations a where a.voided_at is null
   and((kind_n='procedure' and a.procedure_id=id_n)or(kind_n='sale' and a.sale_id=id_n));
  if allocation_count_n<>1 then
   raise exception 'Исходное распределение оплаты неоднозначно. Нужна проверка записи' using errcode='22023';end if;
  select a.* into allocation_n from private.crm_payment_allocations a where a.id=event_id_n and a.voided_at is null
   and((kind_n='procedure' and a.procedure_id=id_n)or(kind_n='sale' and a.sale_id=id_n)) for update;
  if not found then raise exception 'Исходная оплата не найдена' using errcode='22023';end if;
  amount_n:=coalesce((treatment_n->>'initial_paid_total')::numeric,0);
  unclassified_n:=amount_n-allocation_n.cash-allocation_n.terminal-allocation_n.owner_card-allocation_n.other_card;
  if unclassified_n<0 then raise exception 'Сохранённая оплата не совпадает с исходной суммой. Нужна проверка записи' using errcode='22023';end if;
  before_event_n:=to_jsonb(allocation_n)||jsonb_build_object('unclassified',unclassified_n,'amount',amount_n);
 else
  select r.* into receipt_n from private.crm_receipts_v10 r where r.id=event_id_n and r.voided_at is null
   and not r.is_debt_repayment and((kind_n='procedure' and r.procedure_id=id_n)or(kind_n='sale' and r.sale_id=id_n)) for update;
  if not found or receipt_n.shift_id is distinct from event_shift_n then
   raise exception 'Оплата уже изменена. Откройте её заново' using errcode='40001';end if;
  amount_n:=receipt_n.cash+receipt_n.terminal+receipt_n.owner_card+receipt_n.other_card+receipt_n.unclassified_amount;
  before_event_n:=to_jsonb(receipt_n)||jsonb_build_object('unclassified',receipt_n.unclassified_amount,'amount',amount_n);
 end if;
 if amount_n<=0 then
  raise exception 'Нет полученной оплаты для исправления. Новую оплату примите через карточку' using errcode='22023';end if;
 if expected_n<>jsonb_build_object('cash',(before_event_n->>'cash')::numeric,'terminal',(before_event_n->>'terminal')::numeric,
   'owner_card',(before_event_n->>'owner_card')::numeric,'other_card',(before_event_n->>'other_card')::numeric,
   'unclassified',(before_event_n->>'unclassified')::numeric) then
  raise exception 'Оплата уже изменена. Откройте её заново' using errcode='40001';end if;

 -- Include true-debt receipts in the lifetime floor without changing their
 -- amounts, methods or the separate debt-repayment account.
 initial_n:=coalesce((treatment_n->>'initial_paid_total')::numeric,0);
 select coalesce(sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount),0) into receipts_n
  from private.crm_receipts_v10 r where r.voided_at is null
   and((kind_n='procedure' and r.procedure_id=id_n)or(kind_n='sale' and r.sale_id=id_n));
 received_n:=initial_n+receipts_n;
 new_received_n:=received_n-amount_n+(pay_n->>'total')::numeric;
 new_initial_n:=case when event_type_n='allocation' then(pay_n->>'total')::numeric else initial_n end;
 charge_n:=coalesce(charge_n,(treatment_n->>'charge_total')::numeric);
 list_n:=(treatment_n->>'list_total')::numeric;
 if new_received_n<0 or new_received_n>charge_n then
  raise exception 'После исправления полученная сумма % ₽ превышает окончательную стоимость % ₽. Проверьте обе суммы',new_received_n,charge_n using errcode='22023';end if;
 if new_received_n<charge_n and remaining_status_n is null then
  raise exception 'Осталось к оплате % ₽. Выберите ожидание оплаты или долг',charge_n-new_received_n using errcode='22023';end if;
 pending_n:=new_received_n<charge_n and remaining_status_n='pending';
 charge_changed_n:=charge_n<>(treatment_n->>'charge_total')::numeric;
 discount_reason_n:=treatment_n->>'discount_reason';discount_comment_n:=treatment_n->>'discount_comment';
 if charge_changed_n then
  if charge_n<>list_n then
   discount_reason_n:=coalesce(nullif(trim(discount_reason_n),''),'Исправление окончательной стоимости');
   discount_comment_n:=concat_ws('; ',nullif(trim(discount_comment_n),''),'Исправление: '||reason_n);
  end if;
 end if;

 if event_type_n='allocation' then
  update private.crm_payment_allocations set cash=(pay_n->>'cash')::numeric,terminal=(pay_n->>'terminal')::numeric,
   owner_card=(pay_n->>'owner_card')::numeric,other_card=(pay_n->>'other_card')::numeric,
   cash_received=(pay_n->>'cash_received')::numeric,change_amount=(pay_n->>'change')::numeric where id=event_id_n;
  select to_jsonb(a)||jsonb_build_object('amount',(pay_n->>'total')::numeric,'unclassified',0)
   into after_event_n from private.crm_payment_allocations a where a.id=event_id_n;
 elsif(pay_n->>'total')::numeric=0 then
  -- The old receipt remains positive evidence. A zero correction voids it;
  -- never weaken the receipt's positive-amount constraint for other writers.
  update private.crm_receipts_v10 set voided_at=clock_timestamp(),voided_by=actor_user_n,
   void_reason=reason_n,void_request_id=p_request_id where id=event_id_n;
  select to_jsonb(r)||jsonb_build_object('amount',0,'corrected_payments',pay_n,'unclassified',0)
   into after_event_n from private.crm_receipts_v10 r where r.id=event_id_n;
 else
  update private.crm_receipts_v10 set cash=(pay_n->>'cash')::numeric,terminal=(pay_n->>'terminal')::numeric,
   owner_card=(pay_n->>'owner_card')::numeric,other_card=(pay_n->>'other_card')::numeric,unclassified_amount=0,
   cash_received=(pay_n->>'cash_received')::numeric,change_amount=(pay_n->>'change')::numeric where id=event_id_n;
  select to_jsonb(r)||jsonb_build_object('amount',(pay_n->>'total')::numeric,'unclassified',0)
   into after_event_n from private.crm_receipts_v10 r where r.id=event_id_n;
 end if;
 if kind_n='procedure' then
  update public.procedures set paid_total=new_initial_n,charge_total=charge_n,
   discount_amount=case when charge_changed_n then list_n-charge_n else discount_amount end,
   discount_percent=case when charge_changed_n then case when list_n>0 then round((list_n-charge_n)*100/list_n,2) else 0 end else discount_percent end,
   discount_reason=discount_reason_n,discount_comment=discount_comment_n,
   payment_pending=pending_n,version=version+1 where id=id_n;
 else
  update public.sales set paid_total=new_initial_n,charge_total=charge_n,
   discount_amount=case when charge_changed_n then list_n-charge_n else discount_amount end,
   discount_percent=case when charge_changed_n then case when list_n>0 then round((list_n-charge_n)*100/list_n,2) else 0 end else discount_percent end,
   discount_reason=discount_reason_n,discount_comment=discount_comment_n,
   payment_pending=pending_n,version=version+1 where id=id_n;
 end if;
 answer_n:=private.crm_payment_methods_snapshot_v51(kind_n,id_n)||jsonb_build_object(
  'amount_correction_available',true,'amount_corrected',true,'request_id',p_request_id,
  'corrected_event_type',event_type_n,'corrected_event_id',event_id_n,
  'previous_amount',amount_n,'corrected_amount',(pay_n->>'total')::numeric,
  'previous_charge_total',treatment_n->'charge_total','charge_total',charge_n);
 if(answer_n->'treatment'->>'received_total')::numeric<>new_received_n then
  raise exception 'Исправленная сумма не совпала с историей оплат' using errcode='22023';end if;
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,before_data,after_data,reason)
  values(actor_user_n,actor_staff_n,'payment_amount_corrected_v54',kind_n,id_n::text,
   jsonb_build_object('treatment',treatment_n,'event_type',event_type_n,'event',before_event_n),
   jsonb_build_object('treatment',answer_n->'treatment','event_type',event_type_n,'event',after_event_n,
    'corrected_payments',pay_n,'request_id',p_request_id),reason_n);
 -- Existing v53 readers keep standalone sales outside procedure cash. Frozen
 -- stock/payroll and signed cash counts remain evidence; their normal tokens
 -- indicate when the procedure money changed and another count is necessary.
 perform private.crm_refresh_closed_report_v10(source_shift_n);
 if event_shift_n<>source_shift_n then perform private.crm_refresh_closed_report_v10(event_shift_n);end if;
 update private.warehouse_requests set result=answer_n where id=p_request_id;
 return answer_n;
end $$;
revoke all on function private.crm_payment_amount_v54(text,jsonb,uuid) from public,anon,authenticated;

create function public.crm_payment_amount_v54(p_action text,p_payload jsonb,p_request_id uuid default null)
returns jsonb language sql security definer set search_path='' as $$
 select private.crm_payment_amount_v54(p_action,p_payload,p_request_id);
$$;
revoke all on function public.crm_payment_amount_v54(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.crm_payment_amount_v54(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
