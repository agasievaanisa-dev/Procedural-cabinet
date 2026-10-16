-- Run after crm-cash-reconciliation-v37.sql on a local/test database.
-- Synthetic identities, revenue, payroll, counts and reports all roll back.
begin;

create function pg_temp.v37_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v37 acceptance: %',label;end if;end $$;
create function pg_temp.v37_actor(key_n text) returns void language plpgsql as $$
declare user_n text:=current_setting('test.v37.'||key_n);
begin
 perform set_config('request.jwt.claim.sub',user_n,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',user_n,'role','authenticated')::text,true);
end $$;
create function pg_temp.v37_payload(extra jsonb default '{}',shift_key text default 'shift') returns jsonb language sql as $$
 select jsonb_build_object('shift_id',current_setting('test.v37.'||shift_key))||extra
$$;
create function pg_temp.v37_count(counted numeric,confirmed boolean,reason_n text default '',shift_key text default 'shift') returns jsonb
language plpgsql as $$
declare p jsonb:=pg_temp.v37_payload('{}',shift_key);a jsonb;
begin
 a:=public.crm_cash_reconciliation_v37('status',p);
 return p||jsonb_build_object('expected_token',a->'reconciliation_v37'->>'token',
  'counted_cash',counted,'salary_confirmed',confirmed,'reason',reason_n);
end $$;
create function pg_temp.v37_state() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'counts',(select jsonb_agg(to_jsonb(c) order by c.id) from private.crm_cash_counts_v37 c),
  'openings',(select jsonb_agg(to_jsonb(o) order by o.shift_id) from private.crm_cash_openings_v30 o),
  'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from private.crm_cash_movements_v30 m),
  'payroll',(select jsonb_agg(to_jsonb(w) order by w.shift_id,w.staff_id) from private.crm_shift_payroll w),
  'requests',(select jsonb_agg(to_jsonb(r) order by r.request_id) from private.crm_cash_requests_v30 r),
  'receipts',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r),
  'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a),
  'reports',(select jsonb_agg(to_jsonb(r) order by r.shift_id) from private.crm_shift_reports r),
  'save_requests',(select count(*) from private.crm_save_requests_v16),
  'audit',(select count(*) from private.crm_audit_log),
  'shifts',(select jsonb_agg(to_jsonb(s) order by s.id) from public.shifts s))
$$;

do $$declare owner_u uuid:=gen_random_uuid();admin_u uuid:=gen_random_uuid();nurse_u uuid:=gen_random_uuid();
 other_u uuid:=gen_random_uuid();inactive_u uuid:=gen_random_uuid();owner_s uuid;admin_s uuid;nurse_s uuid;other_s uuid;
 shift_n uuid;empty_n uuid;unknown_n uuid;closed_n uuid;default_n uuid;patient_n uuid;service_n uuid;
begin
 insert into auth.users(id,email) values(owner_u,owner_u::text||'@count-v37.example.invalid'),
  (admin_u,admin_u::text||'@count-v37.example.invalid'),(nurse_u,nurse_u::text||'@count-v37.example.invalid'),
  (other_u,other_u::text||'@count-v37.example.invalid'),(inactive_u,inactive_u::text||'@count-v37.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cash count owner v37','owner',true,owner_u) returning id into owner_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cash count admin v37','admin',true,admin_u) returning id into admin_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cash count nurse v37','nurse',true,nurse_u) returning id into nurse_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cash count peer v37','nurse',true,other_u) returning id into other_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cash count inactive v37','owner',false,inactive_u);
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2098-03-01',timestamptz '2098-03-01 08:30+03',timestamptz '2098-03-01 16:00+03','open') returning id into shift_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2098-03-02',timestamptz '2098-03-02 08:30+03',timestamptz '2098-03-02 16:00+03','open') returning id into empty_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2098-03-03',timestamptz '2098-03-03 08:30+03',timestamptz '2098-03-03 16:00+03','open') returning id into unknown_n;
 -- An already-closed historical shift is still countable by an active manager.
 insert into public.shifts(shift_date,started_at,planned_end_at,status,ended_at)
  values(date '2098-03-04',timestamptz '2098-03-04 08:30+03',timestamptz '2098-03-04 16:00+03','closed',timestamptz '2098-03-04 16:00+03') returning id into closed_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2098-03-05',timestamptz '2098-03-05 08:30+03',timestamptz '2098-03-05 16:00+03','open') returning id into default_n;
 insert into public.shift_staff(shift_id,staff_id) values(shift_n,nurse_s),(shift_n,other_s),
  (empty_n,nurse_s),(default_n,nurse_s);
 perform pg_temp.v37_assert((select amount=2000 from private.crm_shift_payroll where shift_id=empty_n and staff_id=nurse_s),
  'Normal new nurse assignment did not persist the released default payroll');
 update private.crm_shift_payroll set amount=3000 where shift_id=shift_n and staff_id=other_s;
 -- An orphan payroll assignment must never pay an employee outside the shift.
 insert into private.crm_shift_payroll(shift_id,staff_id,amount) values(shift_n,owner_s,900);
 delete from private.crm_shift_payroll where shift_id=default_n;
 insert into public.patients(full_name) values('TEST cash count patient v37') returning id into patient_n;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST cash count service v37',18000,0,true) returning id into service_n;
 update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
 perform set_config('test.v37.owner',owner_u::text,true);perform set_config('test.v37.admin',admin_u::text,true);
 perform set_config('test.v37.nurse',nurse_u::text,true);perform set_config('test.v37.other',other_u::text,true);
 perform set_config('test.v37.inactive',inactive_u::text,true);perform set_config('test.v37.owner_staff',owner_s::text,true);
 perform set_config('test.v37.nurse_staff',nurse_s::text,true);perform set_config('test.v37.other_staff',other_s::text,true);
 perform set_config('test.v37.shift',shift_n::text,true);perform set_config('test.v37.empty',empty_n::text,true);
 perform set_config('test.v37.unknown',unknown_n::text,true);perform set_config('test.v37.closed',closed_n::text,true);
 perform set_config('test.v37.default',default_n::text,true);perform set_config('test.v37.patient',patient_n::text,true);
 perform set_config('test.v37.service',service_n::text,true);
 perform pg_temp.v37_actor('owner');
end $$;

set local role authenticated;
do $$declare p jsonb;a jsonb;b jsonb;before_n jsonb;failed_n boolean;req uuid;count_n jsonb;
begin
 p:=pg_temp.v37_payload(jsonb_build_object('patient_id',current_setting('test.v37.patient'),
  'nurse_id',current_setting('test.v37.nurse_staff'),'service_id',current_setting('test.v37.service'),
  'items','[]'::jsonb,'charge_total',18000,'expected_stock_deducted',false));
 a:=public.record_treatment_v5('procedure',p||'{"payment_status":"paid","payments":{"cash":12000,"terminal":6000}}',gen_random_uuid());
 perform set_config('test.v37.procedure',a->>'id',true);
 a:=public.record_treatment_v5('procedure',p||'{"payment_status":"debt","payments":{"cash":0}}',gen_random_uuid());
 perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',a->>'id',
  'payments',jsonb_build_object('cash',500),'comment','TEST debt cash remains separate v37'),gen_random_uuid());
 before_n:=pg_temp.v37_state();
 a:=public.crm_cash_reconciliation_v37('status',pg_temp.v37_payload());
 perform pg_temp.v37_assert((a->>'received_cash')::numeric=12000 and a->'balance'='null'::jsonb
  and not(a->>'opening_confirmed')::boolean and (a->'reconciliation_v37'->>'required')::boolean
  and not(a->'reconciliation_v37'->>'can_close')::boolean,'Unknown opening became zero, or uncounted cash became closable');
 perform pg_temp.v37_assert(pg_temp.v37_state()=before_n,'A reconciliation status read wrote financial data');
 -- Close guards cover the main finance entry point and released legacy APIs.
 failed_n:=false;
 begin perform public.crm_finance_v5('close',pg_temp.v37_payload('{}','empty'));
 exception when check_violation then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Finance close accepted a shift without a count');
 failed_n:=false;
 begin perform public.quick_ui_v4('close',pg_temp.v37_payload('{}','empty'));
 exception when check_violation then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Legacy quick close bypassed the count trigger');
 failed_n:=false;
 begin perform public.close_shift_v8(current_setting('test.v37.empty')::uuid);
 exception when check_violation then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Legacy close_shift_v8 bypassed the count trigger');
 failed_n:=false;
 begin perform public.crm_save_recovery_v16('crm_finance_v5',jsonb_build_object('p_action','close',
  'p_payload',pg_temp.v37_payload('{}','empty')),gen_random_uuid());
 exception when check_violation then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Retry dispatcher cached an uncounted close');
 failed_n:=false;
 begin perform public.crm_cash_reconciliation_v37('save',pg_temp.v37_count(0,true,'','empty')||'{"opening_amount":0}',gen_random_uuid());
 exception when raise_exception then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,
  'Salary confirmation manufactured funds or left its opening/request after insufficient cash');
 -- Unknown openings require explicit input, including an explicit true zero.
 failed_n:=false;
 begin perform public.crm_cash_reconciliation_v37('save',pg_temp.v37_count(0,false,'','unknown'),gen_random_uuid());
 exception when raise_exception then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Missing opening was silently confirmed as zero');
 a:=public.crm_cash_reconciliation_v37('save',pg_temp.v37_count(0,false,'','unknown')||'{"opening_amount":0}',gen_random_uuid());
 perform pg_temp.v37_assert((a->>'opening_confirmed')::boolean and (a->>'balance')::numeric=0
  and (a->'reconciliation_v37'->>'can_close')::boolean,'Explicit zero opening did not produce a valid zero count');
 perform public.crm_cash_drawer_v30('opening_set',pg_temp.v37_payload('{"amount":100,"reason":"TEST known opening v37"}'),gen_random_uuid());
 perform public.crm_cash_drawer_v30('movement_add',pg_temp.v37_payload(jsonb_build_object('type','salary',
  'staff_id',current_setting('test.v37.nurse_staff'),'amount',700,'reason','TEST partial prior salary v37')),gen_random_uuid());
 -- No salary confirmation: compare the physical 11400, not the projected 7100.
 req:=gen_random_uuid();p:=pg_temp.v37_count(11400,false);
 a:=public.crm_cash_reconciliation_v37('save',p,req);count_n:=a->'reconciliation_v37'->'count';
 perform pg_temp.v37_assert((a->>'balance')::numeric=11400 and (a->>'cash_after_salary_auto')::numeric=7100
  and (a->>'salary_paid')::numeric=700 and (count_n->>'expected_cash')::numeric=11400
  and (count_n->>'counted_cash')::numeric=11400 and (count_n->>'difference')::numeric=0
  and not(count_n->>'salary_confirmed')::boolean and count_n->>'staff_id'=current_setting('test.v37.owner_staff')
  and not(count_n?'financial_snapshot') and not(count_n?'created_by'),'Count used projected salary cash or fabricated an unconfirmed payout');
 before_n:=pg_temp.v37_state();
 perform pg_temp.v37_assert(public.crm_cash_reconciliation_v37('save',p,req)=a and pg_temp.v37_state()=before_n,
  'Same UUID/payload replay changed a count, payout, opening, receipt or audit');
 perform set_config('test.v37.first_request',req::text,true);perform set_config('test.v37.first_payload',p::text,true);
 perform set_config('test.v37.first_result',a::text,true);
 -- Count compare-and-swap changes when another count is saved without finance edits.
 failed_n:=false;
 begin perform public.crm_cash_reconciliation_v37('save',p,gen_random_uuid());
 exception when serialization_failure then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'A stale latest-count token created a second count');
 failed_n:=false;
 begin perform public.crm_cash_reconciliation_v37('save',p||'{"reason":"different operation"}',req);
 exception when raise_exception then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Request UUID accepted a different payload');
 -- Missing mismatch reason must roll back child salary writes and request receipts.
 failed_n:=false;
 begin perform public.crm_cash_reconciliation_v37('save',pg_temp.v37_count(0,true),gen_random_uuid());
 exception when raise_exception then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Mismatch failure left partial salary, opening, request, count or audit writes');
 -- Confirm exactly the remaining 1300 + 3000 through released v30 movement APIs.
 req:=gen_random_uuid();p:=pg_temp.v37_count(7100,true);
 a:=public.crm_cash_reconciliation_v37('save',p,req);
 perform pg_temp.v37_assert((a->>'salary_paid')::numeric=5000 and (a->>'salary_auto_remaining')::numeric=0
  and (a->>'balance')::numeric=7100 and (a->'reconciliation_v37'->'count'->>'expected_cash')::numeric=7100
  and (a->'reconciliation_v37'->'count'->>'difference')::numeric=0
  and (a->'reconciliation_v37'->'count'->>'salary_confirmed')::boolean
  and jsonb_array_length(a->'reconciliation_v37'->'history')=2,'Confirmation did not record each employee remaining pay once');
 perform pg_temp.v37_assert((select count(*)=3 and sum((m->>'amount')::numeric)=5000
  and count(*) filter(where m->>'staff_id'=current_setting('test.v37.owner_staff'))=0
  from jsonb_array_elements(a->'movements') m where m->>'type'='salary'),
  'A prior partial payout was repeated, or an unassigned payroll employee was paid');
 perform pg_temp.v37_assert((a->>'received_cash')::numeric=12000 and (a->>'cash_in')::numeric=0,
  'Reconciliation manufactured revenue or cash_in to cover salary');
 before_n:=pg_temp.v37_state();
 perform pg_temp.v37_assert(public.crm_cash_reconciliation_v37('save',p,req)=a and pg_temp.v37_state()=before_n,
  'Confirmed salary replay paid or audited twice');
 -- A prior successful request stays replayable after a newer count changes CAS.
 perform pg_temp.v37_assert(public.crm_cash_reconciliation_v37('save',current_setting('test.v37.first_payload')::jsonb,
  current_setting('test.v37.first_request')::uuid)=current_setting('test.v37.first_result')::jsonb
  and pg_temp.v37_state()=before_n,'Committed replay was rejected by the newer count token');
 -- Net-zero finance edits must invalidate both a count and the form token.
 p:=pg_temp.v37_count(7100,false);
 perform public.crm_cash_drawer_v30('movement_add',pg_temp.v37_payload('{"type":"expense","amount":100,"reason":"TEST net-zero expense v37"}'),gen_random_uuid());
 a:=public.crm_cash_drawer_v30('movement_add',pg_temp.v37_payload('{"type":"cash_in","amount":100,"reason":"TEST net-zero return v37"}'),gen_random_uuid());
 perform pg_temp.v37_assert((a->>'balance')::numeric=7100 and (a->'reconciliation_v37'->>'stale')::boolean
  and not(a->'reconciliation_v37'->>'can_close')::boolean,'Net-zero edits kept an old count current');
 before_n:=pg_temp.v37_state();failed_n:=false;
 begin perform public.crm_cash_reconciliation_v37('save',p,gen_random_uuid());
 exception when serialization_failure then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Net-zero edit accepted a stale form token');
 failed_n:=false;
 begin perform public.crm_finance_v5('close',pg_temp.v37_payload());
 exception when check_violation then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'A stale count allowed closing');
 -- Nonzero differences are retained as evidence; they never adjust the ledger.
 a:=public.crm_cash_reconciliation_v37('save',pg_temp.v37_count(7090,false,'TEST short by ten after recount'),gen_random_uuid());
 perform pg_temp.v37_assert((a->>'balance')::numeric=7100 and (a->'reconciliation_v37'->'count'->>'difference')::numeric=-10
  and a->'reconciliation_v37'->'count'->>'reason'='TEST short by ten after recount'
  and (a->'reconciliation_v37'->>'can_close')::boolean,'Explained mismatch changed physical cash or could not be closed');
 -- Successful close/report retain the count and its variance after status changes.
 b:=public.crm_finance_v5('close',pg_temp.v37_payload());
 perform pg_temp.v37_assert(b->'shift'->>'status'='closed'
  and (b->'cash_drawer'->'reconciliation_v37'->>'can_close')::boolean
  and (b->'cash_drawer'->'reconciliation_v37'->'count'->>'difference')::numeric=-10
  and not(b->'cash_drawer'->'reconciliation_v37'->>'stale')::boolean,'Close/report lost the count or closing metadata made it stale');
end $$;
reset role;

-- The trigger also protects direct status updates, and history is immutable.
do $$declare failed_n boolean:=false;before_n jsonb:=pg_temp.v37_state();begin
 begin update public.shifts set status='closed' where id=current_setting('test.v37.empty')::uuid;
 exception when check_violation then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Direct shift close bypassed the trigger');
 failed_n:=false;
 begin update private.crm_cash_counts_v37 set reason='TEST tamper' where shift_id=current_setting('test.v37.shift')::uuid;
 exception when raise_exception then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Saved count was editable');
 failed_n:=false;
 begin delete from private.crm_cash_counts_v37 where shift_id=current_setting('test.v37.shift')::uuid;
 exception when raise_exception then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Saved count was deletable');
end $$;

select pg_temp.v37_actor('nurse');
set local role authenticated;
do $$declare a jsonb;before_n jsonb;failed_n boolean;p jsonb;req uuid;begin
 before_n:=pg_temp.v37_state();
 a:=public.crm_cash_reconciliation_v37('status',pg_temp.v37_payload());
 perform pg_temp.v37_assert(not(a->'reconciliation_v37'->>'editable')::boolean
  and jsonb_array_length(a->'reconciliation_v37'->'history')=3,'Assigned nurse cannot read own closed count history');
 a:=public.crm_finance_v5('shift_report',pg_temp.v37_payload());
 perform pg_temp.v37_assert((a->'cash_drawer'->'reconciliation_v37'->'count'->>'difference')::numeric=-10
  and not(a?'stock') and not(a?'profit'),'Own closed nurse report lost the count or exposed manager details');
 failed_n:=false;
 begin perform public.crm_cash_reconciliation_v37('save',pg_temp.v37_count(7100,false),gen_random_uuid());
 exception when insufficient_privilege then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Nurse changed a closed shift count');
 -- Newly assigned staff already have the real default 2000 payroll row. A
 -- nurse can confirm its payout and close without any manager backfill.
 req:=gen_random_uuid();p:=pg_temp.v37_count(0,true,'','empty')||'{"opening_amount":2000}';
 a:=public.crm_cash_reconciliation_v37('save',p,req);
 perform pg_temp.v37_assert((a->'reconciliation_v37'->>'editable')::boolean and (a->>'salary_paid')::numeric=2000
  and (a->>'balance')::numeric=0 and jsonb_array_length(a->'movements')=1
  and (a->'reconciliation_v37'->>'can_close')::boolean,'Assigned nurse could not confirm normal default salary and count');
 before_n:=pg_temp.v37_state();
 perform pg_temp.v37_assert(public.crm_cash_reconciliation_v37('save',p,req)=a and pg_temp.v37_state()=before_n,
  'Nurse default salary replay paid or audited twice');
 a:=public.quick_ui_v4('close',pg_temp.v37_payload('{}','empty'));
 perform pg_temp.v37_assert(a->'shift'->>'status'='closed'
  and (a->'cash_drawer'->'reconciliation_v37'->>'can_close')::boolean,'Valid count did not permit legacy close');
end $$;
reset role;

select pg_temp.v37_actor('admin');
set local role authenticated;
do $$declare a jsonb;before_n jsonb;failed_n boolean;begin
 -- An admin need not be assigned, and may add a new count after closing.
 a:=public.crm_cash_reconciliation_v37('save',pg_temp.v37_count(7100,false,'TEST admin closed recount'),gen_random_uuid());
 perform pg_temp.v37_assert((a->'reconciliation_v37'->>'editable')::boolean
  and jsonb_array_length(a->'reconciliation_v37'->'history')=4,'Unassigned admin could not count an already closed shift');
 a:=public.crm_cash_reconciliation_v37('save',pg_temp.v37_count(0,false,'','closed')||'{"opening_amount":0}',gen_random_uuid());
 perform pg_temp.v37_assert((a->>'balance')::numeric=0 and (a->'reconciliation_v37'->>'can_close')::boolean,
  'Historical closed shift could not receive its first explicit opening/count');
 -- A virtual automatic salary never becomes a real payout silently.
 before_n:=pg_temp.v37_state();failed_n:=false;
 begin perform public.crm_cash_reconciliation_v37('save',pg_temp.v37_count(0,true,'','default')||'{"opening_amount":5000}',gen_random_uuid());
 exception when raise_exception then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Unassigned default payroll was paid, or its opening survived a failed save');
end $$;
reset role;

-- Bill/allocation edits invalidate the token even if total physical cash is unchanged.
do $$declare a jsonb;old_n text;begin
 a:=private.crm_cash_drawer_facts_v30(current_setting('test.v37.shift')::uuid);
 old_n:=a->'reconciliation_v37'->>'token';
 update private.crm_payment_allocations set terminal=terminal-1,owner_card=owner_card+1
  where procedure_id=current_setting('test.v37.procedure')::uuid;
 a:=private.crm_cash_drawer_facts_v30(current_setting('test.v37.shift')::uuid);
 perform pg_temp.v37_assert((a->>'balance')::numeric=7100 and (a->'reconciliation_v37'->>'stale')::boolean
  and old_n is distinct from a->'reconciliation_v37'->>'token','A payment-method edit at unchanged cash balance retained the count token');
end $$;

select pg_temp.v37_actor('other');
set local role authenticated;
do $$declare failed_n boolean:=false;before_n jsonb:=pg_temp.v37_state();begin
 begin perform public.crm_cash_reconciliation_v37('status',pg_temp.v37_payload('{}','empty'));
 exception when insufficient_privilege then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n,'Unassigned nurse read another shift count');
 failed_n:=false;
 begin perform public.crm_cash_reconciliation_v37('save',pg_temp.v37_payload('{"expected_token":"x","counted_cash":0,"salary_confirmed":false,"reason":""}','empty'),gen_random_uuid());
 exception when insufficient_privilege then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n and pg_temp.v37_state()=before_n,'Unassigned nurse wrote another shift count');
 failed_n:=false;
 begin perform 1 from private.crm_cash_counts_v37;
 exception when insufficient_privilege then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n,'Authenticated caller read the private count table directly');
end $$;
reset role;
select pg_temp.v37_actor('inactive');
set local role authenticated;
do $$declare failed_n boolean:=false;begin
 begin perform public.crm_cash_reconciliation_v37('status',pg_temp.v37_payload());
 exception when insufficient_privilege then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n,'Inactive owner gained count access');
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
do $$declare failed_n boolean:=false;begin
 begin perform public.crm_cash_reconciliation_v37('status',pg_temp.v37_payload());
 exception when insufficient_privilege then failed_n:=true;end;
 perform pg_temp.v37_assert(failed_n,'Unauthenticated caller gained count access');
end $$;
reset role;

do $$declare source_n text:=pg_get_functiondef('private.crm_backup_data_v5()'::regprocedure);begin
 perform pg_temp.v37_assert(not exists(select 1 from private.crm_audit_log
  where action='cash_count_saved_v37' and entity_id=current_setting('test.v37.shift')
   and jsonb_array_length(after_data->'history')>1 and before_data->'count'->>'id' is null),
  'New count audits lost the preceding immutable count');
 perform pg_temp.v37_assert(not has_function_privilege('anon','public.crm_cash_reconciliation_v37(text,jsonb,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.crm_cash_reconciliation_v37(text,jsonb,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_cash_reconciliation_v37(text,jsonb,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_cash_financial_snapshot_v37(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_cash_reconciliation_facts_v37(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_cash_drawer_v30_before_v37(text,jsonb,uuid)','EXECUTE')
  and not has_table_privilege('authenticated','private.crm_cash_counts_v37','SELECT,INSERT,UPDATE,DELETE'),
  'Count grants exposed private financial access');
 perform pg_temp.v37_assert(not(select prosecdef from pg_proc where oid='public.crm_cash_reconciliation_v37(text,jsonb,uuid)'::regprocedure)
  and not(select prosecdef from pg_proc where oid='private.crm_cash_reconciliation_v37(text,jsonb,uuid)'::regprocedure)
  and (select prosecdef from pg_proc where oid='private.crm_cash_drawer_v30(text,jsonb,uuid)'::regprocedure),
  'New public/helper RPC is privileged instead of dispatching through the released cash definer');
 perform pg_temp.v37_assert((length(source_n)-length(replace(source_n,'''crm_cash_counts_v37''','')))/length('''crm_cash_counts_v37''')=1,
  'Immutable count evidence is missing or duplicated in the backup whitelist');
end $$;
select 'crm-cash-reconciliation-v37 physical counts, atomic payroll, replay, CAS, close guards and permissions acceptance passed' as result;
rollback;
