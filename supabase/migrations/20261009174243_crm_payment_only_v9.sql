-- v9: payment accounting while inventory is being reconciled.
-- Default preserves tracked inventory; owner activation is a separate audited action.
-- Only additive columns and checked function replacements. Existing API ACLs are preserved.
set lock_timeout='10s';
alter table private.crm_finance_settings add column if not exists payment_only boolean not null default false;
alter table public.procedures add column if not exists stock_deducted boolean not null default true;
alter table public.sales add column if not exists stock_deducted boolean not null default true;
comment on column private.crm_finance_settings.payment_only is 'Owner setting: save payments without inventory transfers or deductions.';
comment on column public.procedures.stock_deducted is 'Immutable accounting mode captured when the procedure was recorded.';
comment on column public.sales.stock_deducted is 'Immutable accounting mode captured when the sale was recorded.';

CREATE OR REPLACE FUNCTION private.crm_finance_v5(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; role_name text; sh uuid; staff_n uuid; wage numeric; old_n jsonb; new_n jsonb; answer jsonb; settings_n private.crm_finance_settings%rowtype; reason_n text; payroll_n numeric; unknown_n integer;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Проверьте параметры';end if;
 if p_action='accounting_mode' then
  select * into settings_n from private.crm_finance_settings where id;
  if not found then raise exception 'Настройки финансов не найдены';end if;
  return jsonb_build_object('payment_only',settings_n.payment_only,'stock_deducted',not settings_n.payment_only);
 end if;
 if p_action='summary' then return private.crm_finance_summary_v5(p_payload);end if;
 if p_action in ('settings_get','settings_save') then
  if role_name='nurse' then raise exception 'Настройки доступны только владельцу';end if;
  select * into settings_n from private.crm_finance_settings where id for update;
  old_n:=to_jsonb(settings_n)-'updated_by'-'updated_at'-'id';
  if not found then raise exception 'Настройки финансов не найдены';end if;
  if p_action='settings_save' then
   if p_payload ? 'payment_only' and jsonb_typeof(p_payload->'payment_only') is distinct from 'boolean' then
    raise exception 'Режим учёта должен быть включён или выключен';
   end if;
   wage:=coalesce((p_payload->>'float_amount')::numeric,settings_n.float_amount);
   if wage<0 or wage<>round(wage,2) or wage::text in ('NaN','Infinity','-Infinity') or wage>999999999999.99 then raise exception 'Проверьте разменный фонд';end if;
   if coalesce(p_payload->>'time_zone',settings_n.time_zone)<>'Europe/Moscow' then raise exception 'Учёт смен и сроков годности ведётся по московскому времени';end if;
   update private.crm_finance_settings set float_amount=wage,time_zone=coalesce(p_payload->>'time_zone',time_zone),payment_only=case when p_payload ? 'payment_only' then (p_payload->>'payment_only')::boolean else payment_only end,updated_by=auth.uid(),updated_at=now() where id returning * into settings_n;
   new_n:=to_jsonb(settings_n)-'updated_by'-'updated_at'-'id';
   insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,before_data,after_data)
   values(auth.uid(),actor,'finance_settings_changed','settings','finance',old_n,new_n);
  end if;
  return to_jsonb(settings_n)-'updated_by'-'updated_at'-'id';
 end if;
 if p_action not in ('shift_report','close','salary') or p_action is null then raise exception 'Неизвестная операция';end if;
 sh:=nullif(p_payload->>'shift_id','')::uuid;
 perform 1 from public.shifts where id=sh for update;
 if not found then raise exception 'Смена не найдена';end if;
 if role_name='nurse' and not exists(select 1 from public.shift_staff where shift_id=sh and staff_id=actor) then raise exception 'Нет доступа к смене';end if;
 if p_action='salary' then
  if role_name='nurse' then raise exception 'Зарплату изменяет только владелец';end if;
  staff_n:=(p_payload->>'staff_id')::uuid;wage:=(p_payload->>'amount')::numeric;reason_n:=nullif(trim(p_payload->>'reason'),'');
  if wage is null or wage<0 or wage<>round(wage,2) or wage::text in ('NaN','Infinity','-Infinity') or wage>999999999999.99 or reason_n is null then raise exception 'Укажите сумму зарплаты и причину изменения';end if;
  if not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=sh and ss.staff_id=staff_n and st.role='nurse') then raise exception 'Сотрудник не относится к смене';end if;
  select to_jsonb(w) into old_n from private.crm_shift_payroll w where shift_id=sh and staff_id=staff_n for update;
  insert into private.crm_shift_payroll(shift_id,staff_id,amount,reason,updated_by) values(sh,staff_n,wage,reason_n,auth.uid())
  on conflict(shift_id,staff_id) do update set amount=excluded.amount,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now() returning to_jsonb(crm_shift_payroll) into new_n;
  insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,before_data,after_data,reason)
  values(auth.uid(),actor,'salary_changed','shift_staff',sh::text||'/'||staff_n::text,old_n,new_n,reason_n);
  -- Keep stock and activity frozen; overlay explicitly audited payroll corrections only.
  select coalesce(sum(amount),0) into payroll_n from private.crm_shift_payroll where shift_id=sh;
  select count(*) into unknown_n from public.shift_staff ss join public.staff st on st.id=ss.staff_id
   left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=sh and st.role='nurse' and w.shift_id is null;
  update private.crm_shift_reports r set report=report||jsonb_build_object('staff',(select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=sh),
   'payroll_total',payroll_n,'payroll_unknown',unknown_n,'payroll_complete',unknown_n=0,'cash_after_salary',case when unknown_n=0 then (report->'revenue'->>'total')::numeric-payroll_n end) where shift_id=sh;
 elsif p_action='close' then
  if not exists(select 1 from private.crm_shift_reports where shift_id=sh) then
   update public.shifts set status='closed',ended_at=coalesce(ended_at,now()) where id=sh;
   answer:=private.crm_build_shift_report_v5(sh);
   insert into private.crm_shift_reports(shift_id,report,closed_by) values(sh,answer,auth.uid());
   insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,after_data)
   values(auth.uid(),actor,'shift_closed','shift',sh::text,jsonb_build_object('status','closed'));
  end if;
 end if;
 select report into answer from private.crm_shift_reports where shift_id=sh;
 if not found then answer:=private.crm_build_shift_report_v5(sh);end if;
 if role_name='nurse' then return private.crm_redact_finance_v5(answer);end if;
 return answer;
end $function$
;

-- Clinical write preserves the existing validations and captures the accounting mode.
-- Requires private.crm_finance_settings.payment_only BOOLEAN NOT NULL DEFAULT FALSE
-- and public.procedures/public.sales.stock_deducted BOOLEAN NOT NULL DEFAULT TRUE.
-- CREATE OR REPLACE preserves the live function privileges; no grants are added.

-- private.record_treatment_v3
CREATE OR REPLACE FUNCTION private.record_treatment_v3(p_kind text, p_payload jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid; sh uuid:=(p_payload->>'shift_id')::uuid; nurse uuid:=(p_payload->>'nurse_id')::uuid;
 patient uuid:=nullif(p_payload->>'patient_id','')::uuid; service uuid:=nullif(p_payload->>'service_id','')::uuid;
 req private.warehouse_requests%rowtype; item jsonb; items jsonb; med public.medications%rowtype;
 result_id uuid; quantity_n numeric; total_n numeric:=0; work_n numeric:=0; consumables_n numeric:=0;
 service_name text; paid_n numeric; discount_n numeric; percent_n numeric:=0;
 payment_only_n boolean; stock_deducted_n boolean;
 reason text:=nullif(trim(p_payload->>'discount_reason'),''); note text:=nullif(trim(p_payload->>'discount_comment'),'');
begin
 select id into actor from public.staff where active and auth_user_id=auth.uid() and role in ('admin','owner','nurse') limit 1;
 if auth.uid() is null or actor is null then raise exception 'Нет доступа';end if;
 if p_kind is null or p_kind not in ('procedure','sale') or p_request_id is null then raise exception 'Неверная операция';end if;
 insert into private.warehouse_requests(id,staff_user,action,payload) values(p_request_id,auth.uid(),'clinical_'||p_kind,p_payload) on conflict do nothing;
 select * into req from private.warehouse_requests where id=p_request_id for update;
 if req.staff_user<>auth.uid() or req.action<>'clinical_'||p_kind or req.payload<>p_payload then raise exception 'Номер операции уже использован';end if;
 if req.result is not null then
  result_id:=(req.result->>'id')::uuid;
  if p_kind='procedure' then select stock_deducted into stock_deducted_n from public.procedures where id=result_id;
  else select stock_deducted into stock_deducted_n from public.sales where id=result_id;end if;
  stock_deducted_n:=coalesce(stock_deducted_n,true);
  return req.result||jsonb_build_object('stock_deducted',stock_deducted_n,'payment_only',not stock_deducted_n);
 end if;
 select payment_only into payment_only_n from private.crm_finance_settings where id for share;
 if not found then raise exception 'Настройки финансов не найдены';end if;
 stock_deducted_n:=not payment_only_n;
 perform 1 from public.shifts where id=sh and status='open' for update;
 if not found then raise exception 'Смена закрыта или не выбрана';end if;
 if not private.is_manager() and not exists(select 1 from public.shift_staff where shift_id=sh and staff_id=actor) then raise exception 'Нет доступа к этой смене';end if;
 if not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=sh and ss.staff_id=nurse and st.active and st.role='nurse') then raise exception 'Выберите медсестру этой смены';end if;
 if (p_kind='procedure' and patient is null) or (patient is not null and not exists(select 1 from public.patients where id=patient)) then raise exception 'Выберите пациента';end if;
 if p_kind='procedure' then
  select name,work_price,consumables_price into service_name,work_n,consumables_n from public.procedure_services where id=service and active for share;
  if not found then raise exception 'Выберите действующую услугу';end if;
  if work_n<0 or consumables_n<0 or work_n::text in ('NaN','Infinity','-Infinity') or consumables_n::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте цены услуги';end if;
 end if;
 items:=coalesce(p_payload->'items','[]'::jsonb);
 if jsonb_typeof(items)<>'array' then raise exception 'Проверьте список препаратов';end if;
 for item in select * from jsonb_array_elements(items) loop
  quantity_n:=(item->>'quantity')::numeric;
  if nullif(item->>'medication_id','') is null or quantity_n is null or quantity_n<=0 or quantity_n<>trunc(quantity_n) or quantity_n::text in ('NaN','Infinity','-Infinity') then raise exception 'Количество препарата должно быть целым числом больше нуля';end if;
 end loop;
 -- Merge repeated rows and lock medications in a stable order.
 select coalesce(jsonb_agg(jsonb_build_object('medication_id',id,'quantity',q) order by id),'[]') into items
 from (select (x->>'medication_id')::uuid id,sum((x->>'quantity')::numeric) q from jsonb_array_elements(items) x group by 1) grouped;
 if p_kind='sale' and jsonb_array_length(items)=0 then raise exception 'Добавьте препарат';end if;
 for item in select * from jsonb_array_elements(items) loop
  select * into med from public.medications where id=(item->>'medication_id')::uuid and active for update;
  if not found then raise exception 'Препарат недоступен';end if;
  if med.sale_price is null or med.sale_price<0 or (payment_only_n and med.sale_price<=0) or med.sale_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте цену препарата';end if;
  total_n:=total_n+round(med.sale_price*(item->>'quantity')::numeric,2);
 end loop;
 total_n:=round(total_n+work_n+consumables_n,2);
 paid_n:=round(coalesce((p_payload->>'paid_total')::numeric,total_n),2);
 if paid_n<0 or paid_n>total_n or paid_n::text in ('NaN','Infinity','-Infinity') then raise exception 'Оплата должна быть от нуля до суммы по прайсу';end if;
 discount_n:=total_n-paid_n;
 if discount_n>0 then
  if reason is null or reason not in ('Скидка от владельца','Постоянный пациент','Акция','Другое') then raise exception 'Укажите причину скидки';end if;
  if reason='Другое' and note is null then raise exception 'Добавьте комментарий к скидке';end if;
  percent_n:=round(discount_n*100/total_n,2);
 else reason:=null;note:=null;
 end if;
 if p_kind='procedure' then
  insert into public.procedures(patient_id,shift_id,nurse_id,service_id,procedure_type,work_price,consumables_price,list_total,discount_amount,discount_percent,discount_reason,discount_comment,paid_total,notes,stock_deducted)
   values(patient,sh,nurse,service,service_name,work_n,consumables_n,total_n,discount_n,percent_n,reason,note,paid_n,p_payload->>'notes',stock_deducted_n) returning id into result_id;
 else
  insert into public.sales(shift_id,nurse_id,patient_id,list_total,discount_amount,discount_percent,discount_reason,discount_comment,paid_total,notes,stock_deducted)
   values(sh,nurse,patient,total_n,discount_n,percent_n,reason,note,paid_n,p_payload->>'notes',stock_deducted_n) returning id into result_id;
 end if;
 for item in select * from jsonb_array_elements(items) loop
  select * into med from public.medications where id=(item->>'medication_id')::uuid;
  quantity_n:=(item->>'quantity')::numeric;
  if p_kind='procedure' then
   insert into public.procedure_medications(procedure_id,medication_id,quantity,unit_price,line_total) values(result_id,med.id,quantity_n,med.sale_price,round(quantity_n*med.sale_price,2));
   if stock_deducted_n then
    perform private.move_stock_v3(med.id,quantity_n,'work',null,'procedure_use','Расход на процедуру',result_id,null);
   end if;
  else
   insert into public.sale_items(sale_id,medication_id,quantity,unit_price,line_total) values(result_id,med.id,quantity_n,med.sale_price,round(quantity_n*med.sale_price,2));
   if stock_deducted_n then
    perform private.move_stock_v3(med.id,quantity_n,'work',null,'sale','Продажа',null,result_id);
   end if;
  end if;
 end loop;
 update private.warehouse_requests set result=jsonb_build_object('id',result_id,'stock_deducted',stock_deducted_n,'payment_only',not stock_deducted_n) where id=p_request_id;
 return jsonb_build_object('id',result_id,'stock_deducted',stock_deducted_n,'payment_only',not stock_deducted_n);
end $function$
;


CREATE OR REPLACE FUNCTION private.record_treatment_v5(p_kind text, p_payload jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; role_name text; sh uuid; item record; req private.warehouse_requests%rowtype;
 pay jsonb:=p_payload->'payments'; cash_n numeric; terminal_n numeric; card_n numeric; received_n numeric;
 answer jsonb; result_id uuid; paid_n numeric; list_n numeric; reserve_n boolean:=coalesce((p_payload->>'reserve_sale')::boolean,false);
 available_n numeric; missing_n numeric; saved private.crm_payment_allocations%rowtype;
 payment_only_n boolean; stock_deducted_n boolean;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if p_kind is null or p_kind not in ('procedure','sale') or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Проверьте операцию';end if;
 if jsonb_typeof(pay) is distinct from 'object' then raise exception 'Укажите способы оплаты';end if;
 if exists(select 1 from jsonb_object_keys(pay) k where k not in ('cash','terminal','owner_card','cash_received')) then raise exception 'Неизвестный способ оплаты';end if;
 cash_n:=coalesce((pay->>'cash')::numeric,0);terminal_n:=coalesce((pay->>'terminal')::numeric,0);card_n:=coalesce((pay->>'owner_card')::numeric,0);
 received_n:=coalesce((pay->>'cash_received')::numeric,cash_n);
 if exists(select 1 from unnest(array[cash_n,terminal_n,card_n,received_n]) n where n<0 or n<>round(n,2) or n::text in ('NaN','Infinity','-Infinity') or n>999999999999.99) then raise exception 'Суммы оплаты должны быть неотрицательными, с точностью до копейки';end if;
 if received_n<cash_n or (cash_n=0 and received_n<>0) then raise exception 'Проверьте полученные наличные';end if;
 if reserve_n and (role_name='nurse' or p_kind<>'sale') then raise exception 'Продажа из запаса доступна только владельцу';end if;
 -- The v3 request row protects the entire v5 payload, including the payment allocation.
 insert into private.warehouse_requests(id,staff_user,action,payload) values(p_request_id,auth.uid(),'clinical_'||p_kind,p_payload) on conflict do nothing;
 select * into req from private.warehouse_requests where id=p_request_id for update;
 if req.staff_user<>auth.uid() or req.action<>'clinical_'||p_kind or req.payload<>p_payload then raise exception 'Номер операции уже использован';end if;
 select * into saved from private.crm_payment_allocations where id=p_request_id;
 if found then
  if saved.procedure_id is not null then select stock_deducted into stock_deducted_n from public.procedures where id=saved.procedure_id;
  else select stock_deducted into stock_deducted_n from public.sales where id=saved.sale_id;end if;
  if stock_deducted_n is null then raise exception 'Сохранённая операция не найдена';end if;
  return jsonb_build_object('id',coalesce(saved.procedure_id,saved.sale_id),'stock_deducted',stock_deducted_n,'payment_only',not stock_deducted_n,'paid_total',saved.cash+saved.terminal+saved.owner_card,
   'payments',jsonb_build_object('cash',saved.cash,'terminal',saved.terminal,'owner_card',saved.owner_card,'cash_received',saved.cash_received,'change',saved.change_amount));
 end if;
 if req.result is not null then raise exception 'Эта операция была сохранена без распределения оплаты. Создайте новую операцию';end if;
 -- Keep mode stable through payment, reserve transfer, and the clinical write.
 -- A committed receipt above always replays its original mode.
 select payment_only into payment_only_n from private.crm_finance_settings where id for share;
 if not found then raise exception 'Настройки финансов не найдены';end if;
 stock_deducted_n:=not payment_only_n;
 if p_payload ? 'expected_stock_deducted' then
  if jsonb_typeof(p_payload->'expected_stock_deducted') is distinct from 'boolean' then raise exception 'Проверьте режим учёта';end if;
  if (p_payload->>'expected_stock_deducted')::boolean is distinct from stock_deducted_n then
   raise exception 'Режим учёта изменён. Обновите режим в форме и подтвердите оплату заново.';
  end if;
 end if;
 sh:=(p_payload->>'shift_id')::uuid;
 perform 1 from public.shifts where id=sh and status='open' for update;
 if not found then raise exception 'Смена закрыта или не выбрана';end if;
 if role_name='nurse' and not exists(select 1 from public.shift_staff where shift_id=sh and staff_id=actor) then raise exception 'Нет доступа к этой смене';end if;
 if nullif(p_payload->>'patient_id','') is not null then
  perform 1 from public.patients where id=(p_payload->>'patient_id')::uuid and not archived for share;
  if not found then raise exception 'Пациент не найден или находится в архиве. Владелец должен восстановить карточку';end if;
 end if;
 if jsonb_typeof(coalesce(p_payload->'items','[]'))<>'array' then raise exception 'Проверьте список препаратов';end if;
 if reserve_n and stock_deducted_n then
  -- Owner approval is the authenticated owner performing this one atomic sale.
  -- Transfer just the missing usable units, then reuse the existing FEFO clinical path.
  for item in select (x->>'medication_id')::uuid med_id,sum((x->>'quantity')::numeric) qty
    from jsonb_array_elements(coalesce(p_payload->'items','[]')) x group by 1 order by 1 loop
   if item.qty is null or item.qty<=0 or item.qty<>trunc(item.qty) or item.qty::text in ('NaN','Infinity','-Infinity') then raise exception 'Укажите целое количество препарата';end if;
   perform 1 from public.medications where id=item.med_id for update;
   select coalesce(sum(work_quantity),0) into available_n from public.medication_batches
    where medication_id=item.med_id and expiry_date>=(now() at time zone 'Europe/Moscow')::date;
   missing_n:=greatest(item.qty-available_n,0);
   if missing_n>0 then perform private.move_stock_v3(item.med_id,missing_n,'reserve','work','reserve_to_work','Перевод владельцем для продажи');end if;
  end loop;
 end if;
 answer:=private.record_treatment_v3(p_kind,p_payload,p_request_id);
 result_id:=(answer->>'id')::uuid;
 if p_kind='procedure' then select paid_total,list_total,stock_deducted into paid_n,list_n,stock_deducted_n from public.procedures where id=result_id;
 else select paid_total,list_total,stock_deducted into paid_n,list_n,stock_deducted_n from public.sales where id=result_id;end if;
 if role_name='nurse' and paid_n<>list_n then raise exception 'Скидку может назначить только владелец';end if;
 if cash_n+terminal_n+card_n<>paid_n then raise exception 'Сумма способов оплаты должна совпадать со стоимостью: % ₽',paid_n;end if;
 insert into private.crm_payment_allocations(id,kind,procedure_id,sale_id,cash,terminal,owner_card,cash_received,change_amount,created_by)
 values(p_request_id,p_kind,case when p_kind='procedure' then result_id end,case when p_kind='sale' then result_id end,cash_n,terminal_n,card_n,received_n,received_n-cash_n,auth.uid());
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,after_data)
 values(auth.uid(),actor,'payment_recorded',p_kind,result_id::text,jsonb_build_object('paid_total',paid_n,'cash',cash_n,'terminal',terminal_n,'owner_card',card_n,'cash_received',received_n,'change',received_n-cash_n,'reserve_sale',reserve_n and stock_deducted_n,'reserve_sale_requested',reserve_n,'stock_deducted',stock_deducted_n,'payment_only',not stock_deducted_n));
 return jsonb_build_object('id',result_id,'stock_deducted',stock_deducted_n,'payment_only',not stock_deducted_n,'paid_total',paid_n,'payments',jsonb_build_object('cash',cash_n,'terminal',terminal_n,'owner_card',card_n,'cash_received',received_n,'change',received_n-cash_n));
end $function$
;

-- Reports separate payments from actual inventory deductions.
-- Preserves live finance formulas, role checks, redaction and function search_path/security.
-- private.crm_build_shift_report_v5
CREATE OR REPLACE FUNCTION private.crm_build_shift_report_v5(p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare answer jsonb; revenue_n jsonb; wages_n numeric; unknown_n integer;
 payment_only_procedures_n bigint; payment_only_sales_n bigint;
begin
 with events as (
  select 'procedure' kind,p.id,p.paid_total from public.procedures p where shift_id=p_shift
  union all select 'sale',s.id,s.paid_total from public.sales s where shift_id=p_shift
 )
 select jsonb_build_object('cash',coalesce(sum(a.cash),0),'terminal',coalesce(sum(a.terminal),0),'owner_card',coalesce(sum(a.owner_card),0),
  'unclassified',coalesce(sum(case when a.id is null then e.paid_total else 0 end),0),'total',coalesce(sum(e.paid_total),0)) into revenue_n
 from events e left join private.crm_payment_allocations a on (e.kind='procedure' and a.procedure_id=e.id) or (e.kind='sale' and a.sale_id=e.id);
 select coalesce(sum(amount),0) into wages_n from private.crm_shift_payroll where shift_id=p_shift;
 select count(*) into unknown_n from public.shift_staff ss join public.staff st on st.id=ss.staff_id
  left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=p_shift and st.role='nurse' and w.shift_id is null;
 select count(*) into payment_only_procedures_n from public.procedures where shift_id=p_shift and not stock_deducted;
 select count(*) into payment_only_sales_n from public.sales where shift_id=p_shift and not stock_deducted;
 select jsonb_build_object(
  'shift',(select jsonb_build_object('id',id,'date',shift_date,'started_at',started_at,'planned_end_at',planned_end_at,'ended_at',ended_at,'status',status,'slot',daily_slot) from public.shifts where id=p_shift),
  'staff',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=p_shift),'[]'),
  'patients_count',(select count(distinct patient_id) from(select patient_id from public.procedures where shift_id=p_shift union all select patient_id from public.sales where shift_id=p_shift) e),
  'procedures_count',(select count(*) from public.procedures where shift_id=p_shift),
  'sales_count',(select count(*) from public.sales where shift_id=p_shift),
  'payment_only_procedures_count',payment_only_procedures_n,'payment_only_sales_count',payment_only_sales_n,
  'procedures_total',coalesce((select sum(paid_total) from public.procedures where shift_id=p_shift),0),
  'sales_total',coalesce((select sum(paid_total) from public.sales where shift_id=p_shift),0),
  'cash_total',revenue_n->'total','revenue',revenue_n,'payroll_total',wages_n,'payroll_unknown',unknown_n,'payroll_complete',unknown_n=0,
  'cash_after_salary',case when unknown_n=0 then (revenue_n->>'total')::numeric-wages_n end,
  'procedures',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'at',p.visit_at,'patient_id',p.patient_id,'patient',pt.full_name,'nurse',st.full_name,'type',p.procedure_type,'notes',p.notes,
   'list_total',p.list_total,'discount_amount',p.discount_amount,'paid_total',p.paid_total,'stock_deducted',p.stock_deducted,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'line_total',pm.line_total) order by m.name) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]')) order by p.visit_at,p.id)
   from public.procedures p left join public.patients pt on pt.id=p.patient_id left join public.staff st on st.id=p.nurse_id where p.shift_id=p_shift),'[]'),
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'at',s.sold_at,'patient_id',s.patient_id,'patient',coalesce(pt.full_name,'Без пациента'),'nurse',st.full_name,'notes',s.notes,
   'list_total',s.list_total,'discount_amount',s.discount_amount,'paid_total',s.paid_total,'stock_deducted',s.stock_deducted,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'line_total',si.line_total) order by m.name) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]')) order by s.sold_at,s.id)
   from public.sales s left join public.patients pt on pt.id=s.patient_id left join public.staff st on st.id=s.nurse_id where s.shift_id=p_shift),'[]'),
  'used',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.consumption_unit,'procedure_qty',u.proc,'sale_qty',u.sale,'quantity',u.proc+u.sale) order by m.name)
   from(select medication_id,sum(proc) proc,sum(sale) sale from(
    select pm.medication_id,pm.quantity proc,0::numeric sale from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id where p.shift_id=p_shift and p.stock_deducted
    union all select si.medication_id,0,si.quantity from public.sale_items si join public.sales s on s.id=si.sale_id where s.shift_id=p_shift and s.stock_deducted
   ) e group by medication_id) u join public.medications m on m.id=u.medication_id),'[]'),
  'untracked',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.consumption_unit,'procedure_qty',u.proc,'sale_qty',u.sale,'quantity',u.proc+u.sale) order by m.name)
   from(select medication_id,sum(proc) proc,sum(sale) sale from(
    select pm.medication_id,pm.quantity proc,0::numeric sale from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id where p.shift_id=p_shift and not p.stock_deducted
    union all select si.medication_id,0,si.quantity from public.sale_items si join public.sales s on s.id=si.sale_id where s.shift_id=p_shift and not s.stock_deducted
   ) e group by medication_id) u join public.medications m on m.id=u.medication_id),'[]'),
  'stock',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.consumption_unit,'work',coalesce(w.quantity,0),'reserve',coalesce(r.quantity,0)) order by m.name)
   from public.medications m left join public.stock w on w.medication_id=m.id and w.location='work' left join public.stock r on r.medication_id=m.id and r.location='reserve' where m.active),'[]'),
  'warnings',coalesce((select jsonb_agg(warning) from(
   select jsonb_build_object('type','low_stock','scope','reserve','medication_id',m.id,'name',m.name,'quantity',coalesce(sum(s.quantity),0),'minimum',m.min_total_stock) warning
   from public.medications m left join public.stock s on s.medication_id=m.id where m.active group by m.id having coalesce(sum(s.quantity),0)<m.min_total_stock
   union all select jsonb_build_object('type','low_work','scope','work','medication_id',m.id,'name',m.name,'quantity',coalesce(s.quantity,0),'minimum',m.work_threshold)
   from public.medications m left join public.stock s on s.medication_id=m.id and s.location='work' where m.active and coalesce(s.quantity,0)<m.work_threshold
   union all select jsonb_build_object('type',case when b.expiry_date<(now() at time zone 'Europe/Moscow')::date then 'expired' else 'expiring' end,'scope','work','medication_id',m.id,'name',m.name,'expiry_date',b.expiry_date,'quantity',b.work_quantity)
   from public.medication_batches b join public.medications m on m.id=b.medication_id where b.work_quantity>0 and b.expiry_date<=(now() at time zone 'Europe/Moscow')::date+30
   union all select jsonb_build_object('type',case when b.expiry_date<(now() at time zone 'Europe/Moscow')::date then 'expired' else 'expiring' end,'scope','reserve','medication_id',m.id,'name',m.name,'expiry_date',b.expiry_date,'quantity',b.quantity_remaining-b.work_quantity)
   from public.medication_batches b join public.medications m on m.id=b.medication_id where b.quantity_remaining-b.work_quantity>0 and b.expiry_date<=(now() at time zone 'Europe/Moscow')::date+30
   union all select jsonb_build_object('type','payment_only','scope','work','name','Без складского списания',
    'count',payment_only_procedures_n+payment_only_sales_n,'procedures_count',payment_only_procedures_n,'sales_count',payment_only_sales_n,
    'message','В смене есть операции без складского списания. Их количества учтены отдельно; по этим операциям остатки склада не менялись.')
   where payment_only_procedures_n+payment_only_sales_n>0
  ) alerts),'[]')
 ) into answer;
 return answer;
end $function$
;

-- private.crm_patient_history_v5
CREATE OR REPLACE FUNCTION private.crm_patient_history_v5(p_patient uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; role_name text; answer jsonb;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if not exists(select 1 from public.patients where id=p_patient) then raise exception 'Пациент не найден';end if;
 select jsonb_build_object(
  'procedures',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'visit_at',p.visit_at,'procedure_type',p.procedure_type,'nurse',st.full_name,'notes',p.notes,'list_total',p.list_total,'discount_amount',p.discount_amount,'paid_total',p.paid_total,'stock_deducted',p.stock_deducted,
   'medications',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'line_total',pm.line_total) order by m.name) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]')) order by p.visit_at desc,p.id)
   from public.procedures p left join public.staff st on st.id=p.nurse_id where p.patient_id=p_patient),'[]'),
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'sold_at',s.sold_at,'nurse',st.full_name,'notes',s.notes,'list_total',s.list_total,'discount_amount',s.discount_amount,'paid_total',s.paid_total,'stock_deducted',s.stock_deducted,
   'items',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'line_total',si.line_total) order by m.name) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]')) order by s.sold_at desc,s.id)
   from public.sales s left join public.staff st on st.id=s.nurse_id where s.patient_id=p_patient),'[]')
 ) into answer;
 if role_name='nurse' then return private.crm_redact_finance_v5(answer);end if;
 return answer;
end $function$
;

-- private.crm_finance_summary_v5
CREATE OR REPLACE FUNCTION private.crm_finance_summary_v5(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare tz text; first_day date; last_day date; grouping text:=coalesce(p_payload->>'group_by','day');
 employee uuid:=nullif(p_payload->>'employee_id','')::uuid; patient uuid:=nullif(p_payload->>'patient_id','')::uuid;
 medication uuid:=nullif(p_payload->>'medication_id','')::uuid; service uuid:=nullif(p_payload->>'service_id','')::uuid;
 answer jsonb; wages_n numeric; closed_wages numeric; open_wages numeric; shifts_n jsonb; complete_n boolean; unknown_n integer; has_open_n boolean;
 entity_filter boolean:=patient is not null or medication is not null or service is not null;
begin
 if auth.uid() is null or not private.is_manager() then raise exception 'Финансовые отчёты доступны только владельцу';end if;
 select time_zone into tz from private.crm_finance_settings where id;
 first_day:=coalesce(nullif(p_payload->>'from','')::date,(now() at time zone tz)::date);
 last_day:=coalesce(nullif(p_payload->>'to','')::date,first_day);
 if last_day<first_day or last_day-first_day>3660 then raise exception 'Проверьте период отчёта';end if;
 if grouping not in ('day','employee','patient','medication','service') then raise exception 'Неизвестная группировка';end if;
 with events as (
  select 'procedure' kind,p.id,p.shift_id,p.nurse_id,p.patient_id,p.service_id,p.procedure_type service_name,p.visit_at at,p.list_total,p.paid_total,p.stock_deducted from public.procedures p
  where p.visit_at>=first_day::timestamp at time zone tz and p.visit_at<(last_day+1)::timestamp at time zone tz
  union all select 'sale',s.id,s.shift_id,s.nurse_id,s.patient_id,null,'Продажа препаратов',s.sold_at,s.list_total,s.paid_total,s.stock_deducted from public.sales s
  where s.sold_at>=first_day::timestamp at time zone tz and s.sold_at<(last_day+1)::timestamp at time zone tz
 ), filtered as (
  select e.*,coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,coalesce(a.owner_card,0) owner_card,case when a.id is null then e.paid_total else 0 end unclassified
  from events e left join private.crm_payment_allocations a on(e.kind='procedure' and a.procedure_id=e.id) or(e.kind='sale' and a.sale_id=e.id)
  where (employee is null or e.nurse_id=employee) and(patient is null or e.patient_id=patient) and(service is null or e.service_id=service)
  and(medication is null or (e.kind='procedure' and exists(select 1 from public.procedure_medications where procedure_id=e.id and medication_id=medication))
   or(e.kind='sale' and exists(select 1 from public.sale_items where sale_id=e.id and medication_id=medication)))
 ), grouped_source as (
  select f.*,case grouping when 'day' then (f.at at time zone tz)::date::text when 'employee' then f.nurse_id::text when 'patient' then coalesce(f.patient_id::text,'no_patient') when 'service' then coalesce(f.service_id::text,'sale') end group_id,
   case grouping when 'day' then (f.at at time zone tz)::date::text when 'employee' then coalesce(st.full_name,'Сотрудник') when 'patient' then coalesce(pt.full_name,'Без пациента') when 'service' then f.service_name end label,1::numeric share,0::numeric quantity
  from filtered f left join public.staff st on st.id=f.nurse_id left join public.patients pt on pt.id=f.patient_id where grouping<>'medication'
  union all
  select f.*,m.id::text,m.name,case when f.list_total>0 then lines.line_total/f.list_total else 0 end,lines.quantity
  from filtered f join lateral(
   select medication_id,sum(line_total) line_total,sum(quantity) quantity from public.procedure_medications where f.kind='procedure' and procedure_id=f.id group by medication_id
   union all select medication_id,sum(line_total),sum(quantity) from public.sale_items where f.kind='sale' and sale_id=f.id group by medication_id
  ) lines on true join public.medications m on m.id=lines.medication_id where grouping='medication' and(medication is null or m.id=medication)
 ), grouped as (
  select group_id,label,count(distinct patient_id) patients_count,count(distinct id) filter(where kind='procedure') procedures_count,count(distinct id) filter(where kind='sale') sales_count,
   count(distinct id) filter(where kind='procedure' and not stock_deducted) payment_only_procedures_count,
   count(distinct id) filter(where kind='sale' and not stock_deducted) payment_only_sales_count,
   sum(quantity) quantity,round(sum(cash*share),2) cash,round(sum(terminal*share),2) terminal,round(sum(owner_card*share),2) owner_card,round(sum(unclassified*share),2) unclassified,round(sum(paid_total*share),2) total
  from grouped_source group by group_id,label
 )
 select jsonb_build_object('from',first_day,'to',last_day,'time_zone',tz,'group_by',grouping,
  'patients_count',(select count(distinct patient_id) from filtered),'procedures_count',(select count(*) from filtered where kind='procedure'),'sales_count',(select count(*) from filtered where kind='sale'),
  'payment_only_procedures_count',(select count(*) from filtered where kind='procedure' and not stock_deducted),
  'payment_only_sales_count',(select count(*) from filtered where kind='sale' and not stock_deducted),
  'revenue',(select jsonb_build_object('cash',coalesce(sum(cash),0),'terminal',coalesce(sum(terminal),0),'owner_card',coalesce(sum(owner_card),0),'unclassified',coalesce(sum(unclassified),0),'total',coalesce(sum(paid_total),0)) from filtered),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',group_id,'label',label,'patients_count',patients_count,'procedures_count',procedures_count,'sales_count',sales_count,'quantity',quantity,
   'payment_only_procedures_count',payment_only_procedures_count,'payment_only_sales_count',payment_only_sales_count,
   'revenue',jsonb_build_object('cash',cash,'terminal',terminal,'owner_card',owner_card,'unclassified',unclassified,'total',total)) order by label,group_id) from grouped),'[]'),
  'rows_revenue_basis',case when grouping='medication' then 'medication_line_share_of_paid_total' else 'full_receipt' end
 ) into answer;
 select coalesce(sum(w.amount),0),coalesce(sum(w.amount) filter(where s.status='closed'),0),coalesce(sum(w.amount) filter(where s.status='open'),0)
 into wages_n,closed_wages,open_wages from private.crm_shift_payroll w join public.shifts s on s.id=w.shift_id
 where s.shift_date between first_day and last_day and(employee is null or w.staff_id=employee);
 select count(*) into unknown_n from public.shift_staff ss join public.shifts s on s.id=ss.shift_id join public.staff st on st.id=ss.staff_id
  left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id
  where s.shift_date between first_day and last_day and st.role='nurse' and w.shift_id is null and(employee is null or ss.staff_id=employee);
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'shift_date',s.shift_date,'started_at',s.started_at,'ended_at',s.ended_at,'status',s.status,'slot',s.daily_slot,
  'staff',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=s.id),'[]'),
  'payroll_total',coalesce((select sum(amount) from private.crm_shift_payroll where shift_id=s.id),0),
  'payroll_complete',not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id
   left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=s.id and st.role='nurse' and w.shift_id is null)) order by s.shift_date desc,s.started_at desc),'[]') into shifts_n
 from public.shifts s where s.shift_date between first_day and last_day and(employee is null or exists(select 1 from public.shift_staff where shift_id=s.id and staff_id=employee));
 select not exists(select 1 from public.shifts where shift_date between first_day and last_day group by shift_date having count(*)<>2 or not bool_and(status='closed')) into complete_n;
 select exists(select 1 from public.shifts where shift_date between first_day and last_day and status='open') into has_open_n;
 return answer||jsonb_build_object('payroll_total',case when not entity_filter then wages_n end,'payroll_closed',case when not entity_filter then closed_wages end,
  'payroll_open',case when not entity_filter then open_wages end,'payroll_scope',case when entity_filter then 'not_applicable_to_entity_filter' when employee is null then 'all_period_shifts' else 'employee_period_shifts' end,
  'payroll_unknown',case when not entity_filter then unknown_n end,'payroll_complete',case when not entity_filter then unknown_n=0 end,
  'cash_after_salary',case when not entity_filter and unknown_n=0 then (answer->'revenue'->>'total')::numeric-wages_n end,'days_complete',complete_n,'has_open_shifts',has_open_n,'shifts',shifts_n);
end $function$
;


notify pgrst,'reload schema';
