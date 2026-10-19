-- Correct the method of money already received, without creating another payment.
-- Installation changes no existing treatment, receipt, stock or cash-count record.
begin;
set local lock_timeout='10s';

create or replace function private.crm_payment_methods_snapshot_v51(p_kind text,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare treatment_n jsonb;events_n jsonb;initial_n numeric;allocated_n numeric;missing_n numeric;debt_n numeric;allocation_count_n bigint;
begin
 treatment_n:=private.crm_treatment_snapshot_v10(p_kind,p_id);
 initial_n:=coalesce((treatment_n->>'initial_paid_total')::numeric,0);
 select coalesce(sum(a.cash+a.terminal+a.owner_card+a.other_card),0),count(*) into allocated_n,allocation_count_n
  from private.crm_payment_allocations a where a.voided_at is null
  and((p_kind='procedure' and a.procedure_id=p_id)or(p_kind='sale' and a.sale_id=p_id));
 if allocation_count_n>1 then
  raise exception 'Найдено несколько исходных распределений оплаты. Нужна проверка записи' using errcode='22023';end if;
 missing_n:=greatest(initial_n-allocated_n,0);
 select coalesce(jsonb_agg(e.data order by e.event_at,e.id),'[]'::jsonb) into events_n from (
  select a.id,a.created_at event_at,jsonb_build_object('event_type','allocation','id',a.id,
   'amount',a.cash+a.terminal+a.owner_card+a.other_card+missing_n,
   'cash',a.cash,'terminal',a.terminal,'owner_card',a.owner_card,'other_card',a.other_card,
   'unclassified',missing_n,'created_at',a.created_at,'shift_id',treatment_n->'shift_id',
   'nurse_id',treatment_n->'nurse_id','cash_received',a.cash_received,'change',a.change_amount) data
  from private.crm_payment_allocations a where a.voided_at is null
   and((p_kind='procedure' and a.procedure_id=p_id)or(p_kind='sale' and a.sale_id=p_id))
   and a.cash+a.terminal+a.owner_card+a.other_card+missing_n>0
  union all
  select r.id,r.created_at,jsonb_build_object('event_type','receipt','id',r.id,
   'amount',r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount,
   'cash',r.cash,'terminal',r.terminal,'owner_card',r.owner_card,'other_card',r.other_card,
   'unclassified',r.unclassified_amount,'created_at',r.created_at,'paid_on',r.paid_on,
   'shift_id',r.shift_id,'nurse_id',r.nurse_id,'cash_received',r.cash_received,'change',r.change_amount)
  from private.crm_receipts_v10 r where r.voided_at is null and not r.is_debt_repayment
   and((p_kind='procedure' and r.procedure_id=p_id)or(p_kind='sale' and r.sale_id=p_id))
   and r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount>0
 ) e;
 select coalesce(sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount),0) into debt_n
  from private.crm_receipts_v10 r where r.voided_at is null and r.is_debt_repayment
   and((p_kind='procedure' and r.procedure_id=p_id)or(p_kind='sale' and r.sale_id=p_id));
 return jsonb_build_object('kind',p_kind,'id',p_id,'version',treatment_n->'version',
  'events',events_n,'treatment',treatment_n,'debt_repayments_excluded',true,
  'debt_repayments_total',debt_n,
  'hint',nullif(concat_ws(' ',
   case when debt_n>0 then 'Погашения настоящего долга учитываются отдельно и здесь не меняются.' end,
   case when missing_n>0 and not exists(select 1 from private.crm_payment_allocations a where a.voided_at is null
    and((p_kind='procedure' and a.procedure_id=p_id)or(p_kind='sale' and a.sale_id=p_id)))
    then 'У старой оплаты отсутствует распределение по способам. Нужна отдельная проверка исходной записи.' end),'') ,
  'legacy_unclassified_total',case when not exists(select 1 from private.crm_payment_allocations a
   where a.voided_at is null and((p_kind='procedure' and a.procedure_id=p_id)or(p_kind='sale' and a.sale_id=p_id)))
   then missing_n else 0 end);
end $$;
revoke all on function private.crm_payment_methods_snapshot_v51(text,uuid) from public,anon,authenticated;

create or replace function private.crm_payment_methods_v51(p_action text,p_payload jsonb,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_user_n uuid:=auth.uid();actor_staff_n uuid;kind_n text;id_n uuid;
 event_type_n text;event_id_n uuid;version_n integer;reason_n text;pay_n jsonb;expected_n jsonb;
 req_n private.warehouse_requests%rowtype;treatment_n jsonb;before_event_n jsonb;after_event_n jsonb;answer_n jsonb;
 allocation_n private.crm_payment_allocations%rowtype;receipt_n private.crm_receipts_v10%rowtype;
 source_shift_n uuid;event_shift_n uuid;amount_n numeric;unclassified_n numeric;cancelled_n boolean:=false;key_n text;number_n numeric;allocation_count_n bigint;
begin
 -- Live authorization precedes even a replay of an already committed request.
 if actor_user_n is null then raise exception 'Войдите в программу' using errcode='42501';end if;
 select s.id into actor_staff_n from public.staff s where s.auth_user_id=actor_user_n
  and s.active and s.role in('owner','admin') limit 1 for share;
 if actor_staff_n is null then
  raise exception 'Способ сохранённой оплаты исправляет администратор или владелец' using errcode='42501';
 end if;
 if p_action is null or p_action not in('get','save') or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Проверьте параметры исправления способа оплаты' using errcode='22023';end if;
 kind_n:=p_payload->>'kind';id_n:=nullif(p_payload->>'id','')::uuid;
 if kind_n is null or kind_n not in('procedure','sale') or id_n is null then
  raise exception 'Выберите сохранённую процедуру или продажу' using errcode='22023';end if;
 if p_action='get' then
  if kind_n='procedure' and to_regclass('private.crm_cancelled_procedures_v51') is not null then
   execute 'select exists(select 1 from private.crm_cancelled_procedures_v51 where procedure_id=$1)'
    into cancelled_n using id_n;
   if cancelled_n then raise exception 'Процедура удалена из действующих записей' using errcode='22023';end if;
  end if;
  return private.crm_payment_methods_snapshot_v51(kind_n,id_n);
 end if;
 if p_request_id is null or p_payload->'confirmed' is distinct from 'true'::jsonb then
  raise exception 'Подтвердите исправление способа уже полученной оплаты' using errcode='22023';end if;
 reason_n:=nullif(trim(p_payload->>'reason'),'');
 if reason_n is null or length(reason_n)>2000 then
  raise exception 'Укажите причину исправления способа оплаты' using errcode='22023';end if;
 event_type_n:=p_payload->>'event_type';event_id_n:=nullif(p_payload->>'event_id','')::uuid;
 if event_type_n is null or event_type_n not in('allocation','receipt') or event_id_n is null then
  raise exception 'Выберите сохранённую оплату' using errcode='22023';end if;
 if coalesce(p_payload->>'expected_version','')!~'^[1-9][0-9]*$' then
  raise exception 'Откройте запись заново: не указана версия' using errcode='22023';end if;
 version_n:=(p_payload->>'expected_version')::integer;
 expected_n:=p_payload->'expected_payments';
 if jsonb_typeof(expected_n) is distinct from 'object' or not(expected_n ?& array['cash','terminal','owner_card','other_card','unclassified'])
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
 pay_n:=private.crm_validate_payment_v10(p_payload->'payments');
 if(pay_n->>'total')::numeric<=0 then raise exception 'Укажите способ положительной оплаты' using errcode='22023';end if;
 insert into private.warehouse_requests(id,staff_user,action,payload)
  values(p_request_id,actor_user_n,'payment_methods_v51_save',p_payload) on conflict do nothing;
 select r.* into req_n from private.warehouse_requests r where r.id=p_request_id for update;
 if req_n.staff_user<>actor_user_n or req_n.action<>'payment_methods_v51_save' or req_n.payload<>p_payload then
  raise exception 'Номер операции уже использован' using errcode='22023';end if;
 if req_n.result is not null then return req_n.result;end if;

 -- Match the existing shift -> treatment -> payment lock order. All UUIDs are
 -- locked in order; a receipt in another shift cannot change its shift here.
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
 if kind_n='procedure' and to_regclass('private.crm_cancelled_procedures_v51') is not null then
  execute 'select exists(select 1 from private.crm_cancelled_procedures_v51 where procedure_id=$1)' into cancelled_n using id_n;
  if cancelled_n then raise exception 'Процедура удалена из действующих записей' using errcode='22023';end if;
 end if;
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
 if expected_n<>jsonb_build_object('cash',(before_event_n->>'cash')::numeric,'terminal',(before_event_n->>'terminal')::numeric,
   'owner_card',(before_event_n->>'owner_card')::numeric,'other_card',(before_event_n->>'other_card')::numeric,
   'unclassified',(before_event_n->>'unclassified')::numeric) then
  raise exception 'Способ оплаты уже изменён. Откройте оплату заново' using errcode='40001';end if;
 if amount_n<=0 or(pay_n->>'total')::numeric<>amount_n then
  raise exception 'Меняется только способ оплаты. Распределите всю ранее полученную сумму: % ₽',amount_n using errcode='22023';end if;

 if event_type_n='allocation' then
  update private.crm_payment_allocations set cash=(pay_n->>'cash')::numeric,terminal=(pay_n->>'terminal')::numeric,
   owner_card=(pay_n->>'owner_card')::numeric,other_card=(pay_n->>'other_card')::numeric,
   cash_received=(pay_n->>'cash_received')::numeric,change_amount=(pay_n->>'change')::numeric where id=event_id_n;
  select to_jsonb(a) into after_event_n from private.crm_payment_allocations a where a.id=event_id_n;
 else
  update private.crm_receipts_v10 set cash=(pay_n->>'cash')::numeric,terminal=(pay_n->>'terminal')::numeric,
   owner_card=(pay_n->>'owner_card')::numeric,other_card=(pay_n->>'other_card')::numeric,unclassified_amount=0,
   cash_received=(pay_n->>'cash_received')::numeric,change_amount=(pay_n->>'change')::numeric where id=event_id_n;
  select to_jsonb(r) into after_event_n from private.crm_receipts_v10 r where r.id=event_id_n;
 end if;
 if kind_n='procedure' then update public.procedures set version=version+1 where id=id_n;
 else update public.sales set version=version+1 where id=id_n;end if;
 answer_n:=private.crm_payment_methods_snapshot_v51(kind_n,id_n)||jsonb_build_object('corrected_event_type',event_type_n,'corrected_event_id',event_id_n);
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,before_data,after_data,reason)
  values(actor_user_n,actor_staff_n,'payment_method_corrected_v51',kind_n,id_n::text,
   jsonb_build_object('treatment',treatment_n,'event_type',event_type_n,'event',before_event_n),
   jsonb_build_object('treatment',answer_n->'treatment','event_type',event_type_n,'event',after_event_n),reason_n);
 -- Rebuild monetary caches while preserving frozen inventory, payroll and cash
 -- count snapshots. Their existing financial fingerprints detect the correction.
 perform private.crm_refresh_closed_report_v10(source_shift_n);
 if event_shift_n<>source_shift_n then perform private.crm_refresh_closed_report_v10(event_shift_n);end if;
 update private.warehouse_requests set result=answer_n where id=p_request_id;
 return answer_n;
end $$;
revoke all on function private.crm_payment_methods_v51(text,jsonb,uuid) from public,anon,authenticated;
create or replace function public.crm_payment_methods_v51(p_action text,p_payload jsonb,p_request_id uuid default null)
returns jsonb language sql security definer set search_path='' as $$
 select private.crm_payment_methods_v51(p_action,p_payload,p_request_id);
$$;
revoke all on function public.crm_payment_methods_v51(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.crm_payment_methods_v51(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
