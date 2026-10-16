-- Run after crm-auto-salary-v36.sql on a local/test database. All fixtures roll back.
begin;
create function pg_temp.v36_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v36 acceptance: %',label;end if;end $$;
create function pg_temp.v36_actor(key_n text) returns void language plpgsql as $$
declare user_n text:=current_setting('test.v36.'||key_n);
begin
 perform set_config('request.jwt.claim.sub',user_n,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',user_n,'role','authenticated')::text,true);
end $$;
create function pg_temp.v36_payload(extra jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('shift_id',current_setting('test.v36.shift'))||extra
$$;
create function pg_temp.v36_state() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'payroll',(select jsonb_agg(to_jsonb(w) order by w.shift_id,w.staff_id) from private.crm_shift_payroll w
   where w.shift_id in(current_setting('test.v36.shift')::uuid,current_setting('test.v36.two')::uuid,current_setting('test.v36.empty')::uuid)),
  'openings',(select jsonb_agg(to_jsonb(o) order by o.shift_id) from private.crm_cash_openings_v30 o
   where o.shift_id in(current_setting('test.v36.shift')::uuid,current_setting('test.v36.two')::uuid,current_setting('test.v36.empty')::uuid)),
  'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from private.crm_cash_movements_v30 m
   where m.shift_id in(current_setting('test.v36.shift')::uuid,current_setting('test.v36.two')::uuid,current_setting('test.v36.empty')::uuid)),
  'cash_requests',(select count(*) from private.crm_cash_requests_v30),
  'receipts',(select count(*) from private.crm_receipts_v10),
  'audit',(select count(*) from private.crm_audit_log),
  'reports',(select jsonb_agg(to_jsonb(r) order by r.shift_id) from private.crm_shift_reports r))
$$;

do $$declare owner_u uuid:=gen_random_uuid();nurse_u uuid:=gen_random_uuid();other_u uuid:=gen_random_uuid();
 owner_s uuid;nurse_s uuid;other_s uuid;shift_n uuid;two_n uuid;empty_n uuid;patient_n uuid;service_n uuid;
begin
 insert into auth.users(id,email) values(owner_u,owner_u::text||'@auto-salary-v36.example.invalid'),
  (nurse_u,nurse_u::text||'@auto-salary-v36.example.invalid'),(other_u,other_u::text||'@auto-salary-v36.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST auto salary owner v36','owner',true,owner_u) returning id into owner_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST auto salary nurse v36','nurse',true,nurse_u) returning id into nurse_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST auto salary other nurse v36','nurse',true,other_u) returning id into other_s;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2098-02-01',timestamptz '2098-02-01 08:30+03',timestamptz '2098-02-01 16:00+03','open') returning id into shift_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2098-02-02',timestamptz '2098-02-02 08:30+03',timestamptz '2098-02-02 16:00+03','open') returning id into two_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2098-02-03',timestamptz '2098-02-03 08:30+03',timestamptz '2098-02-03 16:00+03','open') returning id into empty_n;
 insert into public.shift_staff(shift_id,staff_id) values(shift_n,nurse_s),(two_n,nurse_s),(two_n,other_s);
 -- Simulate an old incomplete payroll. Reads may default but must not backfill it.
 delete from private.crm_shift_payroll where shift_id=two_n and staff_id=other_s;
 -- A payroll row alone never assigns an owner to a nursing shift.
 insert into private.crm_shift_payroll(shift_id,staff_id,amount) values(shift_n,owner_s,2000);
 insert into public.patients(full_name) values('TEST auto salary patient v36') returning id into patient_n;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST auto salary service v36',10000,0,true) returning id into service_n;
 update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
 perform set_config('test.v36.owner',owner_u::text,true);perform set_config('test.v36.nurse',nurse_u::text,true);
 perform set_config('test.v36.other',other_u::text,true);perform set_config('test.v36.nurse_staff',nurse_s::text,true);
 perform set_config('test.v36.other_staff',other_s::text,true);perform set_config('test.v36.owner_staff',owner_s::text,true);
 perform set_config('test.v36.shift',shift_n::text,true);perform set_config('test.v36.two',two_n::text,true);
 perform set_config('test.v36.empty',empty_n::text,true);perform set_config('test.v36.patient',patient_n::text,true);
 perform set_config('test.v36.service',service_n::text,true);
 perform pg_temp.v36_actor('owner');
end $$;

set local role authenticated;
do $$declare p jsonb;a jsonb;b jsonb;before_n jsonb;req uuid;failed_n boolean;
begin
 p:=pg_temp.v36_payload(jsonb_build_object('patient_id',current_setting('test.v36.patient'),
  'nurse_id',current_setting('test.v36.nurse_staff'),'service_id',current_setting('test.v36.service'),
  'items','[]'::jsonb,'charge_total',10000,'expected_stock_deducted',false));
 perform public.record_treatment_v5('procedure',p||'{"payment_status":"paid","payments":{"cash":10000}}',gen_random_uuid());
 perform public.record_treatment_v5('procedure',p||'{"payment_status":"paid","payments":{"cash":2000,"terminal":3000,"owner_card":5000}}',gen_random_uuid());
 a:=public.record_treatment_v5('procedure',p||'{"payment_status":"pending","payments":{"cash":0}}',gen_random_uuid());
 perform public.crm_clinical_v10('debt_payment',pg_temp.v36_payload(jsonb_build_object('kind','procedure','id',a->>'id',
  'nurse_id',current_setting('test.v36.nurse_staff'),'payments',jsonb_build_object('cash',1000))),gen_random_uuid());
 a:=public.record_treatment_v5('procedure',p||'{"payment_status":"debt","payments":{"cash":0}}',gen_random_uuid());
 -- Explicit cash method on a true debt collection still belongs outside the shift.
 perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',a->>'id',
  'payments',jsonb_build_object('cash',500),'comment','TEST separately stored debt cash v36'),gen_random_uuid());
 before_n:=pg_temp.v36_state();
 a:=public.crm_cash_drawer_v30('status',pg_temp.v36_payload());
 perform pg_temp.v36_assert((a->>'salary_auto')::boolean and (a->>'salary_auto_total')::numeric=2000
  and (a->>'salary_auto_remaining')::numeric=2000 and (a->>'salary_deduction')::numeric=2000,
  'One assigned nurse must deduct 2000, without an extra owner salary');
 perform pg_temp.v36_assert((a->>'received_cash')::numeric=13000 and (a->>'cash_after_salary_auto')::numeric=11000
  and (a->>'salary_paid')::numeric=0 and a->'opening'='null'::jsonb and a->'balance'='null'::jsonb
  and not(a->>'opening_confirmed')::boolean,'Unknown opening/real payouts were fabricated, or noncash/debt entered shift cash');
 b:=public.crm_cash_drawer_v30('status',jsonb_build_object('shift_id',current_setting('test.v36.two')));
 perform pg_temp.v36_assert((b->>'salary_auto_total')::numeric=4000 and (b->>'salary_auto_remaining')::numeric=4000
  and (b->>'cash_after_salary_auto')::numeric=-4000,'Two nurses or historical default payroll are incorrect');
 perform pg_temp.v36_assert(jsonb_array_length(b->'salary_auto_payroll')=2 and exists(
  select 1 from jsonb_array_elements(b->'salary_auto_payroll') x where x->>'staff_id'=current_setting('test.v36.other_staff')
   and x->>'source'='default' and (x->>'configured')::numeric=2000 and (x->>'paid')::numeric=0
   and (x->>'outstanding')::numeric=2000),'Missing historical payroll was not exposed as a virtual default');
 b:=public.crm_cash_drawer_v30('status',jsonb_build_object('shift_id',current_setting('test.v36.empty')));
 perform pg_temp.v36_assert((b->>'salary_auto_total')::numeric=0 and (b->>'cash_after_salary_auto')::numeric=0,
  'An owner viewing an empty shift received a nursing salary');
 perform pg_temp.v36_assert(pg_temp.v36_state()=before_n,'Status reads wrote payroll, cash, receipt, report or audit metadata');
 -- Normal wages remain real physical cash until a payout is actually recorded.
 perform public.crm_cash_drawer_v30('opening_set',pg_temp.v36_payload('{"amount":0,"reason":"TEST actual zero opening v36"}'),gen_random_uuid());
 req:=gen_random_uuid();p:=pg_temp.v36_payload(jsonb_build_object('type','salary','staff_id',current_setting('test.v36.nurse_staff'),
  'amount',1000,'reason','TEST partial real payout v36'));
 a:=public.crm_cash_drawer_v30('movement_add',p,req);before_n:=pg_temp.v36_state();
 perform pg_temp.v36_assert((a->>'salary_paid')::numeric=1000 and (a->>'salary_auto_remaining')::numeric=1000
  and (a->>'salary_deduction')::numeric=2000 and (a->>'balance')::numeric=12000
  and (a->>'cash_after_salary_auto')::numeric=11000,'Partial real payout deducted salary twice');
 perform pg_temp.v36_assert(public.crm_cash_drawer_v30('movement_add',p,req)=a and pg_temp.v36_state()=before_n,
  'Replayed payout created a second actual or automatic deduction');
 -- This exceeds salary-reserved cash (11000), but not physical cash (12000).
 a:=public.crm_cash_drawer_v30('movement_add',pg_temp.v36_payload('{"type":"expense","amount":11900,"reason":"TEST physical cash guard v36"}'),gen_random_uuid());
 perform pg_temp.v36_assert((a->>'balance')::numeric=100 and (a->>'cash_after_salary_auto')::numeric=-900,
  'An automatic salary allowance changed physical cash mutation guards');
 failed_n:=false;
 begin perform public.crm_cash_drawer_v30('movement_add',pg_temp.v36_payload('{"type":"expense","amount":100.01,"reason":"TEST still reject physical overdraft v36"}'),gen_random_uuid());
 exception when others then failed_n:=true;end;
 perform pg_temp.v36_assert(failed_n,'Physical cash overdraft became allowed');
 a:=public.crm_cash_drawer_v30('movement_add',pg_temp.v36_payload('{"type":"cash_in","amount":1000,"reason":"TEST restore funds v36"}'),gen_random_uuid());
 a:=public.crm_cash_drawer_v30('movement_add',pg_temp.v36_payload(jsonb_build_object('type','salary','staff_id',current_setting('test.v36.nurse_staff'),
  'amount',1000,'reason','TEST final real payout v36')),gen_random_uuid());
 perform pg_temp.v36_assert((a->>'salary_paid')::numeric=2000 and (a->>'salary_auto_remaining')::numeric=0
  and (a->>'salary_deduction')::numeric=2000 and (a->>'balance')::numeric=100
  and (a->>'cash_after_salary_auto')::numeric=100,'Fully marked wages were deducted a second time');
 a:=public.crm_cash_drawer_v30('opening_set',pg_temp.v36_payload('{"amount":500,"reason":"TEST actual known opening v36"}'),gen_random_uuid());
 perform pg_temp.v36_assert((a->>'balance')::numeric=600 and (a->>'cash_after_salary_auto')::numeric=600,
  'Known opening was omitted from either cash balance');
end $$;
reset role;

-- Explicit zero/custom wages, per-employee overpayment and former staff payouts.
do $$declare a jsonb;two_n uuid:=current_setting('test.v36.two')::uuid;
begin
 update private.crm_shift_payroll set amount=0 where shift_id=two_n and staff_id=current_setting('test.v36.nurse_staff')::uuid;
 insert into private.crm_shift_payroll(shift_id,staff_id,amount) values(two_n,current_setting('test.v36.other_staff')::uuid,2500);
 a:=private.crm_cash_drawer_facts_v30(two_n);
 perform pg_temp.v36_assert((a->>'salary_auto_total')::numeric=2500 and (a->>'salary_deduction')::numeric=2500,
  'Explicit zero/custom wages were replaced with the standard amount');
 update private.crm_shift_payroll set amount=2000 where shift_id=two_n;
 -- Historical data can contain an overpayment; never let it pay the other nurse.
 insert into private.crm_cash_movements_v30(id,shift_id,type,amount,reason,staff_id,created_by)
 values(gen_random_uuid(),two_n,'salary',3000,'TEST historical overpayment v36',current_setting('test.v36.nurse_staff')::uuid,current_setting('test.v36.owner')::uuid),
  (gen_random_uuid(),two_n,'salary',300,'TEST historical former staff payout v36',current_setting('test.v36.owner_staff')::uuid,current_setting('test.v36.owner')::uuid);
 a:=private.crm_cash_drawer_facts_v30(two_n);
 perform pg_temp.v36_assert((a->>'salary_auto_total')::numeric=4000 and (a->>'salary_paid')::numeric=3300
  and (a->>'salary_auto_remaining')::numeric=2000 and (a->>'salary_deduction')::numeric=5300
  and (a->>'cash_after_salary_auto')::numeric=-5300,'Overpayment/former payout hid another employee salary or was counted twice');
 update private.crm_cash_movements_v30 set voided_at=now(),voided_by=current_setting('test.v36.owner')::uuid,void_reason='TEST historical payout void v36'
  where shift_id=two_n and staff_id=current_setting('test.v36.nurse_staff')::uuid;
 a:=private.crm_cash_drawer_facts_v30(two_n);
 perform pg_temp.v36_assert((a->>'salary_paid')::numeric=300 and (a->>'salary_auto_remaining')::numeric=4000
  and (a->>'salary_deduction')::numeric=4300,'Voided real payout remained counted or suppressed automatic salary');
end $$;

select pg_temp.v36_actor('owner');
set local role authenticated;
do $$declare a jsonb;before_n jsonb;begin
 before_n:=pg_temp.v36_state();
 a:=public.crm_finance_v5('summary','{"from":"2098-02-01","to":"2098-02-03","group_by":"day"}');
 perform pg_temp.v36_assert((a->>'salary_auto')::boolean and (a->>'salary_auto_total')::numeric=6000
  and (a->>'salary_auto_remaining')::numeric=4000 and (a->>'salary_deduction')::numeric=6300,
  'Period salary fields are from only the last drawer or lost employee-level deductions');
 perform pg_temp.v36_assert((a->'cash_drawer_period_totals'->>'salary_auto_total')::numeric=6000
  and (a->'cash_drawer_period_totals'->>'salary_deduction')::numeric=6300
  and a->'cash_drawer'->>'shift_id'=current_setting('test.v36.empty')
  and (a->'cash_drawer'->>'cash_after_salary_auto')::numeric=0,
  'Period salary totals or latest drawer cash were added incorrectly');
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2098-02-01','to','2098-02-03',
  'employee_id',current_setting('test.v36.nurse_staff'),'group_by','day'));
 perform pg_temp.v36_assert(a->>'payroll_scope'='employee_period_shifts'
  and (a->>'salary_auto_total')::numeric=4000 and (a->>'salary_auto_remaining')::numeric=2000
  and (a->>'salary_deduction')::numeric=4000
  and (a->'cash_drawer_period_totals'->>'salary_auto_total')::numeric=6000
  and (a->'cash_drawer'->>'salary_auto_total')::numeric=4000
  and (a->'cash_drawer'->>'cash_after_salary_auto')::numeric=-4300,
  'Employee filter salary was replaced by all nurses or changed the shared shift cash');
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2098-02-01','to','2098-02-03','patient_id',current_setting('test.v36.patient')));
 perform pg_temp.v36_assert(not coalesce((a->>'salary_auto')::boolean,false)
  and a->'cash_drawer'->>'scope'='not_applicable_to_entity_filter'
  and not(a->'cash_drawer'?'cash_after_salary_auto'),'Patient filter exposed a whole shift salary/cash result');
 a:=public.crm_finance_v5('shift_report',pg_temp.v36_payload());
 perform pg_temp.v36_assert((a->'cash_drawer'->>'salary_auto_total')::numeric=2000
  and (a->'cash_drawer'->>'cash_after_salary_auto')::numeric=600
  and (a->>'cash_after_salary')::numeric=600,'Shift report lost auto fields or changed legacy physical balance');
 perform pg_temp.v36_assert(pg_temp.v36_state()=before_n,'Financial report reads wrote metadata');
 perform public.crm_finance_v5('close',pg_temp.v36_payload());
end $$;
reset role;

select pg_temp.v36_actor('nurse');
set local role authenticated;
do $$declare a jsonb;failed_n boolean:=false;before_n jsonb;begin
 before_n:=pg_temp.v36_state();
 a:=public.crm_finance_v5('shift_report',pg_temp.v36_payload());
 perform pg_temp.v36_assert((a->'cash_drawer'->>'cash_after_salary_auto')::numeric=600 and not(a?'stock')
  and not(a?'profit'),'Assigned nurse lost closed-shift auto summary or received warehouse details');
 begin perform public.crm_cash_drawer_v30('opening_set',pg_temp.v36_payload('{"amount":0,"reason":"TEST closed nurse change v36"}'),gen_random_uuid());
 exception when others then failed_n:=true;end;
 perform pg_temp.v36_assert(failed_n and pg_temp.v36_state()=before_n,'Closed nurse mutation became possible');
end $$;
reset role;
select pg_temp.v36_actor('other');
set local role authenticated;
do $$declare failed_n boolean:=false;begin
 begin perform public.crm_cash_drawer_v30('status',pg_temp.v36_payload());exception when others then failed_n:=true;end;
 perform pg_temp.v36_assert(failed_n,'Unassigned nurse gained access to another shift');
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
do $$declare failed_n boolean:=false;begin
 begin perform public.crm_cash_drawer_v30('status',pg_temp.v36_payload());exception when others then failed_n:=true;end;
 perform pg_temp.v36_assert(failed_n,'Unauthenticated caller gained shift cash access');
end $$;
reset role;
do $$begin
 perform pg_temp.v36_assert(not has_function_privilege('anon','public.crm_cash_drawer_v30(text,jsonb,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_cash_drawer_facts_v30(uuid,numeric)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_cash_drawers_period_v30(jsonb,boolean)','EXECUTE')
  and not has_table_privilege('authenticated','private.crm_cash_movements_v30','SELECT'),'Private cash access or public RPC grants changed');
end $$;
select 'crm-auto-salary-v36 salary defaults, real payouts, cash guards, period totals and access acceptance passed' as result;
rollback;
