-- Finance periods use the time and shift of each actual receipt.
-- Bills and outstanding debt are reported separately from money received.
begin;
create or replace function private.crm_finance_summary_v5(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tz text; first_day date; last_day date; grouping text:=coalesce(p_payload->>'group_by','day');
 employee uuid:=nullif(p_payload->>'employee_id','')::uuid; patient uuid:=nullif(p_payload->>'patient_id','')::uuid;
 medication uuid:=nullif(p_payload->>'medication_id','')::uuid; service uuid:=nullif(p_payload->>'service_id','')::uuid;
 answer jsonb; wages_n numeric; closed_wages numeric; open_wages numeric; shifts_n jsonb;
 complete_n boolean; unknown_n integer; has_open_n boolean;
 entity_filter boolean:=patient is not null or medication is not null or service is not null;
begin
 if auth.uid() is null or not private.is_manager() then raise exception 'Финансовые отчёты доступны только владельцу';end if;
 select time_zone into tz from private.crm_finance_settings where id;
 tz:=coalesce(tz,'Europe/Moscow');
 first_day:=coalesce(nullif(p_payload->>'from','')::date,(now() at time zone tz)::date);
 last_day:=coalesce(nullif(p_payload->>'to','')::date,first_day);
 if last_day<first_day or last_day-first_day>3660 then raise exception 'Проверьте период отчёта';end if;
 if grouping not in ('day','employee','patient','medication','service') then raise exception 'Неизвестная группировка';end if;
 with treatments as not materialized (
  select 'procedure'::text kind,p.id,p.shift_id,p.nurse_id,p.patient_id,p.service_id,p.procedure_type service_name,
   p.visit_at at,p.list_total,p.charge_total,p.paid_total,p.stock_deducted
  from public.procedures p
  union all
  select 'sale',s.id,s.shift_id,s.nurse_id,s.patient_id,null::uuid,'Продажа препаратов',
   s.sold_at,s.list_total,s.charge_total,s.paid_total,s.stock_deducted from public.sales s
 ), events as (
  select t.*,t.id event_id,false is_receipt,coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,
   coalesce(a.owner_card,0) owner_card,case when a.id is null then t.paid_total else 0 end unclassified,
   greatest(0,t.charge_total-t.paid_total) debt_created_total,
   greatest(0,t.charge_total-t.paid_total-coalesce((select sum(r.cash+r.terminal+r.owner_card)
    from private.crm_receipts_v10 r where (t.kind='procedure' and r.procedure_id=t.id)
     or (t.kind='sale' and r.sale_id=t.id)),0)) debt_total
  from treatments t left join private.crm_payment_allocations a
   on (t.kind='procedure' and a.procedure_id=t.id) or (t.kind='sale' and a.sale_id=t.id)
  where t.at>=first_day::timestamp at time zone tz and t.at<(last_day+1)::timestamp at time zone tz
  union all
  select t.kind,t.id,r.shift_id,r.nurse_id,t.patient_id,t.service_id,t.service_name,r.created_at,
   t.list_total,0::numeric,r.cash+r.terminal+r.owner_card,t.stock_deducted,
   r.id,true,r.cash,r.terminal,r.owner_card,0::numeric,0::numeric,0::numeric
  from private.crm_receipts_v10 r join treatments t
   on (r.kind='procedure' and t.kind='procedure' and r.procedure_id=t.id)
    or (r.kind='sale' and t.kind='sale' and r.sale_id=t.id)
  where r.created_at>=first_day::timestamp at time zone tz and r.created_at<(last_day+1)::timestamp at time zone tz
 ), filtered as (
  select e.* from events e
  where (employee is null or e.nurse_id=employee) and (patient is null or e.patient_id=patient)
   and (service is null or e.service_id=service or (e.kind='procedure' and exists(
    select 1 from private.crm_treatment_services ts where ts.procedure_id=e.id and ts.service_id=service)))
   and (medication is null or (e.kind='procedure' and exists(
    select 1 from public.procedure_medications pm where pm.procedure_id=e.id and pm.medication_id=medication))
    or (e.kind='sale' and exists(select 1 from public.sale_items si where si.sale_id=e.id and si.medication_id=medication)))
 ), grouped_source as (
  select f.*,case grouping when 'day' then (f.at at time zone tz)::date::text
    when 'employee' then f.nurse_id::text when 'patient' then coalesce(f.patient_id::text,'no_patient') end group_id,
   case grouping when 'day' then (f.at at time zone tz)::date::text
    when 'employee' then coalesce(st.full_name,'Сотрудник') when 'patient' then coalesce(pt.full_name,'Без пациента') end label,
   1::numeric share,0::numeric quantity
  from filtered f left join public.staff st on st.id=f.nurse_id left join public.patients pt on pt.id=f.patient_id
  where grouping in ('day','employee','patient')
  union all
  select f.*,m.id::text,m.name,
   case when f.list_total>0 then lines.line_total/f.list_total else 0 end,
   case when f.is_receipt then 0 else lines.quantity end
  from filtered f join lateral (
   select medication_id,sum(line_total) line_total,sum(quantity) quantity from public.procedure_medications
    where f.kind='procedure' and procedure_id=f.id group by medication_id
   union all select medication_id,sum(line_total),sum(quantity) from public.sale_items
    where f.kind='sale' and sale_id=f.id group by medication_id
  ) lines on true join public.medications m on m.id=lines.medication_id
  where grouping='medication' and (medication is null or m.id=medication)
  union all
  select f.*,coalesce(lines.service_id::text,'sale'),lines.name,
   case when lines.total>0 then lines.line_total/lines.total
    else lines.quantity/nullif(lines.total_quantity,0) end,
   case when f.is_receipt then 0 else lines.quantity end
  from filtered f join lateral (
   select src.*,sum(src.line_total) over() total,sum(src.quantity) over() total_quantity from (
    select ts.service_id,ts.name,sum(ts.quantity)::numeric quantity,
     sum(ts.quantity*(ts.work_price+ts.consumables_price)) line_total
    from private.crm_treatment_services ts where f.kind='procedure' and ts.procedure_id=f.id
    group by ts.service_id,ts.name
    union all select f.service_id,f.service_name,1::numeric,1::numeric
     where f.kind='sale' or not exists(select 1 from private.crm_treatment_services ts where ts.procedure_id=f.id)
   ) src
  ) lines on true where grouping='service' and (service is null or lines.service_id=service)
 ), grouped as (
  select group_id,label,count(distinct patient_id) patients_count,
   count(distinct id) filter(where kind='procedure' and not is_receipt) procedures_count,
   count(distinct id) filter(where kind='sale' and not is_receipt) sales_count,
   count(distinct id) filter(where kind='procedure' and not is_receipt and not stock_deducted) payment_only_procedures_count,
   count(distinct id) filter(where kind='sale' and not is_receipt and not stock_deducted) payment_only_sales_count,
   count(distinct event_id) filter(where is_receipt) debt_payments_count,
   sum(quantity) quantity,round(sum(cash*share),2) cash,round(sum(terminal*share),2) terminal,
   round(sum(owner_card*share),2) owner_card,round(sum(unclassified*share),2) unclassified,
   round(sum(paid_total*share),2) total,round(sum(charge_total*share),2) charge_total,
   round(sum(debt_total*share),2) debt_total,round(sum(debt_created_total*share),2) debt_created_total,
   round(sum(paid_total*share) filter(where is_receipt),2) debt_payments_total
  from grouped_source group by group_id,label
 )
 select jsonb_build_object('from',first_day,'to',last_day,'time_zone',tz,'group_by',grouping,
  'patients_count',(select count(distinct patient_id) from filtered),
  'procedures_count',(select count(*) from filtered where kind='procedure' and not is_receipt),
  'sales_count',(select count(*) from filtered where kind='sale' and not is_receipt),
  'payment_only_procedures_count',(select count(*) from filtered where kind='procedure' and not is_receipt and not stock_deducted),
  'payment_only_sales_count',(select count(*) from filtered where kind='sale' and not is_receipt and not stock_deducted),
  'debt_payments_count',(select count(*) from filtered where is_receipt),
  'charge_total',(select coalesce(sum(charge_total),0) from filtered),
  'debt_total',(select coalesce(sum(debt_total),0) from filtered),
  'debt_created_total',(select coalesce(sum(debt_created_total),0) from filtered),
  'debt_payments_total',(select coalesce(sum(paid_total) filter(where is_receipt),0) from filtered),
  'debt_balance_basis','current_balance_of_bills_in_period',
  'revenue',(select jsonb_build_object('cash',coalesce(sum(cash),0),'terminal',coalesce(sum(terminal),0),
   'owner_card',coalesce(sum(owner_card),0),'unclassified',coalesce(sum(unclassified),0),'total',coalesce(sum(paid_total),0)) from filtered),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',group_id,'label',label,'patients_count',patients_count,
   'procedures_count',procedures_count,'sales_count',sales_count,'quantity',quantity,
   'payment_only_procedures_count',payment_only_procedures_count,'payment_only_sales_count',payment_only_sales_count,
   'charge_total',charge_total,'debt_total',debt_total,'debt_created_total',debt_created_total,
   'debt_payments_count',debt_payments_count,'debt_payments_total',coalesce(debt_payments_total,0),
   'revenue',jsonb_build_object('cash',cash,'terminal',terminal,'owner_card',owner_card,'unclassified',unclassified,'total',total))
    order by label,group_id) from grouped),'[]'::jsonb),
  'rows_revenue_basis',case when grouping='medication' then 'medication_line_share_of_paid_total'
   when grouping='service' then 'service_share_of_receipts' else 'actual_receipts_in_period' end
 ) into answer;
 select coalesce(sum(w.amount),0),coalesce(sum(w.amount) filter(where s.status='closed'),0),
  coalesce(sum(w.amount) filter(where s.status='open'),0)
 into wages_n,closed_wages,open_wages from private.crm_shift_payroll w join public.shifts s on s.id=w.shift_id
 where s.shift_date between first_day and last_day and(employee is null or w.staff_id=employee);
 select count(*) into unknown_n from public.shift_staff ss join public.shifts s on s.id=ss.shift_id join public.staff st on st.id=ss.staff_id
  left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id
  where s.shift_date between first_day and last_day and st.role='nurse' and w.shift_id is null and(employee is null or ss.staff_id=employee);
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'shift_date',s.shift_date,'started_at',s.started_at,
  'ended_at',s.ended_at,'status',s.status,'slot',s.daily_slot,
  'staff',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id
   left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=s.id),'[]'::jsonb),
  'payroll_total',coalesce((select sum(amount) from private.crm_shift_payroll where shift_id=s.id),0),
  'payroll_complete',not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id
   left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id
   where ss.shift_id=s.id and st.role='nurse' and w.shift_id is null)) order by s.shift_date desc,s.started_at desc),'[]'::jsonb) into shifts_n
 from public.shifts s where s.shift_date between first_day and last_day
  and(employee is null or exists(select 1 from public.shift_staff where shift_id=s.id and staff_id=employee));
 select not exists(select 1 from public.shifts where shift_date between first_day and last_day
  group by shift_date having count(*)<>2 or not bool_and(status='closed')) into complete_n;
 select exists(select 1 from public.shifts where shift_date between first_day and last_day and status='open') into has_open_n;
 return answer||jsonb_build_object('payroll_total',case when not entity_filter then wages_n end,
  'payroll_closed',case when not entity_filter then closed_wages end,'payroll_open',case when not entity_filter then open_wages end,
  'payroll_scope',case when entity_filter then 'not_applicable_to_entity_filter'
   when employee is null then 'all_period_shifts' else 'employee_period_shifts' end,
  'payroll_unknown',case when not entity_filter then unknown_n end,'payroll_complete',case when not entity_filter then unknown_n=0 end,
  'cash_after_salary',case when not entity_filter and unknown_n=0 then (answer->'revenue'->>'total')::numeric-wages_n end,
  'days_complete',complete_n,'has_open_shifts',has_open_n,'shifts',shifts_n);
end $$;
revoke all on function private.crm_finance_summary_v5(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
