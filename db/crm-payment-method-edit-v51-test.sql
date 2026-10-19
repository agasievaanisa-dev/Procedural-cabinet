-- Fictional public-RPC acceptance; all records, settings and reports roll back.
begin;
set local statement_timeout='90s';
create function pg_temp.v51m_assert(ok boolean,why text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v51 payment-method acceptance: %',why;end if;end $$;
create function pg_temp.v51m_actor(key_n text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',current_setting('test.v51m.'||key_n),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v51m.'||key_n),'role','authenticated')::text,true);
end $$;
do $$declare admin_u uuid:=gen_random_uuid();nurse_u uuid:=gen_random_uuid();owner_u uuid:=gen_random_uuid();ad uuid;nu uuid;sh uuid;pt uuid;sv uuid;m uuid;
begin
 insert into auth.users(id,email) values(admin_u,admin_u::text||'@v51m.example.invalid'),
  (nurse_u,nurse_u::text||'@v51m.example.invalid'),(owner_u,owner_u::text||'@v51m.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST method admin v51','admin',true,admin_u) returning id into ad;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST method nurse v51','nurse',true,nurse_u) returning id into nu;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST method owner v51','owner',true,owner_u);
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2097-11-18',timestamptz '2097-11-18 08:30+03',timestamptz '2097-11-18 16:00+03','open') returning id into sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,nu);
 insert into public.patients(full_name) values('TEST method patient v51') returning id into pt;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('TEST method service v51',1000,0,true) returning id into sv;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST method medicine v51','амп.',5,0,1000,0,0) returning id into m;
 insert into public.stock(medication_id,location,quantity) values(m,'reserve',10),(m,'work',10);
 update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
 perform set_config('test.v51m.admin',admin_u::text,true);perform set_config('test.v51m.nurse',nurse_u::text,true);perform set_config('test.v51m.owner',owner_u::text,true);
 perform set_config('test.v51m.admin_staff',ad::text,true);perform set_config('test.v51m.nurse_staff',nu::text,true);
 perform set_config('test.v51m.shift',sh::text,true);perform set_config('test.v51m.patient',pt::text,true);
 perform set_config('test.v51m.service',sv::text,true);perform set_config('test.v51m.med',m::text,true);
 perform pg_temp.v51m_actor('admin');
end $$;
create function pg_temp.v51m_create(kind_n text,status_n text,pay_n jsonb) returns jsonb language sql as $$
 select public.record_treatment_v5(kind_n,jsonb_build_object('patient_id',current_setting('test.v51m.patient'),
  'shift_id',current_setting('test.v51m.shift'),'nurse_id',current_setting('test.v51m.nurse_staff'),
  'service_id',case when kind_n='procedure' then current_setting('test.v51m.service') else null end,
  'items',case when kind_n='sale' then jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v51m.med'),'quantity',1)) else '[]'::jsonb end,
  'charge_total',1000,'payment_status',status_n,'expected_stock_deducted',false,'payments',pay_n),gen_random_uuid())
$$;
create function pg_temp.v51m_change(kind_n text,key_n text,event_type_n text,pay_n jsonb) returns jsonb language sql as $$
 with state as(select public.crm_payment_methods_v51('get',jsonb_build_object('kind',kind_n,'id',current_setting('test.v51m.'||key_n))) a),
 event as(select state.a, e from state cross join lateral jsonb_array_elements(state.a->'events') e where e->>'event_type'=event_type_n limit 1)
 select jsonb_build_object('kind',kind_n,'id',current_setting('test.v51m.'||key_n),'event_type',event_type_n,'event_id',e->>'id',
  'expected_version',a->'version','expected_payments',jsonb_build_object('cash',e->'cash','terminal',e->'terminal','owner_card',e->'owner_card','other_card',e->'other_card','unclassified',e->'unclassified'),
  'payments',pay_n,'reason','TEST correction of method, money already received v51','confirmed',true) from event
$$;
set local role authenticated;
do $$declare a jsonb;p jsonb;req uuid:=gen_random_uuid();begin
 a:=pg_temp.v51m_create('procedure','paid','{"cash":1000,"cash_received":1500}');perform set_config('test.v51m.cash',a->>'id',true);
 a:=pg_temp.v51m_create('sale','paid','{"terminal":1000}');perform set_config('test.v51m.sale',a->>'id',true);
 a:=pg_temp.v51m_create('procedure','pending','{}');perform set_config('test.v51m.waiting',a->>'id',true);
 p:=jsonb_build_object('kind','procedure','id',a->>'id','shift_id',current_setting('test.v51m.shift'),
  'nurse_id',current_setting('test.v51m.nurse_staff'),'payments',jsonb_build_object('cash',1000),'comment','TEST normal waiting receipt v51');
 perform public.crm_clinical_v10('debt_payment',p,req);perform set_config('test.v51m.receipt',req::text,true);
 a:=pg_temp.v51m_create('procedure','debt','{}');perform set_config('test.v51m.loan',a->>'id',true);
 req:=gen_random_uuid();perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',a->>'id',
  'amount',300,'paid_on','2097-11-18','purpose','TEST separate real debt v51'),req);
 perform set_config('test.v51m.debt_receipt',req::text,true);
 a:=public.crm_payment_methods_v51('get',jsonb_build_object('kind','procedure','id',a->>'id'));
 perform pg_temp.v51m_assert(a->'events'='[]'::jsonb and(a->>'debt_repayments_total')::numeric=300 and(a->>'debt_repayments_excluded')::boolean,'True debt must not become an ordinary event');
end $$;
reset role;
-- Freeze an existing closed report and a signed cash count before correction.
do $$declare sh uuid:=current_setting('test.v51m.shift')::uuid;drawer_n jsonb;count_n uuid:=gen_random_uuid();begin
 -- Use the released count RPC, including its current financial fingerprint,
 -- explicit zero opening and explicit unpaid-salary confirmation. The ordinary
 -- close trigger remains enabled and must accept this real count first.
 drawer_n:=public.crm_cash_drawer_v30('count_status_v37',jsonb_build_object('shift_id',sh));
 drawer_n:=public.crm_cash_drawer_v30('count_save_v37',jsonb_build_object('shift_id',sh,
  'expected_token',drawer_n->'reconciliation_v37'->>'token','opening_amount',0,
  'counted_cash',2000,'salary_confirmed',false,'reason','TEST count before correcting method v51'),count_n);
 perform pg_temp.v51m_assert((drawer_n->'reconciliation_v37'->>'can_close')::boolean,'Fixture must have a valid released cash count before close');
 update public.shifts set status='closed',ended_at=planned_end_at where id=sh;
 insert into private.crm_shift_reports(shift_id,report) values(sh,private.crm_build_shift_report_v5(sh));
 perform set_config('test.v51m.count',count_n::text,true);
 perform set_config('test.v51m.count_snapshot',(select to_jsonb(c)::text from private.crm_cash_counts_v37 c where id=count_n),true);
 perform set_config('test.v51m.receipt_snapshot',(select to_jsonb(r)::text from private.crm_receipts_v10 r where id=current_setting('test.v51m.receipt')::uuid),true);
 perform set_config('test.v51m.stock_snapshot',(select jsonb_agg(to_jsonb(s) order by s.location)::text from public.stock s where medication_id=current_setting('test.v51m.med')::uuid),true);
 perform set_config('test.v51m.movements',(select count(*)::text from public.stock_movements where medication_id=current_setting('test.v51m.med')::uuid),true);
end $$;
set local role authenticated;
do $$declare a jsonb;b jsonb;p jsonb;bad jsonb;req uuid:=gen_random_uuid();failed_n boolean;
begin
 p:=pg_temp.v51m_change('procedure','cash','allocation','{"owner_card":1000}');
 a:=public.crm_payment_methods_v51('save',p,req);b:=public.crm_payment_methods_v51('save',p,req);
 perform pg_temp.v51m_assert(a=b and(a->'treatment'->'payments'->>'owner_card')::numeric=1000 and(a->'treatment'->'payments'->>'cash')::numeric=0,'Closed-shift cash to owner-card and exact retry');
 perform pg_temp.v51m_assert((a->>'version')::integer=(p->>'expected_version')::integer+1
  and(b->>'version')::integer=(a->>'version')::integer,'Correction must bump version once; replay must preserve it');
 perform pg_temp.v51m_assert((a->'treatment'->>'paid_total')::numeric=1000 and(a->'treatment'->>'charge_total')::numeric=1000 and(a->'treatment'->>'debt_total')::numeric=0,'Method correction changed bill/received amount');
 perform set_config('test.v51m.replay_payload',p::text,true);perform set_config('test.v51m.replay_request',req::text,true);
 failed_n:=false;begin perform public.crm_payment_methods_v51('save',p||'{"reason":"TEST conflicting request v51"}',req);
 exception when sqlstate '22023' then failed_n:=sqlerrm='Номер операции уже использован';end;
 perform pg_temp.v51m_assert(failed_n,'Conflicting request UUID accepted');
 failed_n:=false;begin perform public.crm_payment_methods_v51('save',p,gen_random_uuid());
 exception when sqlstate '40001' then failed_n:=true;end;
 perform pg_temp.v51m_assert(failed_n,'Stale version accepted');
 p:=pg_temp.v51m_change('sale','sale','allocation','{"cash":100,"terminal":200,"owner_card":300,"other_card":400,"cash_received":150}');
 a:=public.crm_payment_methods_v51('save',p,gen_random_uuid());
 perform pg_temp.v51m_assert((a->'treatment'->'payments'->>'cash')::numeric=100 and(a->'treatment'->'payments'->>'other_card')::numeric=400,'Mixed four-channel sale correction failed');
 p:=pg_temp.v51m_change('procedure','waiting','receipt','{"terminal":1000}');req:=gen_random_uuid();
 a:=public.crm_payment_methods_v51('save',p,req);b:=public.crm_payment_methods_v51('save',p,req);
 perform pg_temp.v51m_assert(a=b and(a->'treatment'->'payments'->>'terminal')::numeric=1000 and(a->'treatment'->>'debt_total')::numeric=0,'Ordinary waiting receipt correction/retry failed');
 -- Changes to amount, confirmation, fingerprint and unknown channel fail atomically.
 p:=pg_temp.v51m_change('procedure','cash','allocation','{"terminal":1000}');
 for bad in select value from jsonb_array_elements(jsonb_build_array(p||'{"payments":{"terminal":999}}',p||'{"confirmed":false}',
   p||jsonb_build_object('expected_payments',jsonb_build_object('cash',1,'terminal',0,'owner_card',999,'other_card',0,'unclassified',0)),
   p||'{"payments":{"terminal":1000,"unclassified":0}}',p||'{"reason":""}')) loop
  failed_n:=false;begin perform public.crm_payment_methods_v51('save',bad,gen_random_uuid());exception when others then failed_n:=true;end;
  perform pg_temp.v51m_assert(failed_n,'Invalid method correction accepted');
 end loop;
 a:=public.crm_payment_methods_v51('get',jsonb_build_object('kind','procedure','id',current_setting('test.v51m.loan')));
 p:=p||jsonb_build_object('id',current_setting('test.v51m.loan'),'expected_version',a->'version',
  'event_type','receipt','event_id',current_setting('test.v51m.debt_receipt'));
 failed_n:=false;begin perform public.crm_payment_methods_v51('save',p,gen_random_uuid());exception when sqlstate '22023' then failed_n:=true;end;
 perform pg_temp.v51m_assert(failed_n,'True debt receipt can be converted to shift money');
end $$;
reset role;
do $$declare a jsonb;b jsonb;receipt_n jsonb;sh uuid:=current_setting('test.v51m.shift')::uuid;begin
 receipt_n:=(select to_jsonb(r) from private.crm_receipts_v10 r where id=current_setting('test.v51m.receipt')::uuid);
 perform pg_temp.v51m_assert(receipt_n-array['cash','terminal','owner_card','other_card','unclassified_amount','cash_received','change_amount']
  =current_setting('test.v51m.receipt_snapshot')::jsonb-array['cash','terminal','owner_card','other_card','unclassified_amount','cash_received','change_amount'],
  'Receipt time, date, source shift/nurse, comment or identity changed');
 perform pg_temp.v51m_assert((select to_jsonb(c) from private.crm_cash_counts_v37 c where id=current_setting('test.v51m.count')::uuid)
  =current_setting('test.v51m.count_snapshot')::jsonb,'Signed cash count snapshot was rewritten');
 perform pg_temp.v51m_assert((private.crm_cash_reconciliation_facts_v37(sh)->>'stale')::boolean,'Cash reconciliation fingerprint must require a fresh count');
 perform pg_temp.v51m_assert((select jsonb_agg(to_jsonb(s) order by s.location) from public.stock s where medication_id=current_setting('test.v51m.med')::uuid)
  =current_setting('test.v51m.stock_snapshot')::jsonb and(select count(*) from public.stock_movements where medication_id=current_setting('test.v51m.med')::uuid)
  =current_setting('test.v51m.movements')::integer,'Method correction moved stock');
 a:=private.crm_build_shift_report_v5(sh);b:=(select report from private.crm_shift_reports where shift_id=sh);
 perform pg_temp.v51m_assert((a->'revenue'->>'cash')::numeric=100 and(a->'revenue'->>'terminal')::numeric=1200
  and(a->'revenue'->>'owner_card')::numeric=1300 and(a->'revenue'->>'other_card')::numeric=400 and(a->'revenue'->>'total')::numeric=3000,'Shift method totals wrong after correction');
 perform pg_temp.v51m_assert(b->'revenue'=a->'revenue','Closed monetary report cache not refreshed');
 perform pg_temp.v51m_assert((select count(*) from private.crm_receipts_v10 where procedure_id in(current_setting('test.v51m.waiting')::uuid,current_setting('test.v51m.loan')::uuid))=2,'A new receipt was fabricated');
 perform pg_temp.v51m_assert((select count(*) from private.crm_audit_log where action='payment_method_corrected_v51'
  and entity_id in(current_setting('test.v51m.cash'),current_setting('test.v51m.sale'),current_setting('test.v51m.waiting')))=3,'Correction/retry audit count wrong');
end $$;
-- Authorization is live and precedes cached successes; nurses cannot read or edit.
select pg_temp.v51m_actor('nurse');
set local role authenticated;
do $$declare failed_n boolean;action_n text;begin
 foreach action_n in array array['get','save'] loop
  failed_n:=false;begin perform public.crm_payment_methods_v51(action_n,current_setting('test.v51m.replay_payload')::jsonb,current_setting('test.v51m.replay_request')::uuid);
  exception when insufficient_privilege then failed_n:=true;end;
  perform pg_temp.v51m_assert(failed_n,'Nurse gained method correction read/write/replay access');
 end loop;
end $$;
reset role;
update public.staff set active=false where id=current_setting('test.v51m.admin_staff')::uuid;
select pg_temp.v51m_actor('admin');
set local role authenticated;
do $$declare failed_n boolean:=false;begin
 begin perform public.crm_payment_methods_v51('save',current_setting('test.v51m.replay_payload')::jsonb,current_setting('test.v51m.replay_request')::uuid);
 exception when insufficient_privilege then failed_n:=true;end;
 perform pg_temp.v51m_assert(failed_n,'Inactive manager replay bypassed live authorization');
end $$;
reset role;
select pg_temp.v51m_actor('owner');
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.crm_payment_methods_v51('get',jsonb_build_object('kind','procedure','id',current_setting('test.v51m.cash')));
 perform pg_temp.v51m_assert(jsonb_array_length(a->'events')=1,'Owner cannot inspect corrected payment');
end $$;
reset role;
set local role anon;
do $$declare failed_n boolean:=false;begin
 begin perform public.crm_payment_methods_v51('get',jsonb_build_object('kind','procedure','id',current_setting('test.v51m.cash')));
 exception when insufficient_privilege then failed_n:=true;end;
 perform pg_temp.v51m_assert(failed_n,'Anonymous RPC access allowed');
end $$;
reset role;
do $$begin
 -- Released UNIQUE constraints make multiple initial allocations unrepresentable;
 -- the RPC also rejects an ambiguous count if a damaged schema ever permits it.
 perform pg_temp.v51m_assert(exists(select 1 from pg_constraint where conrelid='private.crm_payment_allocations'::regclass
  and contype='u' and pg_get_constraintdef(oid)='UNIQUE (procedure_id)')
  and exists(select 1 from pg_constraint where conrelid='private.crm_payment_allocations'::regclass
   and contype='u' and pg_get_constraintdef(oid)='UNIQUE (sale_id)'),'Initial allocation uniqueness boundary missing');
 perform pg_temp.v51m_assert(not has_function_privilege('authenticated','private.crm_payment_methods_v51(text,jsonb,uuid)','execute')
  and not has_function_privilege('authenticated','private.crm_payment_methods_snapshot_v51(text,uuid)','execute')
  and not has_function_privilege('anon','public.crm_payment_methods_v51(text,jsonb,uuid)','execute'),'Private ACL boundary changed');
 perform pg_temp.v51m_assert(not(select prosecdef from pg_proc where oid='private.crm_payment_methods_snapshot_v51(text,uuid)'::regprocedure),'Snapshot helper gained definer rights');
end $$;
rollback;
