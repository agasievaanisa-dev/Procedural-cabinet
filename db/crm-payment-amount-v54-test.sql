-- Fictional public-RPC acceptance. Every fixture, payment, count and setting rolls back.
begin;
set local statement_timeout='90s';
create function pg_temp.v54_assert(ok boolean,why text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v54 payment amount: %',why;end if;end $$;
create function pg_temp.v54_actor(key_n text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',current_setting('test.v54.'||key_n),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v54.'||key_n),'role','authenticated')::text,true);
end $$;
do $$declare ad uuid:=gen_random_uuid();ow uuid:=gen_random_uuid();nu uuid:=gen_random_uuid();ad_s uuid;nu_s uuid;sh uuid;later uuid;pt uuid;sv uuid;med uuid;
begin
 insert into auth.users(id,email) values(ad,ad::text||'@amount-v54.example.invalid'),(ow,ow::text||'@amount-v54.example.invalid'),(nu,nu::text||'@amount-v54.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST amount admin v54','admin',true,ad) returning id into ad_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST amount owner v54','owner',true,ow);
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST amount nurse v54','nurse',true,nu) returning id into nu_s;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2003-08-11',timestamptz '2003-08-11 08:30+03',timestamptz '2003-08-11 16:00+03','open') returning id into sh;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2003-08-12',timestamptz '2003-08-12 08:30+03',timestamptz '2003-08-12 16:00+03','open') returning id into later;
 insert into public.shift_staff(shift_id,staff_id) values(sh,nu_s),(later,nu_s);
 insert into public.patients(full_name) values('TEST amount patient v54') returning id into pt;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('TEST amount service v54',5600,0,true) returning id into sv;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold) values('TEST amount medicine v54','амп.',5,0,5600,0,0) returning id into med;
 insert into public.stock(medication_id,location,quantity) values(med,'reserve',10),(med,'work',10);
 update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
 perform set_config('test.v54.admin',ad::text,true);perform set_config('test.v54.owner',ow::text,true);perform set_config('test.v54.nurse',nu::text,true);
 perform set_config('test.v54.admin_staff',ad_s::text,true);perform set_config('test.v54.nurse_staff',nu_s::text,true);
 perform set_config('test.v54.shift',sh::text,true);perform set_config('test.v54.later',later::text,true);perform set_config('test.v54.patient',pt::text,true);
 perform set_config('test.v54.service',sv::text,true);perform set_config('test.v54.med',med::text,true);perform pg_temp.v54_actor('admin');
end $$;
create function pg_temp.v54_create(kind_n text,status_n text,pay_n jsonb) returns jsonb language sql as $$
 select public.record_treatment_v5(kind_n,jsonb_build_object('patient_id',case when kind_n='procedure' then current_setting('test.v54.patient') end,
  'shift_id',current_setting('test.v54.shift'),'nurse_id',current_setting('test.v54.nurse_staff'),
  'service_id',case when kind_n='procedure' then current_setting('test.v54.service') end,
  'items',case when kind_n='sale' then jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v54.med'),'quantity',1)) else '[]'::jsonb end,
  'charge_total',5600,'payment_status',status_n,'expected_stock_deducted',false,'payments',pay_n),gen_random_uuid())
$$;
create function pg_temp.v54_payload(kind_n text,key_n text,event_type_n text,pay_n jsonb) returns jsonb language sql as $$
 with state as(select public.crm_payment_amount_v54('get',jsonb_build_object('kind',kind_n,'id',current_setting('test.v54.'||key_n))) a),
 event as(select state.a,e from state cross join lateral jsonb_array_elements(state.a->'events') e where e->>'event_type'=event_type_n limit 1)
 select jsonb_build_object('kind',kind_n,'id',current_setting('test.v54.'||key_n),'event_type',event_type_n,'event_id',e->>'id',
  'expected_version',a->'version','expected_payments',jsonb_build_object('cash',e->'cash','terminal',e->'terminal','owner_card',e->'owner_card','other_card',e->'other_card','unclassified',e->'unclassified'),
  'payments',pay_n,'reason','TEST corrected actual received amount v54','confirmed',true) from event
$$;
create function pg_temp.v54_fixture_state() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('procedures',(select jsonb_agg(to_jsonb(p) order by p.id) from public.procedures p where p.shift_id=current_setting('test.v54.shift')::uuid),
  'sales',(select jsonb_agg(to_jsonb(s) order by s.id) from public.sales s where s.shift_id=current_setting('test.v54.shift')::uuid),
  'receipts',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r where r.shift_id in(current_setting('test.v54.shift')::uuid,current_setting('test.v54.later')::uuid)),
  'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a where a.procedure_id in(select id from public.procedures where shift_id=current_setting('test.v54.shift')::uuid) or a.sale_id in(select id from public.sales where shift_id=current_setting('test.v54.shift')::uuid)),
  'requests',(select count(*) from private.warehouse_requests where staff_user=current_setting('test.v54.admin')::uuid),
  'audit',(select count(*) from private.crm_audit_log where actor_user=current_setting('test.v54.admin')::uuid))
$$;
create function pg_temp.v54_reject(p jsonb,request_n uuid default null) returns void language plpgsql as $$
declare before_n jsonb:=pg_temp.v54_fixture_state();failed_n boolean:=false;
begin
 begin perform public.crm_payment_amount_v54('save',p,coalesce(request_n,gen_random_uuid()));exception when others then failed_n:=true;end;
 perform pg_temp.v54_assert(failed_n,'Invalid amount correction accepted');
 perform pg_temp.v54_assert(pg_temp.v54_fixture_state()=before_n,'Rejected correction changed money, version, audit or idempotency state');
end $$;
set local role authenticated;
do $$declare a jsonb;req uuid;begin
 a:=pg_temp.v54_create('procedure','paid','{"cash":5600,"cash_received":6000}');perform set_config('test.v54.initial',a->>'id',true);
 a:=pg_temp.v54_create('procedure','pending','{}');perform set_config('test.v54.waiting',a->>'id',true);
 req:=gen_random_uuid();perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',a->>'id','shift_id',current_setting('test.v54.shift'),'nurse_id',current_setting('test.v54.nurse_staff'),'payments','{"terminal":5600}'::jsonb),req);
 perform set_config('test.v54.receipt',req::text,true);
 a:=pg_temp.v54_create('sale','paid','{"terminal":5600}');perform set_config('test.v54.sale',a->>'id',true);
 a:=pg_temp.v54_create('procedure','pending','{}');perform set_config('test.v54.cross',a->>'id',true);
 a:=pg_temp.v54_create('procedure','debt','{}');perform set_config('test.v54.loan',a->>'id',true);
 req:=gen_random_uuid();perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',a->>'id','amount',600,'paid_on','2003-08-11','purpose','TEST real separate debt v54'),req);
 perform set_config('test.v54.loan_receipt',req::text,true);
 a:=pg_temp.v54_create('procedure','debt','{"terminal":1000}');perform set_config('test.v54.loan_initial',a->>'id',true);
 req:=gen_random_uuid();perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',a->>'id','amount',600,'paid_on','2003-08-11','purpose','TEST repayment included in lifetime floor v54'),req);
 perform set_config('test.v54.floor_receipt',req::text,true);
 a:=pg_temp.v54_create('sale','debt','{}');perform set_config('test.v54.cancelled_sale',a->>'id',true);
 perform public.crm_sale_cancel_v52(jsonb_build_object('id',a->>'id','expected_version',a->'version','expected_received_total',0,'reason','TEST cancelled duplicate for amount guard v54','confirmed_duplicate',true),gen_random_uuid());
end $$;
reset role;
do $$declare d jsonb;count_n uuid:=gen_random_uuid();begin
 d:=public.crm_cash_reconciliation_v37('status',jsonb_build_object('shift_id',current_setting('test.v54.shift')));
 d:=public.crm_cash_reconciliation_v37('save',jsonb_build_object('shift_id',current_setting('test.v54.shift'),'expected_token',d->'reconciliation_v37'->>'token',
  'opening_amount',0,'counted_cash',5600,'salary_confirmed',false,'reason','TEST signed count before amount correction v54'),count_n);
 perform pg_temp.v54_assert((d->'reconciliation_v37'->>'can_close')::boolean,'Fixture signed count must permit closing');
 perform set_config('test.v54.count',count_n::text,true);
 perform set_config('test.v54.count_row',(select to_jsonb(c)::text from private.crm_cash_counts_v37 c where id=count_n),true);
 perform set_config('test.v54.receipt_row',(select to_jsonb(r)::text from private.crm_receipts_v10 r where id=current_setting('test.v54.receipt')::uuid),true);
 perform set_config('test.v54.initial_row',(select to_jsonb(p)::text from public.procedures p where id=current_setting('test.v54.initial')::uuid),true);
 perform set_config('test.v54.stock',(select jsonb_agg(to_jsonb(s) order by s.location)::text from public.stock s where medication_id=current_setting('test.v54.med')::uuid),true);
 perform set_config('test.v54.stock_movements',(select count(*)::text from public.stock_movements where medication_id=current_setting('test.v54.med')::uuid),true);
 update public.shifts set status='closed',ended_at=planned_end_at where id=current_setting('test.v54.shift')::uuid;
 insert into private.crm_shift_reports(shift_id,report) values(current_setting('test.v54.shift')::uuid,private.crm_build_shift_report_v5(current_setting('test.v54.shift')::uuid));
end $$;
set local role authenticated;
do $$declare p jsonb;a jsonb;b jsonb;request_n uuid:=gen_random_uuid();begin
 -- Anonymous sale corrections retain their own account and leave procedure cash counts current.
 p:=pg_temp.v54_payload('sale','sale','allocation','{"cash":5500,"cash_received":6000}')||'{"charge_total":5500}';
 a:=public.crm_payment_amount_v54('save',p,request_n);b:=public.crm_payment_amount_v54('save',p,request_n);
 perform pg_temp.v54_assert(a=b and(a->'treatment'->>'charge_total')::numeric=5500 and(a->'treatment'->>'received_total')::numeric=5500,'Sale amount correction or exact replay wrong');
 perform pg_temp.v54_assert((a->>'amount_corrected')::boolean and a->>'request_id'=request_n::text,'Success lacks request-bound amount acknowledgement');
 perform pg_temp.v54_assert((a->'treatment'->>'version')::integer=(p->>'expected_version')::integer+1,'Replay changed version twice');
 perform set_config('test.v54.replay_payload',p::text,true);perform set_config('test.v54.replay_request',request_n::text,true);
 perform pg_temp.v54_reject(p||'{"reason":"TEST different operation same UUID v54"}',request_n);
 perform pg_temp.v54_reject(p);
end $$;
reset role;
do $$declare d jsonb;r jsonb;begin
 d:=private.crm_cash_reconciliation_facts_v37(current_setting('test.v54.shift')::uuid);
 perform pg_temp.v54_assert(not(d->>'stale')::boolean,'Standalone sale correction invalidated procedure cash count');
 r:=private.crm_build_shift_report_v5(current_setting('test.v54.shift')::uuid);
 perform pg_temp.v54_assert((r->'revenue'->>'cash')::numeric=5600 and(r->'sales_summary'->'revenue'->>'cash')::numeric=5500,'Anonymous sale money entered main cash or missing from separate account');
end $$;
set local role authenticated;
do $$declare p jsonb;a jsonb;b jsonb;request_n uuid:=gen_random_uuid();bad jsonb;begin
 -- Final agreed charge and corrected receipt change atomically: no fictitious 100-ruble debt.
 p:=pg_temp.v54_payload('procedure','waiting','receipt','{"owner_card":5500}')||'{"charge_total":5500}';
 a:=public.crm_payment_amount_v54('save',p,request_n);b:=public.crm_payment_amount_v54('save',p,request_n);
 perform pg_temp.v54_assert(a=b and(a->'treatment'->>'received_total')::numeric=5500 and(a->'treatment'->>'charge_total')::numeric=5500,'Ordinary receipt correction and retry failed');
 perform pg_temp.v54_assert((a->'treatment'->>'list_total')::numeric=5600 and(a->'treatment'->>'discount_amount')::numeric=100,'Original price or discount snapshot lost');
 perform pg_temp.v54_assert((a->'treatment'->>'debt_total')::numeric=0 and not(a->'treatment'->>'payment_pending')::boolean
  and(a->'treatment'->'payments'->>'owner_card')::numeric=5500 and(a->'treatment'->'payments'->>'terminal')::numeric=0,'Corrected card amount became cash or false debt');
 p:=pg_temp.v54_payload('procedure','initial','allocation','{"cash":2000,"terminal":1500,"owner_card":1000,"other_card":1000,"cash_received":2500}')||'{"charge_total":5500}';
 a:=public.crm_payment_amount_v54('save',p,gen_random_uuid());
 perform pg_temp.v54_assert((a->'treatment'->>'initial_paid_total')::numeric=5500 and(a->'treatment'->'payments'->>'other_card')::numeric=1000,'Initial parent amount or mixed four channels not corrected');
 p:=pg_temp.v54_payload('procedure','initial','allocation','{"terminal":5000}');
 -- An unpaid difference needs an explicit waiting/debt decision.
 perform pg_temp.v54_reject(p);
 a:=public.crm_payment_amount_v54('save',p||'{"remaining_status":"pending"}',gen_random_uuid());
 perform pg_temp.v54_assert((a->'treatment'->>'pending_total')::numeric=500 and(a->'treatment'->>'loan_debt_total')::numeric=0,'Explicit waiting correction became debt');
 p:=pg_temp.v54_payload('procedure','initial','allocation','{"terminal":5000}');
 a:=public.crm_payment_amount_v54('save',p||'{"remaining_status":"debt"}',gen_random_uuid());
 perform pg_temp.v54_assert((a->'treatment'->>'loan_debt_total')::numeric=500 and(a->'treatment'->>'pending_total')::numeric=0,'Explicit true-debt correction not retained');
 p:=pg_temp.v54_payload('procedure','initial','allocation','{"terminal":5000}')||'{"remaining_status":"debt"}';
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  p||'{"payments":{"terminal":-1}}',p||'{"payments":{"terminal":1.001}}',p||'{"payments":{"terminal":"NaN"}}',
  p||'{"payments":{"terminal":"Infinity"}}',p||'{"payments":{"terminal":1000000000000}}',p||'{"confirmed":false}',p||'{"reason":""}',
  p||'{"charge_total":4999}',p||'{"charge_total":-1}',p||'{"charge_total":5500.001}',
  p||'{"payments":{"terminal":6000}}',p||'{"payments":{"cash":5000,"cash_received":4000}}',
  p||'{"expected_payments":{"cash":0,"terminal":4999,"owner_card":0,"other_card":0,"unclassified":0}}',
  p-'payments',p||'{"payments":null}',p||'{"payments":false}',
  p||'{"payments":{"terminal":null}}',p||'{"payments":{"terminal":false}}',
  p||'{"payments":{"terminal":[]}}',p||'{"payments":{"terminal":{}}}',
  p||'{"payments":{"terminal":" "}}',p||'{"payments":{"terminal":5000,"cash":null}}',
  p||'{"payments":{"terminal":5000,"cash_received":null}}',
  p||'{"payments":{"terminal":5000,"unknown_channel":0}}')) loop perform pg_temp.v54_reject(bad);end loop;
 -- True debt repayment stays outside ordinary amount correction.
 a:=public.crm_payment_amount_v54('get',jsonb_build_object('kind','procedure','id',current_setting('test.v54.loan')));
 perform pg_temp.v54_assert(a->'events'='[]'::jsonb and(a->>'debt_repayments_total')::numeric=600,'True debt exposed as ordinary payment');
 perform pg_temp.v54_reject(p||jsonb_build_object('id',current_setting('test.v54.loan'),'expected_version',a->'version','event_type','receipt','event_id',current_setting('test.v54.loan_receipt')));
 -- A separate true-debt receipt still participates in the lifetime paid floor.
 p:=pg_temp.v54_payload('procedure','loan_initial','allocation','{"terminal":900}')||'{"charge_total":1400}';
 perform pg_temp.v54_reject(p);
 a:=public.crm_payment_amount_v54('save',p||'{"charge_total":1500}',gen_random_uuid());
 perform pg_temp.v54_assert((a->'treatment'->>'received_total')::numeric=1500 and(a->'treatment'->>'debt_total')::numeric=0,'Lifetime floor lost separate debt repayment');
 perform pg_temp.v54_assert((a->>'debt_repayments_total')::numeric=600,'Debt repayment changed during ordinary correction');
 -- Canceled records cannot be inspected or revived through a correction.
 bad:=null;begin perform public.crm_payment_amount_v54('get',jsonb_build_object('kind','sale','id',current_setting('test.v54.cancelled_sale')));exception when sqlstate '22023' then bad:='true'::jsonb;end;
 perform pg_temp.v54_assert(bad='true'::jsonb,'Canceled sale exposed in amount editor');
 perform pg_temp.v54_reject(p||jsonb_build_object('kind','sale','id',current_setting('test.v54.cancelled_sale'),'event_type','allocation','event_id',gen_random_uuid()));
end $$;
reset role;
do $$declare r jsonb;d jsonb;begin
 r:=(select to_jsonb(x) from private.crm_receipts_v10 x where id=current_setting('test.v54.receipt')::uuid);
 perform pg_temp.v54_assert(r-array['cash','terminal','owner_card','other_card','unclassified_amount','cash_received','change_amount']
  =current_setting('test.v54.receipt_row')::jsonb-array['cash','terminal','owner_card','other_card','unclassified_amount','cash_received','change_amount'],
  'Corrected receipt identity, time, original shift, nurse or comment changed');
 perform pg_temp.v54_assert((select to_jsonb(c) from private.crm_cash_counts_v37 c where id=current_setting('test.v54.count')::uuid)=current_setting('test.v54.count_row')::jsonb,'Signed cash count overwritten');
 perform pg_temp.v54_assert((private.crm_cash_reconciliation_facts_v37(current_setting('test.v54.shift')::uuid)->>'stale')::boolean,'Procedure correction failed to invalidate financial count fingerprint');
 r:=private.crm_build_shift_report_v5(current_setting('test.v54.shift')::uuid);d:=(select report from private.crm_shift_reports where shift_id=current_setting('test.v54.shift')::uuid);
 perform pg_temp.v54_assert(r->'revenue'=d->'revenue' and r->'sales_summary'=d->'sales_summary','Closed financial report cache not refreshed');
end $$;
set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid:=gen_random_uuid();begin
 -- Fully incorrect ordinary receipt is voided with its original facts retained.
 p:=pg_temp.v54_payload('procedure','waiting','receipt','{}')||'{"charge_total":0}';
 a:=public.crm_payment_amount_v54('save',p,req);
 perform pg_temp.v54_assert((a->'treatment'->>'received_total')::numeric=0 and(a->'treatment'->>'charge_total')::numeric=0,'Zero receipt correction failed');
 perform pg_temp.v54_assert(public.crm_payment_amount_v54('save',p,req)=a,'Voided receipt replay failed');
 -- A receipt for another receiving shift is corrected in that original shift.
 req:=gen_random_uuid();perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',current_setting('test.v54.cross'),
  'shift_id',current_setting('test.v54.later'),'nurse_id',current_setting('test.v54.nurse_staff'),'payments','{"terminal":5600}'::jsonb),req);
 perform set_config('test.v54.cross_receipt',req::text,true);
end $$;
reset role;
do $$declare d jsonb;count_n uuid:=gen_random_uuid();begin
 perform pg_temp.v54_assert((select owner_card=5500 and terminal=0 and voided_at is not null and void_request_id is not null from private.crm_receipts_v10 where id=current_setting('test.v54.receipt')::uuid),
  'Voiding erased original receipt amounts or did not preserve its audit identity');
 d:=public.crm_cash_reconciliation_v37('status',jsonb_build_object('shift_id',current_setting('test.v54.later')));
 d:=public.crm_cash_reconciliation_v37('save',jsonb_build_object('shift_id',current_setting('test.v54.later'),'expected_token',d->'reconciliation_v37'->>'token',
  'opening_amount',100,'counted_cash',100,'salary_confirmed',false,'reason','TEST receiving shift count v54'),count_n);
 perform set_config('test.v54.later_count',count_n::text,true);
 perform set_config('test.v54.later_count_row',(select to_jsonb(c)::text from private.crm_cash_counts_v37 c where id=count_n),true);
 perform set_config('test.v54.cross_row',(select to_jsonb(r)::text from private.crm_receipts_v10 r where id=current_setting('test.v54.cross_receipt')::uuid),true);
end $$;
set local role authenticated;
do $$declare p jsonb;a jsonb;begin
 p:=pg_temp.v54_payload('procedure','cross','receipt','{"owner_card":5500}')||'{"charge_total":5500}';
 a:=public.crm_payment_amount_v54('save',p,gen_random_uuid());
 perform pg_temp.v54_assert((a->'treatment'->>'debt_total')::numeric=0,'Cross-shift corrected final settlement has false debt');
end $$;
reset role;
do $$declare r jsonb;begin
 r:=(select to_jsonb(x) from private.crm_receipts_v10 x where id=current_setting('test.v54.cross_receipt')::uuid);
 perform pg_temp.v54_assert(r-array['cash','terminal','owner_card','other_card','unclassified_amount','cash_received','change_amount']
  =current_setting('test.v54.cross_row')::jsonb-array['cash','terminal','owner_card','other_card','unclassified_amount','cash_received','change_amount'],'Cross-shift correction moved receipt date/nurse/shift');
 perform pg_temp.v54_assert((private.crm_cash_reconciliation_facts_v37(current_setting('test.v54.later')::uuid)->>'stale')::boolean,'Receiving-shift financial fingerprint not invalidated');
 perform pg_temp.v54_assert((select to_jsonb(c) from private.crm_cash_counts_v37 c where id=current_setting('test.v54.later_count')::uuid)=current_setting('test.v54.later_count_row')::jsonb,'Receiving signed count overwritten');
 perform pg_temp.v54_assert((select jsonb_agg(to_jsonb(s) order by s.location) from public.stock s where medication_id=current_setting('test.v54.med')::uuid)=current_setting('test.v54.stock')::jsonb
  and(select count(*) from public.stock_movements where medication_id=current_setting('test.v54.med')::uuid)=current_setting('test.v54.stock_movements')::integer,'Amount correction changed stock or consumption');
 perform pg_temp.v54_assert((select count(*) from private.crm_receipts_v10 where procedure_id=current_setting('test.v54.loan')::uuid and is_debt_repayment and voided_at is null)=1,'True debt repayment history changed');
end $$;
-- Live role checks run before a committed replay can be returned.
select pg_temp.v54_actor('nurse');
set local role authenticated;
do $$declare action_n text;denied_n boolean;begin
 foreach action_n in array array['get','save'] loop
  denied_n:=false;begin perform public.crm_payment_amount_v54(action_n,current_setting('test.v54.replay_payload')::jsonb,current_setting('test.v54.replay_request')::uuid);exception when insufficient_privilege then denied_n:=true;end;
  perform pg_temp.v54_assert(denied_n,'Nurse gained amount correction access or replay');
 end loop;
end $$;
reset role;
update public.staff set active=false where id=current_setting('test.v54.admin_staff')::uuid;
select pg_temp.v54_actor('admin');
set local role authenticated;
do $$declare denied_n boolean:=false;begin
 begin perform public.crm_payment_amount_v54('save',current_setting('test.v54.replay_payload')::jsonb,current_setting('test.v54.replay_request')::uuid);exception when insufficient_privilege then denied_n:=true;end;
 perform pg_temp.v54_assert(denied_n,'Inactive manager replay bypassed authorization');
end $$;
reset role;
select pg_temp.v54_actor('owner');
set local role authenticated;
do $$declare a jsonb;p jsonb;request_n uuid:=gen_random_uuid();begin
 a:=public.crm_payment_amount_v54('get',jsonb_build_object('kind','sale','id',current_setting('test.v54.sale')));
 perform pg_temp.v54_assert((a->'treatment'->>'received_total')::numeric=5500,'Owner cannot inspect corrected anonymous sale');
 -- An erroneous initial collection can also be corrected to zero. This is
 -- deliberately after the earlier cash/cache assertions so their scope stays
 -- independent of this extra branch.
 p:=pg_temp.v54_payload('procedure','initial','allocation','{}')||'{"charge_total":0}';
 a:=public.crm_payment_amount_v54('save',p,request_n);
 perform pg_temp.v54_assert((a->'treatment'->>'initial_paid_total')::numeric=0
  and(a->'treatment'->>'received_total')::numeric=0 and(a->'treatment'->>'charge_total')::numeric=0
  and(a->'treatment'->>'debt_total')::numeric=0 and a->'events'='[]'::jsonb,
  'Zero initial correction left a paid total, bill balance or positive payment event');
 perform pg_temp.v54_assert(public.crm_payment_amount_v54('save',p,request_n)=a,
  'Zero initial correction replay changed its result');
end $$;
reset role;
do $$begin
 perform pg_temp.v54_assert((select count(*)=1 and bool_and(cash=0 and terminal=0 and owner_card=0
  and other_card=0 and cash_received=0 and change_amount=0 and voided_at is null)
  from private.crm_payment_allocations where procedure_id=current_setting('test.v54.initial')::uuid),
  'Zero initial correction erased its allocation or left payment channels populated');
 perform pg_temp.v54_assert((select to_jsonb(p)-array['paid_total','charge_total','discount_amount','discount_percent',
  'discount_reason','discount_comment','payment_pending','version'] from public.procedures p
  where p.id=current_setting('test.v54.initial')::uuid)
  =current_setting('test.v54.initial_row')::jsonb-array['paid_total','charge_total','discount_amount','discount_percent',
   'discount_reason','discount_comment','payment_pending','version'],
  'Zero initial correction changed the original patient, staff, time, shift or clinical facts');
 perform pg_temp.v54_assert((select to_jsonb(c) from private.crm_cash_counts_v37 c
  where id=current_setting('test.v54.count')::uuid)=current_setting('test.v54.count_row')::jsonb,
  'Zero initial correction rewrote a signed cash count');
 perform pg_temp.v54_assert((select jsonb_agg(to_jsonb(s) order by s.location) from public.stock s
  where medication_id=current_setting('test.v54.med')::uuid)=current_setting('test.v54.stock')::jsonb
  and(select count(*) from public.stock_movements where medication_id=current_setting('test.v54.med')::uuid)
   =current_setting('test.v54.stock_movements')::integer,'Zero initial correction changed warehouse state');
end $$;
select set_config('request.jwt.claim.sub','',true);select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$declare denied_n boolean:=false;begin
 begin perform public.crm_payment_amount_v54('get',jsonb_build_object('kind','procedure','id',current_setting('test.v54.waiting')));exception when insufficient_privilege then denied_n:=true;end;
 perform pg_temp.v54_assert(denied_n,'Anonymous amount API is executable');
end $$;
reset role;
do $$begin
 perform pg_temp.v54_assert(not has_function_privilege('anon','public.crm_payment_amount_v54(text,jsonb,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_payment_amount_v54(text,jsonb,uuid)','EXECUTE'),'Private helper or anonymous API permission exposed');
 perform pg_temp.v54_assert((select count(*) from private.crm_audit_log where action='payment_amount_corrected_v54' and entity_id=current_setting('test.v54.sale'))=1,'Sale exact retry created duplicate audits');
end $$;
select 'crm_payment_amount_v54' as passed_suite;
rollback;
