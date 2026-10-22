-- Standalone medication sales have their own account; ordinary procedures alone
-- fund shift cash and shift revenue. No financial event or signed count is rewritten.
begin;
set local lock_timeout='10s';

do $copy$ declare s text;begin
 if to_regprocedure('private.crm_build_shift_report_v5_before_v53(uuid)') is not null then raise exception 'v53 backup already exists: crm_build_shift_report_v5_before_v53';end if;
 s:=pg_get_functiondef('private.crm_build_shift_report_v5(uuid)'::regprocedure);
 if md5(s)<>'bf02cab2369602358e14b7732a9bb3b1' then raise exception 'v53 reviewed wrapper changed: private.crm_build_shift_report_v5(uuid)';end if;
 execute replace(s,'FUNCTION private.crm_build_shift_report_v5(','FUNCTION private.crm_build_shift_report_v5_before_v53(');
 execute 'revoke all on function private.crm_build_shift_report_v5_before_v53(uuid) from public,anon,authenticated';
end $copy$;

do $copy$ declare s text;begin
 if to_regprocedure('private.crm_finance_summary_v5_before_v53(jsonb)') is not null then raise exception 'v53 backup already exists: crm_finance_summary_v5_before_v53';end if;
 s:=pg_get_functiondef('private.crm_finance_summary_v5(jsonb)'::regprocedure);
 if md5(s)<>'f52f705abd5f66d8542c8922b2ae3924' then raise exception 'v53 reviewed wrapper changed: private.crm_finance_summary_v5(jsonb)';end if;
 execute replace(s,'FUNCTION private.crm_finance_summary_v5(','FUNCTION private.crm_finance_summary_v5_before_v53(');
 execute 'revoke all on function private.crm_finance_summary_v5_before_v53(jsonb) from public,anon,authenticated';
end $copy$;

do $copy$ declare s text;begin
 if to_regprocedure('private.crm_finance_v5_before_v53(text, jsonb)') is not null then raise exception 'v53 backup already exists: crm_finance_v5_before_v53';end if;
 s:=pg_get_functiondef('private.crm_finance_v5(text, jsonb)'::regprocedure);
 if md5(s)<>'ef962377797bc117735fd86f936825a8' then raise exception 'v53 reviewed wrapper changed: private.crm_finance_v5(text, jsonb)';end if;
 execute replace(s,'FUNCTION private.crm_finance_v5(','FUNCTION private.crm_finance_v5_before_v53(');
 execute 'revoke all on function private.crm_finance_v5_before_v53(text, jsonb) from public,anon,authenticated';
end $copy$;

do $copy$ declare s text;begin
 if to_regprocedure('private.crm_financial_overlay_v29_before_v53(jsonb, jsonb)') is not null then raise exception 'v53 backup already exists: crm_financial_overlay_v29_before_v53';end if;
 s:=pg_get_functiondef('private.crm_financial_overlay_v29(jsonb, jsonb)'::regprocedure);
 if md5(s)<>'b0f981dddc25ad135eaa10e69403ff99' then raise exception 'v53 reviewed wrapper changed: private.crm_financial_overlay_v29(jsonb, jsonb)';end if;
 execute replace(s,'FUNCTION private.crm_financial_overlay_v29(','FUNCTION private.crm_financial_overlay_v29_before_v53(');
 execute 'revoke all on function private.crm_financial_overlay_v29_before_v53(jsonb, jsonb) from public,anon,authenticated';
end $copy$;

do $copy$ declare s text;begin
 if to_regprocedure('private.crm_dashboard_day_v25_before_v53(date)') is not null then raise exception 'v53 backup already exists: crm_dashboard_day_v25_before_v53';end if;
 s:=pg_get_functiondef('private.crm_dashboard_day_v25(date)'::regprocedure);
 if md5(s)<>'7cff137a89c9ac62161dc81207ee7cea' then raise exception 'v53 reviewed wrapper changed: private.crm_dashboard_day_v25(date)';end if;
 execute replace(s,'FUNCTION private.crm_dashboard_day_v25(','FUNCTION private.crm_dashboard_day_v25_before_v53(');
 execute 'revoke all on function private.crm_dashboard_day_v25_before_v53(date) from public,anon,authenticated';
end $copy$;

do $patch$ declare r record;s text;t text;o oid;a aclitem[];w oid;d boolean;c text[];begin
 for r in select * from(values

 ('private.crm_cash_drawer_facts_v30_before_v37(uuid, numeric)','35aefe15a632cd1c30a81685d0da5b12','1b404b595d9f047a5dd43d9247070e09',1,$old53$ cash_n:=p_received_cash;
 if cash_n is null then$old53$,$new53$ -- The old parameter is retained for ABI compatibility; it cannot inject sale cash.
 cash_n:=null;
 if cash_n is null then$new53$),
 ('private.crm_cash_drawer_facts_v30_before_v37(uuid, numeric)','1b404b595d9f047a5dd43d9247070e09','4ba2cedfc94df2094ec3ed2475946de3',1,$old53$   union all
   select a.cash from private.crm_active_sales_v52 s join private.crm_payment_allocations a on a.sale_id=s.id
    where s.shift_id=p_shift and a.voided_at is null
$old53$,$new53$$new53$),
 ('private.crm_cash_drawer_facts_v30_before_v37(uuid, numeric)','4ba2cedfc94df2094ec3ed2475946de3','b6e1111ac25e61f9f3e817c70bee208a',1,$old53$where r.shift_id=p_shift and r.voided_at is null and not r.is_debt_repayment$old53$,$new53$where r.shift_id=p_shift and r.voided_at is null and not r.is_debt_repayment and r.kind='procedure'$new53$),
 ('private.crm_cash_financial_snapshot_v37(uuid)','2588106315c3c26c6a296418576464e5','5931c820b516617d70a919bdf838facb',1,$old53$ from private.crm_payment_allocations a left join private.crm_active_procedures_v51 p on p.id=a.procedure_id
    left join private.crm_active_sales_v52 s on s.id=a.sale_id
   where a.voided_at is null and coalesce(p.shift_id,s.shift_id)=p_shift$old53$,$new53$ from private.crm_payment_allocations a join private.crm_active_procedures_v51 p on p.id=a.procedure_id
   where a.voided_at is null and p.shift_id=p_shift$new53$),
 ('private.crm_cash_financial_snapshot_v37(uuid)','5931c820b516617d70a919bdf838facb','bb1d320ad7d3bd6357be61eb78100e3b',1,$old53$where r.shift_id=p_shift and r.voided_at is null and not r.is_debt_repayment$old53$,$new53$where r.shift_id=p_shift and r.voided_at is null and not r.is_debt_repayment and r.kind='procedure'$new53$),
 ('private.crm_cash_financial_snapshot_v37(uuid)','bb1d320ad7d3bd6357be61eb78100e3b','9841c7f57f350c204554fa5393f25e69',1,$old53$   union all select 'sale',s.id,jsonb_build_object('kind','sale','id',s.id,'paid_total',s.paid_total,
    'charge_total',s.charge_total,'list_total',s.list_total,'payment_pending',s.payment_pending)
    from private.crm_active_sales_v52 s where s.shift_id=p_shift
$old53$,$new53$$new53$),
 ('private.crm_finance_summary_v5_before_v30(jsonb)','17a0003ff1c28b58a875ce4fb2e54a67','bc7c0d5e1524dae57f19a5330a08dd72',1,$old53$  where (employee is null or e.nurse_id=employee) and (patient is null or e.patient_id=patient)$old53$,$new53$  where (coalesce(p_payload->>'__v53_record_kind','all')='all' or e.kind=p_payload->>'__v53_record_kind')
   and (employee is null or e.nurse_id=employee) and (patient is null or e.patient_id=patient)$new53$),
 ('private.crm_finance_summary_v5_before_v30(jsonb)','bc7c0d5e1524dae57f19a5330a08dd72','34df43641089b3e0e774de0e4f07bd24',1,$old53$   r.id,true,r.cash,r.terminal,r.owner_card,r.other_card,0::numeric,0::numeric,0::numeric,0::numeric$old53$,$new53$   r.id,true,r.cash,r.terminal,r.owner_card,r.other_card,r.unclassified_amount,0::numeric,0::numeric,0::numeric$new53$),
 ('private.crm_cash_drawer_facts_v30(uuid, numeric)','42b38aeae479edaddf07c9675928b984','efb28991351e58fb0c707144b032a8c8',1,$old53$||jsonb_build_object('reconciliation_v37',private.crm_cash_reconciliation_facts_v37(p_shift))$old53$,$new53$||jsonb_build_object('reconciliation_v37',private.crm_cash_reconciliation_facts_v37(p_shift),'sales_separate',true,'revenue_scope','procedures')$new53$),
 ('private.crm_shift_journal_v12(date)','89167563aa0a0be2b4644c7b5f8ff83e','3c63bae1111501f4b4c6415015d26696',1,$old53$   'debt_created_total',report_row->'debt_created_total','debt_receipts_total',report_row->'debt_receipts_total'$old53$,$new53$   'debt_created_total',report_row->'debt_created_total','debt_receipts_total',report_row->'debt_receipts_total',
   'sales_separate',true,'revenue_scope','procedures','sales_summary',report_row->'sales_summary'$new53$)
 ) x(signature,before_hash,after_hash,hits,old_fragment,new_fragment) loop
 o:=to_regprocedure(r.signature);if o is null then raise exception 'v53 missing function: %',r.signature;end if;
 s:=pg_get_functiondef(o);if md5(s)<>r.before_hash then raise exception 'v53 source changed: %',r.signature;end if;
 if (length(s)-length(replace(s,r.old_fragment,'')))/length(r.old_fragment)<>r.hits then raise exception 'v53 anchor changed: %',r.signature;end if;
 t:=replace(s,r.old_fragment,r.new_fragment);if md5(t)<>r.after_hash then raise exception 'v53 patch mismatch: %',r.signature;end if;
 select proacl,proowner,prosecdef,proconfig into a,w,d,c from pg_proc where oid=o;execute t;
 if to_regprocedure(r.signature)::oid is distinct from o or (select proacl from pg_proc where oid=o) is distinct from a or (select proowner from pg_proc where oid=o) is distinct from w or (select prosecdef from pg_proc where oid=o) is distinct from d or (select proconfig from pg_proc where oid=o) is distinct from c then raise exception 'v53 function identity changed: %',r.signature;end if;
 end loop;end $patch$;

CREATE OR REPLACE FUNCTION private.crm_dashboard_day_kind_v53(p_date date, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare day_value date:=coalesce(p_date,(now() at time zone 'Europe/Moscow')::date);
 calendar_value jsonb;working_value jsonb;breakdown_value jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.staff
  where auth_user_id=auth.uid() and active and role in ('owner','admin')) then
  raise exception 'Финансовые отчёты доступны только администратору';
 end if;
 calendar_value:=private.crm_finance_summary_v5_before_v30(jsonb_build_object('from',day_value,'to',day_value,'group_by','day','__v53_record_kind',p_kind));

 with selected_shifts as materialized (
  select id,status from public.shifts where shift_date=day_value
 ), treatments as materialized (select * from (
  select 'procedure'::text kind,p.id,p.patient_id,p.paid_total,p.charge_total,p.payment_pending
   from private.crm_active_procedures_v51 p join selected_shifts s on s.id=p.shift_id
  union all
  select 'sale',p.id,p.patient_id,p.paid_total,p.charge_total,p.payment_pending
   from private.crm_active_sales_v52 p join selected_shifts s on s.id=p.shift_id
 ) records where kind=p_kind
 ), repaid as (
  select t.kind,t.id,sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount) amount,
   coalesce(sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount) filter(where not r.is_debt_repayment),0) ordinary_amount
  from treatments t join private.crm_receipts_v10 r
   on r.voided_at is null and ((t.kind='procedure' and r.procedure_id=t.id)
    or(t.kind='sale' and r.sale_id=t.id)) group by t.kind,t.id
 ), bills as (
  select count(distinct t.patient_id) patients_count,
   count(*) filter(where t.kind='procedure') procedures_count,
   count(*) filter(where t.kind='sale') sales_count,
   coalesce(sum(t.charge_total),0) charge_total,
   coalesce(sum(case when t.payment_pending then 0 else greatest(0,t.charge_total-t.paid_total-coalesce(r.ordinary_amount,0)) end),0) debt_created_total,
   coalesce(sum(case when t.payment_pending then 0 else greatest(0,t.charge_total-t.paid_total-coalesce(r.amount,0)) end),0) debt_total,
   coalesce(sum(case when t.payment_pending then greatest(0,t.charge_total-t.paid_total-coalesce(r.amount,0)) else 0 end),0) pending_total
  from treatments t left join repaid r on r.kind=t.kind and r.id=t.id
 ), money as (
  -- Allocations are summed before joining a bill: payment history never
  -- multiplies patients, procedures or the original paid total.
  select coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,
   coalesce(a.owner_card,0) owner_card,coalesce(a.other_card,0) other_card,
   case when coalesce(a.entries,0)=0 then t.paid_total else 0 end unclassified,
   t.paid_total amount,false is_receipt
  from treatments t left join lateral (
   select count(*) entries,sum(a.cash) cash,sum(a.terminal) terminal,sum(a.owner_card) owner_card,sum(a.other_card) other_card
    from private.crm_payment_allocations a where a.voided_at is null
     and ((t.kind='procedure' and a.procedure_id=t.id)or(t.kind='sale' and a.sale_id=t.id))
  ) a on true
  union all
  select r.cash,r.terminal,r.owner_card,r.other_card,r.unclassified_amount,r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount,true
   from private.crm_receipts_v10 r join selected_shifts s on s.id=r.shift_id where r.voided_at is null and not r.is_debt_repayment and r.kind=p_kind
 ), income as (
  select coalesce(sum(cash),0) cash,coalesce(sum(terminal),0) terminal,coalesce(sum(owner_card),0) owner_card,coalesce(sum(other_card),0) other_card,
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
  'charge_total',b.charge_total,'debt_created_total',b.debt_created_total,'debt_total',b.debt_total,'loan_debt_total',b.debt_total,'pending_total',b.pending_total,
  'debt_payments_count',i.debt_payments_count,'debt_payments_total',i.debt_payments_total,
  'revenue',jsonb_build_object('cash',i.cash,'terminal',i.terminal,'owner_card',i.owner_card,'other_card',i.other_card,'unclassified',i.unclassified,'total',i.total),
  'payroll_total',p.amount,'payroll_unknown',u.amount,'payroll_complete',u.amount=0,
  'cash_after_salary',case when u.amount=0 then i.total-p.amount end,
  'shift_count',(select count(*) from selected_shifts),
  'has_open_shifts',exists(select 1 from selected_shifts where status='open'))
 into working_value from bills b cross join income i cross join payroll p cross join unknown_payroll u;

 with treatments as (select * from (
  select 'procedure'::text kind,p.id,p.shift_id,p.visit_at recorded_at,p.paid_total from private.crm_active_procedures_v51 p
  union all select 'sale',s.id,s.shift_id,s.sold_at,s.paid_total from private.crm_active_sales_v52 s
 ) records where kind=p_kind
 ), money as (
  select t.shift_id,coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,coalesce(a.owner_card,0) owner_card,coalesce(a.other_card,0) other_card,
   case when coalesce(a.entries,0)=0 then t.paid_total else 0 end unclassified,t.paid_total amount
  from treatments t left join lateral (
   select count(*) entries,sum(a.cash) cash,sum(a.terminal) terminal,sum(a.owner_card) owner_card,sum(a.other_card) other_card
    from private.crm_payment_allocations a where a.voided_at is null
     and ((t.kind='procedure' and a.procedure_id=t.id)or(t.kind='sale' and a.sale_id=t.id))
  ) a on true
  where t.recorded_at>=day_value::timestamp at time zone 'Europe/Moscow'
   and t.recorded_at<(day_value+1)::timestamp at time zone 'Europe/Moscow'
  union all
  select r.shift_id,r.cash,r.terminal,r.owner_card,r.other_card,r.unclassified_amount,r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount
   from private.crm_receipts_v10 r where r.voided_at is null and not r.is_debt_repayment and r.kind=p_kind
    and r.created_at>=day_value::timestamp at time zone 'Europe/Moscow'
    and r.created_at<(day_value+1)::timestamp at time zone 'Europe/Moscow'
 ), grouped as (
  select case when s.shift_date=day_value then 'current_day_shifts'
   when s.shift_date<day_value then 'previous_day_shifts' else 'other_day_shifts' end category,
   sum(m.cash) cash,sum(m.terminal) terminal,sum(m.owner_card) owner_card,sum(m.other_card) other_card,
   sum(m.unclassified) unclassified,sum(m.amount) total
  from money m left join public.shifts s on s.id=m.shift_id group by 1
 )
 select coalesce(jsonb_object_agg(category,jsonb_build_object('cash',cash,'terminal',terminal,
  'owner_card',owner_card,'other_card',other_card,'unclassified',unclassified,'total',total)),'{}'::jsonb) into breakdown_value from grouped;
 return jsonb_build_object('date',day_value,'time_zone','Europe/Moscow','working_day',working_value,
  'receipts_day',jsonb_build_object('date',day_value,'basis','recorded_receipt_date','revenue',calendar_value->'revenue',
   'debt_payments_count',calendar_value->'debt_payments_count','debt_payments_total',calendar_value->'debt_payments_total',
   'breakdown',breakdown_value,'sales_count',calendar_value->'sales_count','patients_count',calendar_value->'patients_count',
   'charge_total',calendar_value->'charge_total','debt_total',calendar_value->'debt_total','loan_debt_total',calendar_value->'loan_debt_total',
   'pending_total',calendar_value->'pending_total','debt_created_total',calendar_value->'debt_created_total'));
end $function$
;
revoke all on function private.crm_dashboard_day_kind_v53(date,text) from public,anon,authenticated;
-- One authoritative ledger for ordinary receipts. True debt collections remain
-- in their separate ledger and are excluded from both ordinary account totals.
create function private.crm_shift_money_v53(p_shift uuid,p_kind text) returns jsonb
language sql stable security invoker set search_path='' as $$
 with bills as (
  select 'procedure'::text kind,p.id,p.paid_total from private.crm_active_procedures_v51 p where p_kind='procedure' and p.shift_id=p_shift
  union all select 'sale',s.id,s.paid_total from private.crm_active_sales_v52 s where p_kind='sale' and s.shift_id=p_shift
 ), initial as (
  select coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,coalesce(a.owner_card,0) owner_card,coalesce(a.other_card,0) other_card,
   greatest(b.paid_total-coalesce(a.cash,0)-coalesce(a.terminal,0)-coalesce(a.owner_card,0)-coalesce(a.other_card,0),0) unclassified
  from bills b left join lateral(
   select sum(x.cash) cash,sum(x.terminal) terminal,sum(x.owner_card) owner_card,sum(x.other_card) other_card
   from private.crm_payment_allocations x where x.voided_at is null
    and ((b.kind='procedure' and x.procedure_id=b.id)or(b.kind='sale' and x.sale_id=b.id))
  ) a on true
 ), events as (
  select * from initial
  union all select r.cash,r.terminal,r.owner_card,r.other_card,r.unclassified_amount
   from private.crm_receipts_v10 r where r.shift_id=p_shift and r.kind=p_kind and r.voided_at is null and not r.is_debt_repayment
    and ((r.kind='procedure' and exists(select 1 from private.crm_active_procedures_v51 p where p.id=r.procedure_id))
      or(r.kind='sale' and exists(select 1 from private.crm_active_sales_v52 s where s.id=r.sale_id)))
 )
 select jsonb_build_object('cash',coalesce(sum(cash),0),'terminal',coalesce(sum(terminal),0),
  'owner_card',coalesce(sum(owner_card),0),'other_card',coalesce(sum(other_card),0),'unclassified',coalesce(sum(unclassified),0),
  'total',coalesce(sum(cash+terminal+owner_card+other_card+unclassified),0)) from events
$$;
revoke all on function private.crm_shift_money_v53(uuid,text) from public,anon,authenticated;

create function private.crm_bill_totals_v53(p_records jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('patients_count',count(distinct nullif(r->>'patient_id','')),
  'charge_total',coalesce(sum((r->>'charge_total')::numeric),0),
  'debt_total',coalesce(sum((r->>'loan_debt_total')::numeric),0),'loan_debt_total',coalesce(sum((r->>'loan_debt_total')::numeric),0),
  'pending_total',coalesce(sum((r->>'pending_total')::numeric),0),
  'debt_created_total',coalesce(sum(case when coalesce((r->>'payment_pending')::boolean,false) then 0
   else greatest(coalesce((r->>'charge_total')::numeric,0)-coalesce((r->>'received_total')::numeric,0),0) end),0))
 from jsonb_array_elements(coalesce(p_records,'[]'::jsonb)) r
$$;
revoke all on function private.crm_bill_totals_v53(jsonb) from public,anon,authenticated;

-- Financial keys only: a standalone sale account never borrows shift wages,
-- drawer openings, cash movements or the nursing inventory visibility scope.
create function private.crm_sales_account_v53(p_summary jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('revenue_scope','standalone_sales',
  'revenue',coalesce(p_summary->'revenue','{"cash":0,"terminal":0,"owner_card":0,"other_card":0,"unclassified":0,"total":0}'::jsonb),
  'charge_total',coalesce(p_summary->'charge_total','0'::jsonb),'debt_total',coalesce(p_summary->'debt_total','0'::jsonb),
  'loan_debt_total',coalesce(p_summary->'loan_debt_total',p_summary->'debt_total','0'::jsonb),
  'pending_total',coalesce(p_summary->'pending_total','0'::jsonb),'debt_created_total',coalesce(p_summary->'debt_created_total','0'::jsonb),
  'sales_count',coalesce(p_summary->'sales_count','0'::jsonb),'patients_count',coalesce(p_summary->'patients_count','0'::jsonb),
  'quantity',coalesce(p_summary->'quantity','0'::jsonb),
  'ordinary_receipts_count',coalesce(p_summary->'ordinary_receipts_count',p_summary->'debt_payments_count','0'::jsonb),
  'ordinary_receipts_total',coalesce(p_summary->'ordinary_receipts_total',p_summary->'debt_receipts_total',p_summary->'debt_payments_total','0'::jsonb),
  'debt_receipts_total',coalesce(p_summary->'ordinary_receipts_total',p_summary->'debt_receipts_total',p_summary->'debt_payments_total','0'::jsonb),
  'sales_total',coalesce(p_summary->'revenue'->'total','0'::jsonb),'cash_total',coalesce(p_summary->'revenue'->'total','0'::jsonb))
  ||case when p_summary?'rows' then jsonb_build_object('rows',p_summary->'rows') else '{}'::jsonb end
  ||case when p_summary?'breakdown' then jsonb_build_object('breakdown',p_summary->'breakdown') else '{}'::jsonb end
$$;
revoke all on function private.crm_sales_account_v53(jsonb) from public,anon,authenticated;

create function private.crm_split_shift_report_v53(p_report jsonb,p_shift uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare procedures_n jsonb:=coalesce(p_report->'procedures','[]');sales_n jsonb:=coalesce(p_report->'sales','[]');
 proc_n jsonb;sale_n jsonb;proc_money_n jsonb;sale_money_n jsonb;drawer_n jsonb;proc_receipts_n jsonb;sale_receipts_n jsonb;
begin
 proc_money_n:=private.crm_shift_money_v53(p_shift,'procedure');sale_money_n:=private.crm_shift_money_v53(p_shift,'sale');
 proc_n:=private.crm_bill_totals_v53(procedures_n);sale_n:=private.crm_bill_totals_v53(sales_n);
 select jsonb_build_object('ordinary_receipts_count',count(*),'ordinary_receipts_total',coalesce(sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount),0))
  into proc_receipts_n from private.crm_receipts_v10 r where r.shift_id=p_shift and r.kind='procedure' and r.voided_at is null and not r.is_debt_repayment
   and exists(select 1 from private.crm_active_procedures_v51 b where b.id=r.procedure_id);
 select jsonb_build_object('ordinary_receipts_count',count(*),'ordinary_receipts_total',coalesce(sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount),0))
  into sale_receipts_n from private.crm_receipts_v10 r where r.shift_id=p_shift and r.kind='sale' and r.voided_at is null and not r.is_debt_repayment
   and exists(select 1 from private.crm_active_sales_v52 b where b.id=r.sale_id);
 sale_n:=sale_n||sale_receipts_n||jsonb_build_object('revenue',sale_money_n,'sales_count',jsonb_array_length(sales_n));
 drawer_n:=private.crm_cash_drawer_facts_v30(p_shift);
 return p_report||proc_n||proc_receipts_n||jsonb_build_object('sales_separate',true,'revenue_scope','procedures',
  'revenue',proc_money_n,'cash_total',proc_money_n->'total','procedures_total',proc_money_n->'total','sales_total',0,'sales_summary',private.crm_sales_account_v53(sale_n),
  'sales_count',jsonb_array_length(sales_n),'procedures_count',jsonb_array_length(procedures_n),
  'debt_receipts_total',proc_receipts_n->'ordinary_receipts_total',
  'cash_drawer',drawer_n,'cash_after_salary',drawer_n->'balance','cash_after_salary_semantics','actual_cash_balance');
end $$;
revoke all on function private.crm_split_shift_report_v53(jsonb,uuid) from public,anon,authenticated;

create or replace function private.crm_build_shift_report_v5(p_shift uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin return private.crm_split_shift_report_v53(private.crm_build_shift_report_v5_before_v53(p_shift),p_shift);end $$;

-- Frozen warehouse/payroll sections survive. Only live operational counts and
-- financial presentation are overlaid; signed reconciliation rows are untouched.
create or replace function private.crm_financial_overlay_v29(p_report jsonb,p_fresh jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select private.crm_financial_overlay_v29_before_v53(p_report,p_fresh)||jsonb_build_object(
  'sales_separate',true,'revenue_scope','procedures','sales_summary',p_fresh->'sales_summary',
  'patients_count',p_fresh->'patients_count','procedures_count',p_fresh->'procedures_count','sales_count',p_fresh->'sales_count',
  'ordinary_receipts_count',p_fresh->'ordinary_receipts_count','ordinary_receipts_total',p_fresh->'ordinary_receipts_total',
  'procedures_total',p_fresh->'procedures_total','sales_total',p_fresh->'sales_total',
  'cash_drawer',p_fresh->'cash_drawer')
$$;

create or replace function private.crm_finance_v5(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer_n jsonb;sh_n uuid;
begin
 -- The released dispatcher authenticates and retains every mutation guard.
 answer_n:=private.crm_finance_v5_before_v53(p_action,p_payload);
 if p_action in('shift_report','close','salary') and answer_n?'revenue' then
  sh_n:=nullif(p_payload->>'shift_id','')::uuid;return private.crm_split_shift_report_v53(answer_n,sh_n);
 end if;return answer_n;
end $$;

create or replace function private.crm_finance_summary_v5(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer_n jsonb;sales_n jsonb;rows_n jsonb;
begin
 -- Force both scopes in the outer authorized wrapper. Client-supplied hidden
 -- scope values cannot turn a sale into procedure money or vice versa.
 answer_n:=private.crm_finance_summary_v5_before_v53(p_payload||jsonb_build_object('__v53_record_kind','procedure'));
 sales_n:=private.crm_finance_summary_v5_before_v30(p_payload||jsonb_build_object('__v53_record_kind','sale'));
 select coalesce(jsonb_agg(
  coalesce(p.value,jsonb_build_object('id',s.value->'id','label',s.value->'label','patients_count',0,'procedures_count',0,
   'sales_count',0,'quantity',0,'payment_only_procedures_count',0,'payment_only_sales_count',0,
   'charge_total',0,'debt_total',0,'loan_debt_total',0,'pending_total',0,'debt_created_total',0,
   'debt_payments_count',0,'debt_payments_total',0,
   'revenue','{"cash":0,"terminal":0,"owner_card":0,"other_card":0,"unclassified":0,"total":0}'::jsonb))
   ||jsonb_build_object('sales_separate',true,'revenue_scope','procedures','sales_count',coalesce(s.value->'sales_count','0'::jsonb),
    'payment_only_sales_count',coalesce(s.value->'payment_only_sales_count','0'::jsonb),
    'sales_summary',private.crm_sales_account_v53(s.value),'sales_total',0,'cash_total',coalesce(p.value->'revenue'->'total','0'::jsonb))
   order by coalesce(p.value->>'label',s.value->>'label'),coalesce(p.value->>'id',s.value->>'id')),'[]') into rows_n
  from jsonb_array_elements(coalesce(answer_n->'rows','[]'))p(value)
  full join jsonb_array_elements(coalesce(sales_n->'rows','[]'))s(value) on p.value->>'id'=s.value->>'id';
 return answer_n||jsonb_build_object('sales_separate',true,'revenue_scope','procedures','sales_count',sales_n->'sales_count',
  'payment_only_sales_count',sales_n->'payment_only_sales_count','sales_summary',private.crm_sales_account_v53(sales_n),'rows',rows_n,
  'cash_total',answer_n->'revenue'->'total','procedures_total',answer_n->'revenue'->'total','sales_total',0);
end $$;

create or replace function private.crm_dashboard_day_v25(p_date date default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer_n jsonb;sales_n jsonb;day_n date;shifts_n jsonb;drawers_n jsonb;
begin
 -- Both scoped engines enforce the released active manager authorization.
 answer_n:=private.crm_dashboard_day_kind_v53(p_date,'procedure');sales_n:=private.crm_dashboard_day_kind_v53(p_date,'sale');
 day_n:=(answer_n->>'date')::date;
 select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') into shifts_n from public.shifts where shift_date=day_n;
 drawers_n:=private.crm_cash_drawers_period_v30(shifts_n,false);
 return answer_n||drawers_n||jsonb_build_object('sales_separate',true,'revenue_scope','procedures',
  'sales_summary',private.crm_sales_account_v53(sales_n->'working_day'),
  'working_day',(answer_n->'working_day')||drawers_n||jsonb_build_object('sales_separate',true,'revenue_scope','procedures',
   'sales_count',sales_n->'working_day'->'sales_count','cash_total',answer_n->'working_day'->'revenue'->'total',
   'procedures_total',answer_n->'working_day'->'revenue'->'total','sales_total',0,'sales_summary',private.crm_sales_account_v53(sales_n->'working_day'),
   'cash_after_salary',drawers_n->'cash_drawer'->'balance','cash_after_salary_semantics','actual_cash_balance'),
  'receipts_day',(answer_n->'receipts_day')||jsonb_build_object('sales_separate',true,'revenue_scope','procedures',
   'sales_count',sales_n->'receipts_day'->'sales_count','cash_total',answer_n->'receipts_day'->'revenue'->'total',
   'procedures_total',answer_n->'receipts_day'->'revenue'->'total','sales_total',0,'sales_summary',private.crm_sales_account_v53(sales_n->'receipts_day')));
end $$;

notify pgrst,'reload schema';
commit;
