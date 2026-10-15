-- Actual cash in a shift drawer. Debt collections are deliberately separate.
-- Apply AFTER crm-debt-ledger-v29.sql. No invented opening float or wage payout.
begin;
set local lock_timeout='10s';

do $dependency$
begin
 if to_regprocedure('private.crm_shift_treatment_snapshot_v29(text,uuid)') is null
  or not exists(select 1 from information_schema.columns where table_schema='private'
   and table_name='crm_receipts_v10' and column_name='is_debt_repayment') then
  raise exception 'Apply crm-debt-ledger-v29.sql before crm-cash-drawer-v30.sql';
 end if;
end $dependency$;

create table private.crm_cash_openings_v30 (
 shift_id uuid primary key references public.shifts(id),amount numeric(14,2) not null check(amount>=0),
 reason text not null check(nullif(trim(reason),'') is not null),
 created_by uuid not null,created_at timestamptz not null default now(),
 updated_by uuid not null,updated_at timestamptz not null default now()
);
create table private.crm_cash_movements_v30 (
 id uuid primary key,shift_id uuid not null references public.shifts(id),
 type text not null check(type in('salary','cash_in','expense','refund','owner_withdrawal')),
 amount numeric(14,2) not null check(amount>0),reason text not null check(nullif(trim(reason),'') is not null),
 staff_id uuid references public.staff(id),created_by uuid not null,created_at timestamptz not null default now(),
 voided_at timestamptz,voided_by uuid,void_reason text,
 check((type='salary')=(staff_id is not null)),
 check((voided_at is null and voided_by is null and void_reason is null)
  or(voided_at is not null and voided_by is not null and nullif(trim(void_reason),'') is not null))
);
create index crm_cash_movements_shift_v30 on private.crm_cash_movements_v30(shift_id,created_at,id);
create table private.crm_cash_requests_v30 (
 request_id uuid primary key,actor_user uuid not null,action text not null,payload jsonb not null,
 result jsonb,created_at timestamptz not null default now()
);
alter table private.crm_cash_openings_v30 enable row level security;
alter table private.crm_cash_movements_v30 enable row level security;
alter table private.crm_cash_requests_v30 enable row level security;
revoke all on private.crm_cash_openings_v30,private.crm_cash_movements_v30,private.crm_cash_requests_v30 from public,anon,authenticated;

-- Preserve identity, grants and the v29 handling of ordinary/debt receipts.
do $copy$
declare n text;sig text;source_n text;
begin
 for n,sig in select * from(values('crm_build_shift_report_v5','uuid'),('crm_finance_summary_v5','jsonb'),
  ('crm_finance_v5','text,jsonb'),('crm_dashboard_day_v25','date')) t(n,sig) loop
  source_n:=pg_get_functiondef(to_regprocedure('private.'||n||'('||sig||')'));
  if source_n is null then raise exception 'Missing released function: %',n;end if;
  execute replace(source_n,'FUNCTION private.'||n||'(','FUNCTION private.'||n||'_before_v30(');
  execute 'revoke all on function private.'||n||'_before_v30('||sig||') from public,anon,authenticated';
 end loop;
end $copy$;

create function private.crm_cash_drawer_facts_v30(p_shift uuid,p_received_cash numeric default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare opening_n numeric;cash_n numeric;salary_n numeric;in_n numeric;out_n numeric;balance_n numeric;
 movements_n jsonb;payroll_n jsonb;
begin
 select amount into opening_n from private.crm_cash_openings_v30 where shift_id=p_shift;
 -- Same cash events as v29 revenue, without rebuilding every treatment/stock
 -- section for every shift in a period. Unknown old payment methods stay out.
 cash_n:=p_received_cash;
 if cash_n is null then
  select coalesce(sum(e.cash),0) into cash_n from(
   select a.cash from public.procedures p join private.crm_payment_allocations a on a.procedure_id=p.id
    where p.shift_id=p_shift and a.voided_at is null
   union all
   select a.cash from public.sales s join private.crm_payment_allocations a on a.sale_id=s.id
    where s.shift_id=p_shift and a.voided_at is null
   union all
   select r.cash from private.crm_receipts_v10 r
    where r.shift_id=p_shift and r.voided_at is null and not r.is_debt_repayment
  ) e;
 end if;
 select coalesce(sum(amount) filter(where type='salary'),0),coalesce(sum(amount) filter(where type='cash_in'),0),
  coalesce(sum(amount) filter(where type in('expense','refund','owner_withdrawal')),0)
  into salary_n,in_n,out_n from private.crm_cash_movements_v30 where shift_id=p_shift and voided_at is null;
 if opening_n is not null then balance_n:=opening_n+cash_n+in_n-salary_n-out_n;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'type',m.type,'amount',m.amount,'reason',m.reason,
  'staff_id',m.staff_id,'staff_name',st.full_name,'created_at',m.created_at,'voided_at',m.voided_at,'void_reason',m.void_reason)
  order by m.created_at,m.id),'[]') into movements_n
  from private.crm_cash_movements_v30 m left join public.staff st on st.id=m.staff_id where m.shift_id=p_shift;
 select coalesce(jsonb_agg(jsonb_build_object('staff_id',w.staff_id,'staff_name',st.full_name,'configured',w.amount,
  'paid',coalesce(p.paid,0),'outstanding',greatest(w.amount-coalesce(p.paid,0),0),
  'overpaid',greatest(coalesce(p.paid,0)-w.amount,0)) order by st.full_name,w.staff_id),'[]') into payroll_n
  from private.crm_shift_payroll w join public.staff st on st.id=w.staff_id left join lateral(
   select sum(amount) paid from private.crm_cash_movements_v30 m
    where m.shift_id=w.shift_id and m.staff_id=w.staff_id and m.type='salary' and m.voided_at is null
  ) p on true where w.shift_id=p_shift;
 return jsonb_build_object('shift_id',p_shift,'scope','shift','opening_confirmed',opening_n is not null,'opening',opening_n,
  'received_cash',cash_n,'salary_paid',salary_n,'cash_in',in_n,'cash_out',out_n,'balance',balance_n,
  'balance_negative',coalesce(balance_n<0,false),'movements',movements_n,'payroll',payroll_n,
  'formula','opening + received_cash + cash_in - salary_paid - cash_out');
end $$;
revoke all on function private.crm_cash_drawer_facts_v30(uuid,numeric) from public,anon,authenticated;

create function private.crm_cash_drawers_period_v30(p_shifts jsonb,p_entity_filter boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare list_n jsonb;latest_n jsonb;totals_n jsonb;count_n integer;
begin
 if p_entity_filter then return jsonb_build_object('cash_drawer',jsonb_build_object('scope','not_applicable_to_entity_filter',
  'opening_confirmed',false,'opening',null,'balance',null),'cash_drawers','[]'::jsonb);end if;
 select coalesce(jsonb_agg(jsonb_build_object('shift_id',s.id,'date',s.shift_date,'started_at',s.started_at,
  'status',s.status,'cash_drawer',private.crm_cash_drawer_facts_v30(s.id)) order by s.shift_date desc,s.started_at desc,s.id desc),'[]')
  into list_n from public.shifts s where s.id in(select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_shifts,'[]')) v);
 count_n:=jsonb_array_length(list_n);
 latest_n:=case when count_n>0 then list_n->0->'cash_drawer' else jsonb_build_object('opening_confirmed',false,'opening',null,'balance',null) end;
 latest_n:=latest_n||jsonb_build_object('scope',case when count_n>1 then 'latest_shift' when count_n=1 then 'shift' else 'no_shifts' end,'shift_count',count_n);
 select jsonb_build_object('received_cash',coalesce(sum((v->'cash_drawer'->>'received_cash')::numeric),0),
  'salary_paid',coalesce(sum((v->'cash_drawer'->>'salary_paid')::numeric),0),
  'cash_in',coalesce(sum((v->'cash_drawer'->>'cash_in')::numeric),0),'cash_out',coalesce(sum((v->'cash_drawer'->>'cash_out')::numeric),0))
  into totals_n from jsonb_array_elements(list_n) v;
 return jsonb_build_object('cash_drawer',latest_n,'cash_drawers',list_n,'cash_drawer_period_totals',totals_n);
end $$;
revoke all on function private.crm_cash_drawers_period_v30(jsonb,boolean) from public,anon,authenticated;

create function private.crm_cash_drawer_v30(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor_n uuid;role_n text;shift_n uuid;status_n text;req_n private.crm_cash_requests_v30%rowtype;
 amount_n numeric;reason_n text;staff_n uuid;type_n text;id_n uuid;before_n jsonb;answer_n jsonb;drawer_n jsonb;
 salary_n numeric;paid_n numeric;opening_exists_n boolean;
begin
 select id,role into actor_n,role_n from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor_n is null or role_n not in('owner','admin','nurse') then raise exception 'Нет доступа' using errcode='42501';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or p_action is null then raise exception 'Проверьте параметры кассы';end if;
 shift_n:=nullif(p_payload->>'shift_id','')::uuid;
 select status into status_n from public.shifts where id=shift_n;
 if not found then raise exception 'Смена не найдена';end if;
 if role_n='nurse' and not exists(select 1 from public.shift_staff where shift_id=shift_n and staff_id=actor_n) then raise exception 'Нет доступа к кассе этой смены' using errcode='42501';end if;
 if p_action='status' then return private.crm_cash_drawer_facts_v30(shift_n);end if;
 if p_action not in('opening_set','movement_add','movement_void') or p_request_id is null then raise exception 'Укажите операцию и её номер';end if;
 insert into private.crm_cash_requests_v30(request_id,actor_user,action,payload) values(p_request_id,auth.uid(),p_action,p_payload) on conflict do nothing;
 select * into req_n from private.crm_cash_requests_v30 where request_id=p_request_id for update;
 if req_n.actor_user is distinct from auth.uid() or req_n.action is distinct from p_action or req_n.payload is distinct from p_payload then raise exception 'Номер операции уже использован';end if;
 if req_n.result is not null then return req_n.result;end if;
 select status into status_n from public.shifts where id=shift_n for update;
 if role_n='nurse' and status_n<>'open' then raise exception 'Закрытую кассу изменяет только администратор' using errcode='42501';end if;
 reason_n:=nullif(trim(p_payload->>'reason'),'');
 if reason_n is null or length(reason_n)>2000 then raise exception 'Укажите причину кассовой операции (до 2000 символов)';end if;
 drawer_n:=private.crm_cash_drawer_facts_v30(shift_n);
 if p_action in('opening_set','movement_add') then
  if jsonb_typeof(p_payload->'amount') not in('number','string') then raise exception 'Укажите сумму';end if;
  amount_n:=nullif(p_payload->>'amount','')::numeric;
  if amount_n is null or amount_n::text in('NaN','Infinity','-Infinity') or amount_n<>round(amount_n,2)
   or amount_n<0 or amount_n>999999999999.99 or(p_action='movement_add' and amount_n=0) then
   raise exception 'Сумма должна быть с точностью до копейки; выдача или внесение — больше нуля';end if;
 end if;
 if p_action='opening_set' then
  select to_jsonb(o) into before_n from private.crm_cash_openings_v30 o where shift_id=shift_n;
  opening_exists_n:=found;
  if role_n='nurse' and opening_exists_n then raise exception 'Начальный остаток уже подтверждён. Исправить может администратор' using errcode='42501';end if;
  if amount_n+(drawer_n->>'received_cash')::numeric+(drawer_n->>'cash_in')::numeric
   -(drawer_n->>'salary_paid')::numeric-(drawer_n->>'cash_out')::numeric<0 then raise exception 'С указанным начальным остатком касса станет отрицательной';end if;
  insert into private.crm_cash_openings_v30(shift_id,amount,reason,created_by,updated_by) values(shift_n,amount_n,reason_n,auth.uid(),auth.uid())
   on conflict(shift_id) do update set amount=excluded.amount,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
 elsif p_action='movement_add' then
  if not(drawer_n->>'opening_confirmed')::boolean then raise exception 'Сначала подтвердите начальный остаток наличных';end if;
  type_n:=p_payload->>'type';staff_n:=nullif(p_payload->>'staff_id','')::uuid;
  if type_n is null or type_n not in('salary','cash_in','expense','refund','owner_withdrawal') then raise exception 'Выберите вид кассовой операции';end if;
  if type_n='salary' then
   select amount into salary_n from private.crm_shift_payroll where shift_id=shift_n and staff_id=staff_n for update;
   if not found or not exists(select 1 from public.shift_staff where shift_id=shift_n and staff_id=staff_n) then raise exception 'Выберите медсестру этой смены с назначенной зарплатой';end if;
   select coalesce(sum(amount),0) into paid_n from private.crm_cash_movements_v30
    where shift_id=shift_n and staff_id=staff_n and type='salary' and voided_at is null;
   if amount_n>salary_n-paid_n then raise exception 'Сумма больше невыплаченной зарплаты: % ₽',greatest(salary_n-paid_n,0);end if;
  elsif staff_n is not null then raise exception 'Сотрудник указывается только при выплате зарплаты';end if;
  if type_n<>'cash_in' then
   if amount_n>(drawer_n->>'balance')::numeric then raise exception 'В кассе недостаточно наличных: % ₽',drawer_n->>'balance';end if;
  end if;
  insert into private.crm_cash_movements_v30(id,shift_id,type,amount,reason,staff_id,created_by)
   values(p_request_id,shift_n,type_n,amount_n,reason_n,staff_n,auth.uid());
 else
  if role_n='nurse' then raise exception 'Отменить кассовую операцию может только администратор' using errcode='42501';end if;
  id_n:=nullif(p_payload->>'id','')::uuid;
  select to_jsonb(m) into before_n from private.crm_cash_movements_v30 m where id=id_n and shift_id=shift_n for update;
  if not found then raise exception 'Кассовая операция не найдена';end if;
  if before_n->>'voided_at' is not null then raise exception 'Кассовая операция уже отменена';end if;
  if before_n->>'type'='cash_in' and (before_n->>'amount')::numeric>(drawer_n->>'balance')::numeric then
   raise exception 'Нельзя отменить внесение: наличные уже выданы из кассы';end if;
  update private.crm_cash_movements_v30 set voided_at=now(),voided_by=auth.uid(),void_reason=reason_n where id=id_n;
 end if;
 answer_n:=private.crm_cash_drawer_facts_v30(shift_n);
 if p_action='movement_add' then answer_n:=answer_n||jsonb_build_object('movement_id',p_request_id);end if;
 perform private.crm_audit_v5('cash_drawer_'||p_action||'_v30','shift',shift_n::text,before_n,answer_n,reason_n);
 update private.crm_cash_requests_v30 set result=answer_n where request_id=p_request_id;
 return answer_n;
end $$;
revoke all on function private.crm_cash_drawer_v30(text,jsonb,uuid) from public,anon;
grant execute on function private.crm_cash_drawer_v30(text,jsonb,uuid) to authenticated;
create function public.crm_cash_drawer_v30(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$select private.crm_cash_drawer_v30(p_action,p_payload,p_request_id);$$;
revoke all on function public.crm_cash_drawer_v30(text,jsonb,uuid) from public,anon;
grant execute on function public.crm_cash_drawer_v30(text,jsonb,uuid) to authenticated;

create or replace function private.crm_build_shift_report_v5(p_shift uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare answer_n jsonb;drawer_n jsonb;
begin
 answer_n:=private.crm_build_shift_report_v5_before_v30(p_shift);
 drawer_n:=private.crm_cash_drawer_facts_v30(p_shift,(answer_n->'revenue'->>'cash')::numeric);
 return answer_n||jsonb_build_object('cash_drawer',drawer_n,'cash_after_salary',drawer_n->'balance','cash_after_salary_semantics','actual_cash_balance');
end $$;

create or replace function private.crm_finance_summary_v5(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer_n jsonb;drawers_n jsonb;entity_n boolean;
begin
 answer_n:=private.crm_finance_summary_v5_before_v30(p_payload);
 entity_n:=nullif(p_payload->>'patient_id','') is not null or nullif(p_payload->>'medication_id','') is not null or nullif(p_payload->>'service_id','') is not null;
 drawers_n:=private.crm_cash_drawers_period_v30(answer_n->'shifts',entity_n);
 return answer_n||drawers_n||jsonb_build_object('cash_after_salary',drawers_n->'cash_drawer'->'balance','cash_after_salary_semantics','actual_cash_balance');
end $$;

create or replace function private.crm_finance_v5(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer_n jsonb;drawer_n jsonb;shift_n uuid;paid_n numeric;
begin
 -- Preserve the existing authorization before exposing the cash overlay.
 if p_action='salary' and private.is_manager() then
  shift_n:=nullif(p_payload->>'shift_id','')::uuid;
  perform 1 from public.shifts where id=shift_n for update;
  select coalesce(sum(amount),0) into paid_n from private.crm_cash_movements_v30
   where shift_id=shift_n and staff_id=nullif(p_payload->>'staff_id','')::uuid and type='salary' and voided_at is null;
  if (p_payload->>'amount')::numeric<paid_n then raise exception 'Зарплата не может быть меньше уже выданных наличных: % ₽',paid_n;end if;
 end if;
 answer_n:=private.crm_finance_v5_before_v30(p_action,p_payload);
 if p_action in('shift_report','close','salary') then
  shift_n:=nullif(p_payload->>'shift_id','')::uuid;
  drawer_n:=private.crm_cash_drawer_facts_v30(shift_n,(answer_n->'revenue'->>'cash')::numeric);
  return answer_n||jsonb_build_object('cash_drawer',drawer_n,'cash_after_salary',drawer_n->'balance','cash_after_salary_semantics','actual_cash_balance');
 end if;
 return answer_n;
end $$;

create or replace function private.crm_dashboard_day_v25(p_date date default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer_n jsonb;shifts_n jsonb;drawers_n jsonb;day_n date;
begin
 answer_n:=private.crm_dashboard_day_v25_before_v30(p_date);
 day_n:=(answer_n->>'date')::date;
 select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') into shifts_n from public.shifts where shift_date=day_n;
 drawers_n:=private.crm_cash_drawers_period_v30(shifts_n,false);
 return answer_n||drawers_n||jsonb_build_object('working_day',(answer_n->'working_day')||drawers_n||
  jsonb_build_object('cash_after_salary',drawers_n->'cash_drawer'->'balance','cash_after_salary_semantics','actual_cash_balance'));
end $$;

-- Extend the existing, explicit backup whitelist without changing grants.
do $backup$
declare source_n text;anchor_n text:=$anchor$'crm_shift_reports'$anchor$;table_n text;hits_n integer;
begin
 source_n:=pg_get_functiondef('private.crm_backup_data_v5()'::regprocedure);
 hits_n:=(length(source_n)-length(replace(source_n,anchor_n,'')))/length(anchor_n);
 if hits_n<>1 then raise exception 'Unexpected cash backup whitelist anchor: %',hits_n;end if;
 foreach table_n in array array['crm_cash_openings_v30','crm_cash_movements_v30','crm_cash_requests_v30'] loop
  if position(quote_literal(table_n) in source_n)>0 then raise exception 'Cash backup entry already exists: %',table_n;end if;
  source_n:=replace(source_n,anchor_n,anchor_n||','||quote_literal(table_n));
 end loop;
 execute source_n;
end $backup$;

notify pgrst,'reload schema';
commit;
