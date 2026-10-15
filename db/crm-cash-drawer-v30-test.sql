-- Run AFTER crm-debt-ledger-v29.sql and crm-cash-drawer-v30.sql.
-- Public RPC acceptance with synthetic identities and payments; everything rolls back.
begin;
create temporary table v30_existing_reports as select shift_id,report from private.crm_shift_reports;

create function pg_temp.v30_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v30 acceptance: %',message;end if;end $$;
create function pg_temp.v30_payload(p jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('shift_id',current_setting('test.v30.shift'))||p
$$;
create function pg_temp.v30_actor(key_n text) returns void language plpgsql as $$
declare user_n text:=current_setting('test.v30.'||key_n);
begin
 perform set_config('request.jwt.claim.sub',user_n,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',user_n,'role','authenticated')::text,true);
end $$;
create function pg_temp.v30_state() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'openings',(select jsonb_agg(to_jsonb(o) order by o.shift_id) from private.crm_cash_openings_v30 o
   where o.shift_id in(current_setting('test.v30.shift')::uuid,current_setting('test.v30.later_shift')::uuid,current_setting('test.v30.foreign_shift')::uuid)),
  'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from private.crm_cash_movements_v30 m
   where m.shift_id in(current_setting('test.v30.shift')::uuid,current_setting('test.v30.later_shift')::uuid,current_setting('test.v30.foreign_shift')::uuid)),
  'requests',(select jsonb_agg(to_jsonb(r) order by r.request_id) from private.crm_cash_requests_v30 r
   where r.payload->>'shift_id' in(current_setting('test.v30.shift'),current_setting('test.v30.later_shift'),current_setting('test.v30.foreign_shift'))),
  'audit',(select count(*) from private.crm_audit_log where entity_id in(
   current_setting('test.v30.shift'),current_setting('test.v30.later_shift'),current_setting('test.v30.foreign_shift'))))
$$;
create function pg_temp.v30_reject(action_n text,payload_n jsonb,request_n uuid default null) returns void language plpgsql as $$
declare before_n jsonb:=pg_temp.v30_state();failed_n boolean:=false;
begin
 begin perform public.crm_cash_drawer_v30(action_n,payload_n,request_n);
 exception when others then failed_n:=true;end;
 perform pg_temp.v30_assert(failed_n,'Invalid/forbidden cash operation succeeded: '||coalesce(action_n,'NULL'));
 perform pg_temp.v30_assert(pg_temp.v30_state()=before_n,'Rejected cash operation changed state: '||coalesce(action_n,'NULL'));
end $$;

do $$declare owner_u uuid:=gen_random_uuid();nurse_u uuid:=gen_random_uuid();outside_u uuid:=gen_random_uuid();inactive_u uuid:=gen_random_uuid();
 owner_s uuid;nurse_s uuid;outside_s uuid;inactive_s uuid;shift_n uuid;later_n uuid;foreign_n uuid;patient_n uuid;service_n uuid;
begin
 insert into auth.users(id,email) values(owner_u,owner_u::text||'@cash-v30.example.invalid'),
  (nurse_u,nurse_u::text||'@cash-v30.example.invalid'),(outside_u,outside_u::text||'@cash-v30.example.invalid'),
  (inactive_u,inactive_u::text||'@cash-v30.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cash owner v30','owner',true,owner_u) returning id into owner_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cash nurse v30','nurse',true,nurse_u) returning id into nurse_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cash outside nurse v30','nurse',true,outside_u) returning id into outside_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cash inactive nurse v30','nurse',false,inactive_u) returning id into inactive_s;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2098-01-21',timestamptz '2098-01-21 08:00+03',timestamptz '2098-01-21 12:00+03','open') returning id into shift_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2098-01-21',timestamptz '2098-01-21 13:00+03',timestamptz '2098-01-21 17:00+03','open') returning id into later_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2098-01-22',timestamptz '2098-01-22 08:00+03',timestamptz '2098-01-22 12:00+03','open') returning id into foreign_n;
 insert into public.shift_staff(shift_id,staff_id) values(shift_n,nurse_s),(later_n,outside_s),(foreign_n,outside_s);
 insert into public.patients(full_name) values('TEST cash patient v30') returning id into patient_n;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST cash procedure v30',600,0,true) returning id into service_n;
 update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
 perform set_config('test.v30.owner',owner_u::text,true);perform set_config('test.v30.nurse',nurse_u::text,true);
 perform set_config('test.v30.outside',outside_u::text,true);perform set_config('test.v30.inactive',inactive_u::text,true);
 perform set_config('test.v30.nurse_staff',nurse_s::text,true);perform set_config('test.v30.outside_staff',outside_s::text,true);
 perform set_config('test.v30.shift',shift_n::text,true);perform set_config('test.v30.later_shift',later_n::text,true);
 perform set_config('test.v30.foreign_shift',foreign_n::text,true);perform set_config('test.v30.patient',patient_n::text,true);
 perform set_config('test.v30.service',service_n::text,true);
 perform pg_temp.v30_actor('nurse');
end $$;

set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid;drawer_n jsonb;state_n jsonb;begin
 p:=pg_temp.v30_payload(jsonb_build_object('patient_id',current_setting('test.v30.patient'),
  'nurse_id',current_setting('test.v30.nurse_staff'),'service_id',current_setting('test.v30.service'),
  'items','[]'::jsonb,'charge_total',600,'expected_stock_deducted',false,'notes','TEST cash acceptance v30'));
 perform public.record_treatment_v5('procedure',p||'{"payment_status":"paid","payments":{"cash":600}}',gen_random_uuid());
 perform public.record_treatment_v5('procedure',p||'{"payment_status":"paid","payments":{"terminal":400,"owner_card":200}}',gen_random_uuid());
 a:=public.record_treatment_v5('procedure',p||'{"payment_status":"pending","payments":{"cash":0}}',gen_random_uuid());
 req:=gen_random_uuid();
 perform public.crm_clinical_v10('debt_payment',pg_temp.v30_payload(jsonb_build_object('kind','procedure','id',a->>'id',
  'nurse_id',current_setting('test.v30.nurse_staff'),'payments',jsonb_build_object('cash',600),'comment','TEST ordinary after-procedure payment v30')),req);
 perform set_config('test.v30.pending_receipt',req::text,true);
 a:=public.record_treatment_v5('procedure',p||'{"payment_status":"debt","payments":{"cash":0}}',gen_random_uuid());
 perform set_config('test.v30.debt_procedure',a->>'id',true);
 state_n:=pg_temp.v30_state();
 drawer_n:=public.crm_cash_drawer_v30('status',pg_temp.v30_payload());
 perform pg_temp.v30_assert(drawer_n->'opening'='null'::jsonb and drawer_n->'balance'='null'::jsonb
  and not(drawer_n->>'opening_confirmed')::boolean,'Unknown opening was guessed from the global float');
 perform pg_temp.v30_assert((drawer_n->>'received_cash')::numeric=1200 and (drawer_n->>'salary_paid')::numeric=0
  and (drawer_n->'payroll'->0->>'configured')::numeric=2000 and (drawer_n->'payroll'->0->>'outstanding')::numeric=2000,
  'Cards entered cash, ordinary after-procedure cash was lost, or default wages were assumed paid');
 perform pg_temp.v30_assert(pg_temp.v30_state()=state_n,'Cash status read changed state');
 perform pg_temp.v30_reject('movement_add',pg_temp.v30_payload('{"type":"cash_in","amount":100,"reason":"TEST opening first"}'),gen_random_uuid());
 perform pg_temp.v30_reject('movement_add',pg_temp.v30_payload('{"type":"expense","amount":1,"reason":"TEST opening first"}'),gen_random_uuid());
 req:=gen_random_uuid();p:=pg_temp.v30_payload('{"amount":500,"reason":"TEST counted opening v30"}');
 a:=public.crm_cash_drawer_v30('opening_set',p,req);state_n:=pg_temp.v30_state();
 perform pg_temp.v30_assert((a->>'balance')::numeric=1700,'Opening + normal physical cash is incorrect');
 perform pg_temp.v30_assert(public.crm_cash_drawer_v30('opening_set',p,req)=a and pg_temp.v30_state()=state_n,'Opening replay changed state');
 perform pg_temp.v30_reject('opening_set',p||'{"amount":600}',req);
 perform pg_temp.v30_reject('opening_set',p,gen_random_uuid());
 perform pg_temp.v30_reject('movement_add',pg_temp.v30_payload('{"type":"expense","amount":1,"reason":"TEST missing request"}'));
 foreach p in array array['{"type":"expense","amount":0,"reason":"TEST zero"}'::jsonb,
  '{"type":"expense","amount":-1,"reason":"TEST negative"}',
  '{"type":"expense","amount":1.001,"reason":"TEST cent precision"}',
  '{"type":"cash_in","amount":"NaN","reason":"TEST nonfinite"}',
  '{"type":"cash_in","amount":"Infinity","reason":"TEST nonfinite"}',
  '{"type":"cash_in","amount":1000000000000,"reason":"TEST out of range"}',
  '{"type":"expense","amount":1,"reason":"   "}',
  '{"type":"expense","amount":1700.01,"reason":"TEST insufficient physical cash"}',
  '{"type":"terminal","amount":1,"reason":"TEST noncash type"}'] loop
  perform pg_temp.v30_reject('movement_add',pg_temp.v30_payload(p),gen_random_uuid());
 end loop;
 perform pg_temp.v30_reject('movement_add',pg_temp.v30_payload(jsonb_build_object('type','salary','staff_id',current_setting('test.v30.outside_staff'),
  'amount',1,'reason','TEST salary outside shift')),gen_random_uuid());
 req:=gen_random_uuid();p:=pg_temp.v30_payload(jsonb_build_object('type','salary','staff_id',current_setting('test.v30.nurse_staff'),
  'amount',500,'reason','TEST actual salary paid v30'));
 a:=public.crm_cash_drawer_v30('movement_add',p,req);state_n:=pg_temp.v30_state();
 perform set_config('test.v30.salary_movement',req::text,true);
 perform pg_temp.v30_assert((a->>'salary_paid')::numeric=500 and (a->>'balance')::numeric=1200
  and (a->'payroll'->0->>'outstanding')::numeric=1500,'Actual payout did not reduce physical cash exactly once');
 perform pg_temp.v30_assert(public.crm_cash_drawer_v30('movement_add',p,req)=a and pg_temp.v30_state()=state_n,'Salary replay paid twice');
 perform pg_temp.v30_reject('movement_add',p||'{"amount":1500.01}',gen_random_uuid());
 req:=gen_random_uuid();
 perform public.crm_cash_drawer_v30('movement_add',pg_temp.v30_payload('{"type":"expense","amount":100,"reason":"TEST expense v30"}'),req);
 perform set_config('test.v30.expense',req::text,true);
 perform public.crm_cash_drawer_v30('movement_add',pg_temp.v30_payload('{"type":"refund","amount":50,"reason":"TEST refund v30"}'),gen_random_uuid());
 perform public.crm_cash_drawer_v30('movement_add',pg_temp.v30_payload('{"type":"owner_withdrawal","amount":150,"reason":"TEST owner withdrawal v30"}'),gen_random_uuid());
 req:=gen_random_uuid();
 a:=public.crm_cash_drawer_v30('movement_add',pg_temp.v30_payload('{"type":"cash_in","amount":200,"reason":"TEST top up v30"}'),req);
 perform set_config('test.v30.topup',req::text,true);
 perform pg_temp.v30_assert((a->>'balance')::numeric=1100 and (a->>'cash_out')::numeric=300 and (a->>'cash_in')::numeric=200,
  'Expense/refund/withdrawal/top-up signs are incorrect');
 perform pg_temp.v30_reject('movement_void',pg_temp.v30_payload(jsonb_build_object('id',current_setting('test.v30.expense'),'reason','TEST nurse cannot void')),gen_random_uuid());
 -- Assigned cash access must not expose warehouse/profit fields via a report.
 a:=public.crm_finance_v5('shift_report',pg_temp.v30_payload());
 perform pg_temp.v30_assert(a->'cash_drawer'->>'balance'='1100.00' or (a->'cash_drawer'->>'balance')::numeric=1100,'Nurse report lost current actual cash');
 perform pg_temp.v30_assert(not(a ? 'stock') and not(a ? 'profit') and not(a ? 'float_amount')
  and not exists(select 1 from jsonb_array_elements(a->'staff') st where st ? 'reason'),'Cash overlay exposed manager-only report details');
end $$;
reset role;
-- Keep exact period/calendar assertions independent of wall-clock receipt dates.
update public.procedures set visit_at=timestamptz '2098-01-21 10:00+03',arrival_at=timestamptz '2098-01-21 10:00+03'
 where shift_id=current_setting('test.v30.shift')::uuid;
update private.crm_receipts_v10 set created_at=timestamptz '2098-01-21 11:00+03'
 where id=current_setting('test.v30.pending_receipt')::uuid;

select pg_temp.v30_actor('owner');
set local role authenticated;
do $$declare a jsonb;p jsonb;req uuid;state_n jsonb;failed_n boolean;begin
 -- True debt repayment is money kept separately, even when its bill belongs to this shift.
 perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',current_setting('test.v30.debt_procedure'),
  'amount',300,'paid_on','2098-01-21','purpose','TEST separate true-debt repayment v30'),gen_random_uuid());
 a:=public.crm_cash_drawer_v30('status',pg_temp.v30_payload());
 perform pg_temp.v30_assert((a->>'received_cash')::numeric=1200 and (a->>'balance')::numeric=1100,
  'Separate true-debt collection entered the shift drawer');
 p:=pg_temp.v30_payload(jsonb_build_object('id',current_setting('test.v30.expense'),'reason','TEST manager expense void v30'));
 req:=gen_random_uuid();a:=public.crm_cash_drawer_v30('movement_void',p,req);state_n:=pg_temp.v30_state();
 perform pg_temp.v30_assert((a->>'cash_out')::numeric=200 and (a->>'balance')::numeric=1200,'Voided expense did not restore physical cash');
 perform pg_temp.v30_assert(public.crm_cash_drawer_v30('movement_void',p,req)=a and pg_temp.v30_state()=state_n,'Void replay changed cash or audit');
 perform pg_temp.v30_reject('movement_void',p,gen_random_uuid());
 a:=public.crm_cash_drawer_v30('movement_void',pg_temp.v30_payload(jsonb_build_object('id',current_setting('test.v30.topup'),
  'reason','TEST manager topup void v30')),gen_random_uuid());
 perform pg_temp.v30_assert((a->>'balance')::numeric=1000 and (a->>'cash_in')::numeric=0,'Voided top-up did not remove its physical cash');
 failed_n:=false;
 begin perform public.crm_finance_v5('salary',pg_temp.v30_payload(jsonb_build_object('staff_id',current_setting('test.v30.nurse_staff'),
  'amount',499,'reason','TEST configured wage below actual payout')));
 exception when others then failed_n:=true;end;
 perform pg_temp.v30_assert(failed_n,'Configured wages were reduced below already paid cash');
 perform public.crm_finance_v5('salary',pg_temp.v30_payload(jsonb_build_object('staff_id',current_setting('test.v30.nurse_staff'),
  'amount',600,'reason','TEST wage configuration remains separate v30')));
 a:=public.crm_cash_drawer_v30('status',pg_temp.v30_payload());
 perform pg_temp.v30_assert((a->>'salary_paid')::numeric=500 and (a->>'balance')::numeric=1000
  and (a->'payroll'->0->>'configured')::numeric=600 and (a->'payroll'->0->>'outstanding')::numeric=100,
  'Changing configured wages was treated as a cash payout');
 perform pg_temp.v30_reject('movement_add',pg_temp.v30_payload(jsonb_build_object('type','salary','staff_id',current_setting('test.v30.nurse_staff'),
  'amount',100.01,'reason','TEST overpayment guard with sufficient drawer cash')),gen_random_uuid());
 -- A second shift has its own counted opening; period balances are not additive.
 p:=jsonb_build_object('shift_id',current_setting('test.v30.later_shift'),'amount',0,'reason','TEST later opening v30');
 perform public.crm_cash_drawer_v30('opening_set',p,gen_random_uuid());
 req:=gen_random_uuid();
 perform public.crm_cash_drawer_v30('movement_add',p||'{"type":"cash_in","amount":100,"reason":"TEST topup spent v30"}',req);
 perform set_config('test.v30.spent_topup',req::text,true);
 perform public.crm_cash_drawer_v30('movement_add',p||'{"type":"expense","amount":100,"reason":"TEST expense used topup v30"}',gen_random_uuid());
 perform pg_temp.v30_reject('movement_void',jsonb_build_object('shift_id',current_setting('test.v30.later_shift'),'id',req,
  'reason','TEST spent topup must not create negative cash'),gen_random_uuid());
 perform pg_temp.v30_reject('movement_void',pg_temp.v30_payload(jsonb_build_object('id',req,'reason','TEST cross-shift movement id')),gen_random_uuid());
 a:=public.crm_finance_v5('summary','{"from":"2098-01-21","to":"2098-01-21","group_by":"day"}');
 perform pg_temp.v30_assert((a->'cash_drawer'->>'balance')::numeric=0 and a->'cash_drawer'->>'scope'='latest_shift'
  and a->'cash_drawer'->>'shift_id'=current_setting('test.v30.later_shift') and jsonb_array_length(a->'cash_drawers')=2,
  'Period summary summed balances/openings instead of identifying the latest drawer');
 perform pg_temp.v30_assert((a->'cash_drawer_period_totals'->>'received_cash')::numeric=1200
  and (a->'cash_drawer_period_totals'->>'salary_paid')::numeric=500
  and (a->'cash_drawer_period_totals'->>'cash_out')::numeric=300,'Period movement totals are incorrect');
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2098-01-21','to','2098-01-21','patient_id',current_setting('test.v30.patient')));
 perform pg_temp.v30_assert(a->'cash_drawer'->>'scope'='not_applicable_to_entity_filter' and a->'cash_drawer'->'balance'='null'::jsonb,
  'Patient-filtered summary presented a physical drawer balance');
 a:=public.crm_dashboard_day_v25('2098-01-21');
 perform pg_temp.v30_assert((a->'working_day'->'cash_drawer'->>'balance')::numeric=0
  and (a->'working_day'->>'cash_after_salary')::numeric=0,'Dashboard uses card revenue/accrued wages or summed shift balances');
 perform public.crm_finance_v5('close',pg_temp.v30_payload());
end $$;
reset role;
create temporary table v30_closed_snapshot as select report from private.crm_shift_reports where shift_id=current_setting('test.v30.shift')::uuid;

select pg_temp.v30_actor('nurse');
set local role authenticated;
do $$begin
 perform public.crm_cash_drawer_v30('status',pg_temp.v30_payload());
 perform pg_temp.v30_reject('movement_add',pg_temp.v30_payload('{"type":"cash_in","amount":1,"reason":"TEST closed nurse shift"}'),gen_random_uuid());
 perform pg_temp.v30_reject('opening_set',pg_temp.v30_payload('{"amount":600,"reason":"TEST closed nurse opening"}'),gen_random_uuid());
 perform pg_temp.v30_reject('status',jsonb_build_object('shift_id',current_setting('test.v30.foreign_shift')));
 perform pg_temp.v30_reject('opening_set',jsonb_build_object('shift_id',current_setting('test.v30.foreign_shift'),
  'amount',100,'reason','TEST foreign nurse opening'),gen_random_uuid());
end $$;
reset role;

select pg_temp.v30_actor('owner');
set local role authenticated;
do $$declare a jsonb;p jsonb;req uuid;state_n jsonb;begin
 p:=pg_temp.v30_payload('{"amount":600,"reason":"TEST audited closed opening correction v30"}');req:=gen_random_uuid();
 a:=public.crm_cash_drawer_v30('opening_set',p,req);state_n:=pg_temp.v30_state();
 perform pg_temp.v30_assert((a->>'balance')::numeric=1100,'Manager could not correct a closed drawer');
 perform pg_temp.v30_assert(public.crm_cash_drawer_v30('opening_set',p,req)=a and pg_temp.v30_state()=state_n,'Manager correction replay changed state');
 a:=public.crm_finance_v5('shift_report',pg_temp.v30_payload());
 perform pg_temp.v30_assert((a->'cash_drawer'->>'balance')::numeric=1100 and (a->>'cash_after_salary')::numeric=1100,
  'Closed report did not overlay the audited actual cash balance');
 a:=public.crm_cash_drawer_v30('movement_void',pg_temp.v30_payload(jsonb_build_object('id',current_setting('test.v30.salary_movement'),
  'reason','TEST actual salary payout was cancelled v30')),gen_random_uuid());
 perform pg_temp.v30_assert((a->>'salary_paid')::numeric=0 and (a->>'balance')::numeric=1600
  and (a->'payroll'->0->>'outstanding')::numeric=600,'Voiding salary failed to restore cash or changed configured wages');
 perform pg_temp.v30_assert(exists(select 1 from jsonb_array_elements(a->'movements') m
  where m->>'id'=current_setting('test.v30.salary_movement') and m->>'voided_at' is not null),
  'Voiding erased the payout history');
 perform public.crm_cash_drawer_v30('status',jsonb_build_object('shift_id',current_setting('test.v30.foreign_shift')));
end $$;
reset role;

select pg_temp.v30_actor('outside');
set local role authenticated;
do $$begin
 perform pg_temp.v30_reject('status',pg_temp.v30_payload());
 perform pg_temp.v30_reject('movement_add',pg_temp.v30_payload('{"type":"cash_in","amount":1,"reason":"TEST unauthorized shift"}'),gen_random_uuid());
 -- Same request ID cannot be reused by a different actor, even in their own shift.
 perform pg_temp.v30_reject('movement_add',jsonb_build_object('shift_id',current_setting('test.v30.later_shift'),
  'type','cash_in','amount',100,'reason','TEST topup spent v30'),current_setting('test.v30.spent_topup')::uuid);
end $$;
reset role;
select pg_temp.v30_actor('inactive');
set local role authenticated;
do $$begin perform pg_temp.v30_reject('status',pg_temp.v30_payload());end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
do $$begin perform pg_temp.v30_reject('status',pg_temp.v30_payload());end $$;
reset role;

do $$begin
 perform pg_temp.v30_assert(not has_function_privilege('anon','public.crm_cash_drawer_v30(text,jsonb,uuid)','EXECUTE'),
  'Anonymous cash RPC is executable');
 perform pg_temp.v30_assert(not has_function_privilege('authenticated','private.crm_cash_drawer_facts_v30(uuid,numeric)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_cash_drawers_period_v30(jsonb,boolean)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_build_shift_report_v5_before_v30(uuid)','EXECUTE'),
  'Unguarded cash/report helpers are executable');
 perform pg_temp.v30_assert(not has_table_privilege('authenticated','private.crm_cash_openings_v30','SELECT')
  and not has_table_privilege('authenticated','private.crm_cash_movements_v30','SELECT')
  and not has_table_privilege('authenticated','private.crm_cash_requests_v30','SELECT'),'Private cash tables are readable');
 perform pg_temp.v30_assert(not exists(select 1 from v30_existing_reports old_n left join private.crm_shift_reports now_n using(shift_id)
  where old_n.report is distinct from now_n.report),'Existing historical report was rewritten');
 perform pg_temp.v30_assert((select report from v30_closed_snapshot)=(select report from private.crm_shift_reports
  where shift_id=current_setting('test.v30.shift')::uuid),'Cash corrections/reads rewrote a frozen closed report');
 perform pg_temp.v30_assert((select amount from private.crm_shift_payroll where shift_id=current_setting('test.v30.shift')::uuid
  and staff_id=current_setting('test.v30.nurse_staff')::uuid)=600,'Payout operations rewrote configured wages');
 perform pg_temp.v30_assert((select count(*) from private.crm_audit_log where entity_id=current_setting('test.v30.shift')
  and action='cash_drawer_movement_add_v30')=5,'Payout/topup replays or failures created extra cash audit events');
end $$;
select 'crm-cash-drawer-v30 actual cash, opening, payout, void, period and access acceptance passed' as result;
rollback;
