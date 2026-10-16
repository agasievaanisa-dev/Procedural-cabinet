-- Automatic salary allowance in shift cash summaries. Apply after v30.
-- This is a read-only calculation: actual cash movements, payroll assignments,
-- unknown openings and the physical balance used by mutation guards stay intact.
begin;
set local lock_timeout='10s';
do $$begin
 if to_regprocedure('private.crm_cash_drawer_facts_v30(uuid,numeric)') is null
  or to_regprocedure('private.crm_cash_drawers_period_v30(jsonb,boolean)') is null then
  raise exception 'Apply crm-cash-drawer-v30.sql before crm-auto-salary-v36.sql';
 end if;
end $$;

create or replace function private.crm_cash_drawer_facts_v30(p_shift uuid,p_received_cash numeric default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare opening_n numeric;cash_n numeric;salary_n numeric;in_n numeric;out_n numeric;balance_n numeric;
 movements_n jsonb;payroll_n jsonb;auto_payroll_n jsonb;target_n numeric;remaining_n numeric;deduction_n numeric;
begin
 select amount into opening_n from private.crm_cash_openings_v30 where shift_id=p_shift;
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
 -- Keep physical cash and its null/unknown opening unchanged for all v30 guards.
 if opening_n is not null then balance_n:=opening_n+cash_n+in_n-salary_n-out_n;end if;
 with assigned as (
  select distinct staff_id from public.shift_staff where shift_id=p_shift
 ), targets as (
  select a.staff_id,st.full_name staff_name,
   case when w.staff_id is not null then w.amount when st.role='nurse' then 2000 else 0 end target,
   case when w.staff_id is not null then 'assigned' else 'default' end source
   from assigned a join public.staff st on st.id=a.staff_id
   left join private.crm_shift_payroll w on w.shift_id=p_shift and w.staff_id=a.staff_id
 ), paid as (
  select staff_id,sum(amount) amount from private.crm_cash_movements_v30
   where shift_id=p_shift and type='salary' and voided_at is null group by staff_id
 )
 select coalesce(sum(t.target),0),coalesce(sum(greatest(t.target-coalesce(p.amount,0),0)),0),
  coalesce(jsonb_agg(jsonb_build_object('staff_id',t.staff_id,'staff_name',t.staff_name,'configured',t.target,
   'paid',coalesce(p.amount,0),'outstanding',greatest(t.target-coalesce(p.amount,0),0),
   'overpaid',greatest(coalesce(p.amount,0)-t.target,0),'source',t.source) order by t.staff_name,t.staff_id),'[]')
  into target_n,remaining_n,auto_payroll_n from targets t left join paid p on p.staff_id=t.staff_id;
 -- Calculate per employee: an overpayment to one never pays another's salary.
 -- Historical payouts to a former shift member still reduce physical cash.
 deduction_n:=salary_n+remaining_n;
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
  'formula','opening + received_cash + cash_in - salary_paid - cash_out',
  'salary_auto',true,'salary_auto_payroll',auto_payroll_n,'salary_auto_total',target_n,'salary_auto_remaining',remaining_n,'salary_deduction',deduction_n,
  'cash_after_salary_auto',coalesce(opening_n,0)+cash_n+in_n-out_n-deduction_n);
end $$;
revoke all on function private.crm_cash_drawer_facts_v30(uuid,numeric) from public,anon,authenticated;

create or replace function private.crm_cash_drawers_period_v30(p_shifts jsonb,p_entity_filter boolean default false) returns jsonb
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
  'cash_in',coalesce(sum((v->'cash_drawer'->>'cash_in')::numeric),0),'cash_out',coalesce(sum((v->'cash_drawer'->>'cash_out')::numeric),0),
  'salary_auto_total',coalesce(sum((v->'cash_drawer'->>'salary_auto_total')::numeric),0),
  'salary_auto_remaining',coalesce(sum((v->'cash_drawer'->>'salary_auto_remaining')::numeric),0),
  'salary_deduction',coalesce(sum((v->'cash_drawer'->>'salary_deduction')::numeric),0))
  into totals_n from jsonb_array_elements(list_n) v;
 -- Salaries add across selected shifts. A drawer balance always belongs to one
 -- shift; never add openings or cash-after-salary balances across a period.
 return jsonb_build_object('cash_drawer',latest_n,'cash_drawers',list_n,'cash_drawer_period_totals',totals_n,
  'salary_auto',true,'salary_auto_total',totals_n->'salary_auto_total',
  'salary_auto_remaining',totals_n->'salary_auto_remaining','salary_deduction',totals_n->'salary_deduction');
end $$;
revoke all on function private.crm_cash_drawers_period_v30(jsonb,boolean) from public,anon,authenticated;

-- Employee salary totals follow the selected employee, while a cash drawer
-- remains the whole shared shift. Entity filters keep their existing exclusion.
create or replace function private.crm_finance_summary_v5(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer_n jsonb;drawers_n jsonb;entity_n boolean;employee_n uuid;
 target_n numeric;remaining_n numeric;deduction_n numeric;
begin
 answer_n:=private.crm_finance_summary_v5_before_v30(p_payload);
 entity_n:=nullif(p_payload->>'patient_id','') is not null or nullif(p_payload->>'medication_id','') is not null or nullif(p_payload->>'service_id','') is not null;
 drawers_n:=private.crm_cash_drawers_period_v30(answer_n->'shifts',entity_n);
 employee_n:=nullif(p_payload->>'employee_id','')::uuid;
 if employee_n is not null and not entity_n then
  select coalesce(sum((person->>'configured')::numeric),0),
   coalesce(sum((person->>'outstanding')::numeric),0),
   coalesce(sum((person->>'paid')::numeric+(person->>'outstanding')::numeric),0)
   into target_n,remaining_n,deduction_n
   from jsonb_array_elements(drawers_n->'cash_drawers') as shifts(drawer)
   cross join lateral jsonb_array_elements(drawer->'cash_drawer'->'salary_auto_payroll') as people(person)
   where (person->>'staff_id')::uuid=employee_n;
  drawers_n:=drawers_n||jsonb_build_object('salary_auto_total',target_n,
   'salary_auto_remaining',remaining_n,'salary_deduction',deduction_n);
 end if;
 return answer_n||drawers_n||jsonb_build_object('cash_after_salary',drawers_n->'cash_drawer'->'balance','cash_after_salary_semantics','actual_cash_balance');
end $$;
notify pgrst,'reload schema';
commit;
