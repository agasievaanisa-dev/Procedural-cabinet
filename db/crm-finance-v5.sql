-- CRM ТЗ 3.0: atomic payment allocation, fixed shift payroll and closed reports.
-- Apply after crm-management-v5.sql. Old receipts stay unclassified: no backfill guesses.
begin;

create table if not exists private.crm_finance_settings (
 id boolean primary key default true check (id),
 float_amount numeric(14,2) not null default 50000 check (float_amount>=0),
 time_zone text not null default 'Europe/Moscow',
 updated_by uuid, updated_at timestamptz not null default now()
);
insert into private.crm_finance_settings(id) values(true) on conflict do nothing;
create table if not exists private.crm_payment_allocations (
 id uuid primary key references private.warehouse_requests(id),
 kind text not null check(kind in ('procedure','sale')),
 procedure_id uuid unique references public.procedures(id),
 sale_id uuid unique references public.sales(id),
 cash numeric(14,2) not null check(cash>=0),
 terminal numeric(14,2) not null check(terminal>=0),
 owner_card numeric(14,2) not null check(owner_card>=0),
 cash_received numeric(14,2) not null check(cash_received>=cash),
 change_amount numeric(14,2) not null check(change_amount=cash_received-cash),
 created_by uuid not null, created_at timestamptz not null default now(),
 check((kind='procedure' and procedure_id is not null and sale_id is null)
    or (kind='sale' and sale_id is not null and procedure_id is null))
);
create table if not exists private.crm_shift_payroll (
 shift_id uuid not null references public.shifts(id),
 staff_id uuid not null references public.staff(id),
 amount numeric(14,2) not null default 2000 check(amount>=0),
 reason text, updated_by uuid, updated_at timestamptz not null default now(),
 primary key(shift_id,staff_id)
);
create table if not exists private.crm_shift_reports (
 shift_id uuid primary key references public.shifts(id),
 report jsonb not null, closed_by uuid, closed_at timestamptz not null default now()
);
alter table private.crm_finance_settings enable row level security;
alter table private.crm_payment_allocations enable row level security;
alter table private.crm_shift_payroll enable row level security;
alter table private.crm_shift_reports enable row level security;
revoke all on private.crm_finance_settings,private.crm_payment_allocations,private.crm_shift_payroll,private.crm_shift_reports from public,anon,authenticated;

alter table public.shifts add column if not exists daily_slot smallint check(daily_slot in (1,2));
-- Preserve legacy days containing more than two shifts without inventing slot assignments.
with ranked as (
 select id,row_number() over(partition by shift_date order by started_at,id) slot,
 count(*) over(partition by shift_date) cnt from public.shifts
)
update public.shifts s set daily_slot=r.slot from ranked r where s.id=r.id and r.cnt<=2 and s.daily_slot is null;
create unique index if not exists shifts_daily_slot_v5 on public.shifts(shift_date,daily_slot) where daily_slot is not null;
create index if not exists procedures_visit_finance_v5 on public.procedures(visit_at);
create index if not exists sales_sold_finance_v5 on public.sales(sold_at);
create index if not exists procedures_shift_finance_v5 on public.procedures(shift_id);
create index if not exists sales_shift_finance_v5 on public.sales(shift_id);
create index if not exists shift_staff_shift_finance_v5 on public.shift_staff(shift_id);

create or replace function private.crm_shift_slot_v5()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.shift_date is null then raise exception 'Укажите дату смены';end if;
 perform pg_advisory_xact_lock(513005,(new.shift_date-date '2000-01-01')::integer);
 if (select count(*) from public.shifts where shift_date=new.shift_date)>=2 then raise exception 'В этот день уже созданы две смены';end if;
 select x into new.daily_slot from generate_series(1,2) x
 where not exists(select 1 from public.shifts where shift_date=new.shift_date and daily_slot=x) order by x limit 1;
 return new;
end $$;
drop trigger if exists crm_shift_slot_v5 on public.shifts;
create trigger crm_shift_slot_v5 before insert on public.shifts for each row execute function private.crm_shift_slot_v5();

create or replace function private.crm_shift_payroll_default_v5()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.shifts where id=new.shift_id and status='open' for update;
 if not found then raise exception 'Сотрудников можно выбирать только в открытой смене';end if;
 if not exists(select 1 from public.staff where id=new.staff_id and active and role='nurse') then raise exception 'Выберите действующую медсестру';end if;
 if(select count(*) from public.shift_staff where shift_id=new.shift_id)>2 then raise exception 'В смене работают две медсестры';end if;
 if(select count(*) from public.shift_staff where shift_id=new.shift_id and staff_id=new.staff_id)>1 then raise exception 'Медсестра уже входит в смену';end if;
 insert into private.crm_shift_payroll(shift_id,staff_id) values(new.shift_id,new.staff_id) on conflict do nothing;
 return new;
end $$;
drop trigger if exists crm_shift_payroll_default_v5 on public.shift_staff;
create trigger crm_shift_payroll_default_v5 after insert on public.shift_staff for each row execute function private.crm_shift_payroll_default_v5();
-- Existing wages are deliberately not backfilled. Historical payroll stays unknown
-- until the owner records a justified retrospective amount.

create or replace function private.crm_redact_finance_v5(p_value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare answer jsonb; v jsonb; k text; cleaned jsonb;
begin
 if jsonb_typeof(p_value)='object' then
  if p_value->>'scope'='reserve' then return null;end if;
  answer:='{}';
  for k,v in select key,value from jsonb_each(p_value) loop
   if k=any(array['revenue','payroll_total','payroll_closed','payroll_open','payroll_unknown','payroll_complete','cash_after_salary','float_amount','amount','reason','list_total','discount_amount','discount_percent','discount_reason','discount_comment','paid_total','paid','discount','procedures_total','sales_total','cash_total','total','unit_price','line_total','purchase_price','reserve','min_total_stock']) then continue;end if;
   answer:=answer||jsonb_build_object(k,private.crm_redact_finance_v5(v));
  end loop;
  return answer;
 elsif jsonb_typeof(p_value)='array' then
  answer:='[]';
  for v in select value from jsonb_array_elements(p_value) loop
   cleaned:=private.crm_redact_finance_v5(v);
   if cleaned is not null then answer:=answer||jsonb_build_array(cleaned);end if;
  end loop;
  return answer;
 end if;
 return p_value;
end $$;

create or replace function private.record_treatment_v5(p_kind text,p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; role_name text; sh uuid; item record; req private.warehouse_requests%rowtype;
 pay jsonb:=p_payload->'payments'; cash_n numeric; terminal_n numeric; card_n numeric; received_n numeric;
 answer jsonb; result_id uuid; paid_n numeric; list_n numeric; reserve_n boolean:=coalesce((p_payload->>'reserve_sale')::boolean,false);
 available_n numeric; missing_n numeric; saved private.crm_payment_allocations%rowtype;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if p_kind is null or p_kind not in ('procedure','sale') or p_request_id is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Проверьте операцию';end if;
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
  return jsonb_build_object('id',coalesce(saved.procedure_id,saved.sale_id),'paid_total',saved.cash+saved.terminal+saved.owner_card,
   'payments',jsonb_build_object('cash',saved.cash,'terminal',saved.terminal,'owner_card',saved.owner_card,'cash_received',saved.cash_received,'change',saved.change_amount));
 end if;
 if req.result is not null then raise exception 'Эта операция была сохранена без распределения оплаты. Создайте новую операцию';end if;
 sh:=(p_payload->>'shift_id')::uuid;
 perform 1 from public.shifts where id=sh and status='open' for update;
 if not found then raise exception 'Смена закрыта или не выбрана';end if;
 if role_name='nurse' and not exists(select 1 from public.shift_staff where shift_id=sh and staff_id=actor) then raise exception 'Нет доступа к этой смене';end if;
 if nullif(p_payload->>'patient_id','') is not null then
  perform 1 from public.patients where id=(p_payload->>'patient_id')::uuid and not archived for share;
  if not found then raise exception 'Пациент не найден или находится в архиве. Владелец должен восстановить карточку';end if;
 end if;
 if jsonb_typeof(coalesce(p_payload->'items','[]'))<>'array' then raise exception 'Проверьте список препаратов';end if;
 if reserve_n then
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
 if p_kind='procedure' then select paid_total,list_total into paid_n,list_n from public.procedures where id=result_id;
 else select paid_total,list_total into paid_n,list_n from public.sales where id=result_id;end if;
 if role_name='nurse' and paid_n<>list_n then raise exception 'Скидку может назначить только владелец';end if;
 if cash_n+terminal_n+card_n<>paid_n then raise exception 'Сумма способов оплаты должна совпадать со стоимостью: % ₽',paid_n;end if;
 insert into private.crm_payment_allocations(id,kind,procedure_id,sale_id,cash,terminal,owner_card,cash_received,change_amount,created_by)
 values(p_request_id,p_kind,case when p_kind='procedure' then result_id end,case when p_kind='sale' then result_id end,cash_n,terminal_n,card_n,received_n,received_n-cash_n,auth.uid());
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,after_data)
 values(auth.uid(),actor,'payment_recorded',p_kind,result_id::text,jsonb_build_object('paid_total',paid_n,'cash',cash_n,'terminal',terminal_n,'owner_card',card_n,'cash_received',received_n,'change',received_n-cash_n,'reserve_sale',reserve_n));
 return jsonb_build_object('id',result_id,'paid_total',paid_n,'payments',jsonb_build_object('cash',cash_n,'terminal',terminal_n,'owner_card',card_n,'cash_received',received_n,'change',received_n-cash_n));
end $$;

create or replace function private.crm_build_shift_report_v5(p_shift uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare answer jsonb; revenue_n jsonb; wages_n numeric; unknown_n integer;
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
 select jsonb_build_object(
  'shift',(select jsonb_build_object('id',id,'date',shift_date,'started_at',started_at,'planned_end_at',planned_end_at,'ended_at',ended_at,'status',status,'slot',daily_slot) from public.shifts where id=p_shift),
  'staff',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=p_shift),'[]'),
  'patients_count',(select count(distinct patient_id) from(select patient_id from public.procedures where shift_id=p_shift union all select patient_id from public.sales where shift_id=p_shift) e),
  'procedures_count',(select count(*) from public.procedures where shift_id=p_shift),
  'sales_count',(select count(*) from public.sales where shift_id=p_shift),
  'procedures_total',coalesce((select sum(paid_total) from public.procedures where shift_id=p_shift),0),
  'sales_total',coalesce((select sum(paid_total) from public.sales where shift_id=p_shift),0),
  'cash_total',revenue_n->'total','revenue',revenue_n,'payroll_total',wages_n,'payroll_unknown',unknown_n,'payroll_complete',unknown_n=0,
  'cash_after_salary',case when unknown_n=0 then (revenue_n->>'total')::numeric-wages_n end,
  'procedures',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'at',p.visit_at,'patient_id',p.patient_id,'patient',pt.full_name,'nurse',st.full_name,'type',p.procedure_type,'notes',p.notes,
   'list_total',p.list_total,'discount_amount',p.discount_amount,'paid_total',p.paid_total,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'line_total',pm.line_total) order by m.name) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]')) order by p.visit_at,p.id)
   from public.procedures p left join public.patients pt on pt.id=p.patient_id left join public.staff st on st.id=p.nurse_id where p.shift_id=p_shift),'[]'),
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'at',s.sold_at,'patient_id',s.patient_id,'patient',coalesce(pt.full_name,'Без пациента'),'nurse',st.full_name,'notes',s.notes,
   'list_total',s.list_total,'discount_amount',s.discount_amount,'paid_total',s.paid_total,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'line_total',si.line_total) order by m.name) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]')) order by s.sold_at,s.id)
   from public.sales s left join public.patients pt on pt.id=s.patient_id left join public.staff st on st.id=s.nurse_id where s.shift_id=p_shift),'[]'),
  'used',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.consumption_unit,'procedure_qty',u.proc,'sale_qty',u.sale,'quantity',u.proc+u.sale) order by m.name)
   from(select medication_id,sum(proc) proc,sum(sale) sale from(
    select pm.medication_id,pm.quantity proc,0::numeric sale from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id where p.shift_id=p_shift
    union all select si.medication_id,0,si.quantity from public.sale_items si join public.sales s on s.id=si.sale_id where s.shift_id=p_shift
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
  ) alerts),'[]')
 ) into answer;
 return answer;
end $$;

create or replace function private.crm_finance_summary_v5(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
  select 'procedure' kind,p.id,p.shift_id,p.nurse_id,p.patient_id,p.service_id,p.procedure_type service_name,p.visit_at at,p.list_total,p.paid_total from public.procedures p
  where p.visit_at>=first_day::timestamp at time zone tz and p.visit_at<(last_day+1)::timestamp at time zone tz
  union all select 'sale',s.id,s.shift_id,s.nurse_id,s.patient_id,null,'Продажа препаратов',s.sold_at,s.list_total,s.paid_total from public.sales s
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
   sum(quantity) quantity,round(sum(cash*share),2) cash,round(sum(terminal*share),2) terminal,round(sum(owner_card*share),2) owner_card,round(sum(unclassified*share),2) unclassified,round(sum(paid_total*share),2) total
  from grouped_source group by group_id,label
 )
 select jsonb_build_object('from',first_day,'to',last_day,'time_zone',tz,'group_by',grouping,
  'patients_count',(select count(distinct patient_id) from filtered),'procedures_count',(select count(*) from filtered where kind='procedure'),'sales_count',(select count(*) from filtered where kind='sale'),
  'revenue',(select jsonb_build_object('cash',coalesce(sum(cash),0),'terminal',coalesce(sum(terminal),0),'owner_card',coalesce(sum(owner_card),0),'unclassified',coalesce(sum(unclassified),0),'total',coalesce(sum(paid_total),0)) from filtered),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',group_id,'label',label,'patients_count',patients_count,'procedures_count',procedures_count,'sales_count',sales_count,'quantity',quantity,
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
end $$;

create or replace function private.crm_finance_v5(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; role_name text; sh uuid; staff_n uuid; wage numeric; old_n jsonb; new_n jsonb; answer jsonb; settings_n private.crm_finance_settings%rowtype; reason_n text; payroll_n numeric; unknown_n integer;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if jsonb_typeof(p_payload)<>'object' then raise exception 'Проверьте параметры';end if;
 if p_action='summary' then return private.crm_finance_summary_v5(p_payload);end if;
 if p_action in ('settings_get','settings_save') then
  if role_name='nurse' then raise exception 'Настройки доступны только владельцу';end if;
  select * into settings_n from private.crm_finance_settings where id for update;
  old_n:=to_jsonb(settings_n)-'updated_by'-'updated_at'-'id';
  if p_action='settings_save' then
   wage:=coalesce((p_payload->>'float_amount')::numeric,settings_n.float_amount);
   if wage<0 or wage<>round(wage,2) or wage::text in ('NaN','Infinity','-Infinity') or wage>999999999999.99 then raise exception 'Проверьте разменный фонд';end if;
   if coalesce(p_payload->>'time_zone',settings_n.time_zone)<>'Europe/Moscow' then raise exception 'Учёт смен и сроков годности ведётся по московскому времени';end if;
   update private.crm_finance_settings set float_amount=wage,time_zone=coalesce(p_payload->>'time_zone',time_zone),updated_by=auth.uid(),updated_at=now() where id returning * into settings_n;
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
end $$;

create or replace function public.record_treatment_v5(p_kind text,p_payload jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.record_treatment_v5(p_kind,p_payload,p_request_id); $$;
create or replace function public.crm_finance_v5(p_action text,p_payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select private.crm_finance_v5(p_action,p_payload); $$;

-- Direct nurse reads of the old clinical tables disclosed paid totals across all shifts.
-- Mutations now use checked, atomic RPCs so stock and payments cannot be bypassed.
drop policy if exists nurse_procedures_select on public.procedures;
drop policy if exists nurse_procedures_insert_own on public.procedures;
drop policy if exists nurse_procedures_update_own on public.procedures;
drop policy if exists nurse_procedure_medications_select on public.procedure_medications;
drop policy if exists nurse_procedure_medications_insert on public.procedure_medications;
drop policy if exists nurse_procedure_medications_update on public.procedure_medications;
drop policy if exists nurse_sales_select on public.sales;
drop policy if exists nurse_sales_insert_own on public.sales;
drop policy if exists nurse_sales_update_own on public.sales;
drop policy if exists nurse_sale_items_select on public.sale_items;
drop policy if exists nurse_sale_items_insert on public.sale_items;
drop policy if exists nurse_sale_items_update on public.sale_items;
drop policy if exists nurse_shift_staff_insert on public.shift_staff;

-- Compatibility wrappers keep currently deployed clients operational with safe reports.
create or replace function public.shift_report_detailed_test(p_shift_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.crm_finance_v5('shift_report',jsonb_build_object('shift_id',p_shift_id)); $$;
create or replace function public.shift_report_v8(p_shift_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.crm_finance_v5('shift_report',jsonb_build_object('shift_id',p_shift_id)); $$;
create or replace function public.close_shift_v8(p_shift_id uuid)
returns void language plpgsql security invoker set search_path='' as $$ begin perform private.crm_finance_v5('close',jsonb_build_object('shift_id',p_shift_id));end $$;

create or replace function private.crm_patient_history_v5(p_patient uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; role_name text; answer jsonb;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if not exists(select 1 from public.patients where id=p_patient) then raise exception 'Пациент не найден';end if;
 select jsonb_build_object(
  'procedures',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'visit_at',p.visit_at,'procedure_type',p.procedure_type,'nurse',st.full_name,'notes',p.notes,'list_total',p.list_total,'discount_amount',p.discount_amount,'paid_total',p.paid_total,
   'medications',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'line_total',pm.line_total) order by m.name) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]')) order by p.visit_at desc,p.id)
   from public.procedures p left join public.staff st on st.id=p.nurse_id where p.patient_id=p_patient),'[]'),
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'sold_at',s.sold_at,'nurse',st.full_name,'notes',s.notes,'list_total',s.list_total,'discount_amount',s.discount_amount,'paid_total',s.paid_total,
   'items',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'line_total',si.line_total) order by m.name) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]')) order by s.sold_at desc,s.id)
   from public.sales s left join public.staff st on st.id=s.nurse_id where s.patient_id=p_patient),'[]')
 ) into answer;
 if role_name='nurse' then return private.crm_redact_finance_v5(answer);end if;
 return answer;
end $$;
create or replace function public.patient_history_v8(p_patient_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.crm_patient_history_v5(p_patient_id); $$;

-- Legacy treatment RPCs still enforce server prices and FEFO. Block nurse discounts
-- for every old entry point until clients move to the allocated v5 payment editor.
create or replace function private.crm_no_nurse_discount_v5()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.current_staff_role()='nurse' and (new.paid_total<>new.list_total or coalesce(new.discount_amount,0)<>0) then raise exception 'Скидку может назначить только владелец';end if;
 return new;
end $$;
drop trigger if exists crm_no_nurse_discount_v5 on public.procedures;
create trigger crm_no_nurse_discount_v5 before insert or update on public.procedures for each row execute function private.crm_no_nurse_discount_v5();
drop trigger if exists crm_no_nurse_discount_v5 on public.sales;
create trigger crm_no_nurse_discount_v5 before insert or update on public.sales for each row execute function private.crm_no_nurse_discount_v5();

-- Remove obsolete user-price clinical entry points, leaving v3 and service-based
-- compatibility RPCs available while the frontend release activates.
revoke execute on function public.save_procedure(uuid,uuid,uuid,text),public.save_procedure_v8(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text,text,jsonb),public.save_sale_v8(uuid,uuid,uuid,numeric,text,text,text,jsonb) from public,anon,authenticated;

revoke all on function private.crm_shift_slot_v5(),private.crm_shift_payroll_default_v5(),private.crm_redact_finance_v5(jsonb),private.crm_build_shift_report_v5(uuid),private.crm_no_nurse_discount_v5() from public,anon,authenticated;
revoke all on function private.record_treatment_v5(text,jsonb,uuid),private.crm_finance_summary_v5(jsonb),private.crm_finance_v5(text,jsonb),private.crm_patient_history_v5(uuid) from public,anon;
grant execute on function private.record_treatment_v5(text,jsonb,uuid),private.crm_finance_v5(text,jsonb),private.crm_patient_history_v5(uuid) to authenticated;
revoke all on function private.crm_finance_summary_v5(jsonb) from authenticated;
revoke all on function public.record_treatment_v5(text,jsonb,uuid),public.crm_finance_v5(text,jsonb),public.shift_report_detailed_test(uuid),public.shift_report_v8(uuid),public.close_shift_v8(uuid),public.patient_history_v8(uuid) from public,anon;
grant execute on function public.record_treatment_v5(text,jsonb,uuid),public.crm_finance_v5(text,jsonb),public.shift_report_detailed_test(uuid),public.shift_report_v8(uuid),public.close_shift_v8(uuid),public.patient_history_v8(uuid) to authenticated;

-- quick_ui_v4 context/favorites/repeat stay unchanged; report/close route through v5.
do $$ declare definition text;
begin
 select pg_get_functiondef('private.quick_ui_v4(text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'if p_action=''close'' then perform public.close_shift_v8(sh);end if;',
  'return private.crm_finance_v5(case when p_action=''close'' then ''close'' else ''shift_report'' end,p_payload);');
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
