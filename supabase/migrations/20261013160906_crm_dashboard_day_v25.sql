-- Daily dashboard keeps working shifts and calendar receipts separate.
-- Existing period reports and every customer/payment timestamp remain unchanged.
begin;

create or replace function private.crm_dashboard_day_v25(p_date date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare day_value date:=coalesce(p_date,(now() at time zone 'Europe/Moscow')::date);
 calendar_value jsonb;working_value jsonb;breakdown_value jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.staff
  where auth_user_id=auth.uid() and active and role in ('owner','admin')) then
  raise exception 'Финансовые отчёты доступны только администратору';
 end if;
 calendar_value:=private.crm_finance_summary_v5(jsonb_build_object('from',day_value,'to',day_value,'group_by','day'));

 with selected_shifts as materialized (
  select id,status from public.shifts where shift_date=day_value
 ), treatments as materialized (
  select 'procedure'::text kind,p.id,p.patient_id,p.paid_total,p.charge_total
   from public.procedures p join selected_shifts s on s.id=p.shift_id
  union all
  select 'sale',p.id,p.patient_id,p.paid_total,p.charge_total
   from public.sales p join selected_shifts s on s.id=p.shift_id
 ), repaid as (
  select t.kind,t.id,sum(r.cash+r.terminal+r.owner_card) amount
  from treatments t join private.crm_receipts_v10 r
   on r.voided_at is null and ((t.kind='procedure' and r.procedure_id=t.id)
    or(t.kind='sale' and r.sale_id=t.id)) group by t.kind,t.id
 ), bills as (
  select count(distinct t.patient_id) patients_count,
   count(*) filter(where t.kind='procedure') procedures_count,
   count(*) filter(where t.kind='sale') sales_count,
   coalesce(sum(t.charge_total),0) charge_total,
   coalesce(sum(greatest(0,t.charge_total-t.paid_total)),0) debt_created_total,
   coalesce(sum(greatest(0,t.charge_total-t.paid_total-coalesce(r.amount,0))),0) debt_total
  from treatments t left join repaid r on r.kind=t.kind and r.id=t.id
 ), money as (
  -- Allocations are summed before joining a bill: payment history never
  -- multiplies patients, procedures or the original paid total.
  select coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,
   coalesce(a.owner_card,0) owner_card,
   case when coalesce(a.entries,0)=0 then t.paid_total else 0 end unclassified,
   t.paid_total amount,false is_receipt
  from treatments t left join lateral (
   select count(*) entries,sum(a.cash) cash,sum(a.terminal) terminal,sum(a.owner_card) owner_card
    from private.crm_payment_allocations a where a.voided_at is null
     and ((t.kind='procedure' and a.procedure_id=t.id)or(t.kind='sale' and a.sale_id=t.id))
  ) a on true
  union all
  select r.cash,r.terminal,r.owner_card,0::numeric,r.cash+r.terminal+r.owner_card,true
   from private.crm_receipts_v10 r join selected_shifts s on s.id=r.shift_id where r.voided_at is null
 ), income as (
  select coalesce(sum(cash),0) cash,coalesce(sum(terminal),0) terminal,coalesce(sum(owner_card),0) owner_card,
   coalesce(sum(unclassified),0) unclassified,coalesce(sum(amount),0) total,
   count(*) filter(where is_receipt) debt_payments_count,
   coalesce(sum(amount) filter(where is_receipt),0) debt_payments_total from money
 ), payroll as (
  select coalesce(sum(w.amount),0) amount from private.crm_shift_payroll w join selected_shifts s on s.id=w.shift_id
 ), unknown_payroll as (
  select count(*) amount from selected_shifts s join public.shift_staff ss on ss.shift_id=s.id
   join public.staff st on st.id=ss.staff_id left join private.crm_shift_payroll w on w.shift_id=s.id and w.staff_id=ss.staff_id
   where st.role='nurse' and w.shift_id is null
 )
 select jsonb_build_object('date',day_value,'basis','shift_date',
  'patients_count',b.patients_count,'procedures_count',b.procedures_count,'sales_count',b.sales_count,
  'charge_total',b.charge_total,'debt_created_total',b.debt_created_total,'debt_total',b.debt_total,
  'debt_payments_count',i.debt_payments_count,'debt_payments_total',i.debt_payments_total,
  'revenue',jsonb_build_object('cash',i.cash,'terminal',i.terminal,'owner_card',i.owner_card,'unclassified',i.unclassified,'total',i.total),
  'payroll_total',p.amount,'payroll_unknown',u.amount,'payroll_complete',u.amount=0,
  'cash_after_salary',case when u.amount=0 then i.total-p.amount end,
  'shift_count',(select count(*) from selected_shifts),
  'has_open_shifts',exists(select 1 from selected_shifts where status='open'))
 into working_value from bills b cross join income i cross join payroll p cross join unknown_payroll u;

 with treatments as (
  select 'procedure'::text kind,p.id,p.shift_id,p.visit_at recorded_at,p.paid_total from public.procedures p
  union all select 'sale',s.id,s.shift_id,s.sold_at,s.paid_total from public.sales s
 ), money as (
  select t.shift_id,coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,coalesce(a.owner_card,0) owner_card,
   case when coalesce(a.entries,0)=0 then t.paid_total else 0 end unclassified,t.paid_total amount
  from treatments t left join lateral (
   select count(*) entries,sum(a.cash) cash,sum(a.terminal) terminal,sum(a.owner_card) owner_card
    from private.crm_payment_allocations a where a.voided_at is null
     and ((t.kind='procedure' and a.procedure_id=t.id)or(t.kind='sale' and a.sale_id=t.id))
  ) a on true
  where t.recorded_at>=day_value::timestamp at time zone 'Europe/Moscow'
   and t.recorded_at<(day_value+1)::timestamp at time zone 'Europe/Moscow'
  union all
  select r.shift_id,r.cash,r.terminal,r.owner_card,0::numeric,r.cash+r.terminal+r.owner_card
   from private.crm_receipts_v10 r where r.voided_at is null
    and r.created_at>=day_value::timestamp at time zone 'Europe/Moscow'
    and r.created_at<(day_value+1)::timestamp at time zone 'Europe/Moscow'
 ), grouped as (
  select case when s.shift_date=day_value then 'current_day_shifts'
   when s.shift_date<day_value then 'previous_day_shifts' else 'other_day_shifts' end category,
   sum(m.cash) cash,sum(m.terminal) terminal,sum(m.owner_card) owner_card,
   sum(m.unclassified) unclassified,sum(m.amount) total
  from money m left join public.shifts s on s.id=m.shift_id group by 1
 )
 select coalesce(jsonb_object_agg(category,jsonb_build_object('cash',cash,'terminal',terminal,
  'owner_card',owner_card,'unclassified',unclassified,'total',total)),'{}'::jsonb) into breakdown_value from grouped;
 return jsonb_build_object('date',day_value,'time_zone','Europe/Moscow','working_day',working_value,
  'receipts_day',jsonb_build_object('date',day_value,'basis','recorded_receipt_date','revenue',calendar_value->'revenue',
   'debt_payments_count',calendar_value->'debt_payments_count','debt_payments_total',calendar_value->'debt_payments_total',
   'breakdown',breakdown_value));
end $$;
revoke all on function private.crm_dashboard_day_v25(date) from public,anon,authenticated;

-- The private guard checks the active manager before returning any totals.
create or replace function public.crm_dashboard_day_v25(p_date date default null)
returns jsonb language sql security definer set search_path='' as $$
 select private.crm_dashboard_day_v25(p_date);
$$;
revoke all on function public.crm_dashboard_day_v25(date) from public,anon;
grant execute on function public.crm_dashboard_day_v25(date) to authenticated;
notify pgrst,'reload schema';
commit;
