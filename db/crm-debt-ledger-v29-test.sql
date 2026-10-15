-- Run after crm-debt-ledger-v29.sql. All identities, records, receipts and
-- settings are synthetic and are rolled back. This verifies cash semantics,
-- not merely the labels shown on a report.
begin;
create temporary table v29_existing_patients as select id,to_jsonb(p) original from public.patients p;
create temporary table v29_existing_procedures as select id,to_jsonb(p) original from public.procedures p;
create temporary table v29_existing_sales as select id,to_jsonb(s) original from public.sales s;
create temporary table v29_existing_allocations as select id,to_jsonb(a) original from private.crm_payment_allocations a;
create temporary table v29_existing_receipts as select id,to_jsonb(r) original from private.crm_receipts_v10 r;

create function pg_temp.v29_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v29 acceptance: %',message;end if;end $$;

do $$declare ou uuid:=gen_random_uuid();nu uuid:=gen_random_uuid();xu uuid:=gen_random_uuid();iu uuid:=gen_random_uuid();
 os uuid;ns uuid;xs uuid;ins uuid;sh uuid;fsh uuid;pt uuid;deleted_pt uuid;m uuid;sv uuid;
begin
 insert into auth.users(id,email) values(ou,ou::text||'@debt-ledger-v29.example.invalid'),
  (nu,nu::text||'@debt-ledger-v29.example.invalid'),(xu,xu::text||'@debt-ledger-v29.example.invalid'),
  (iu,iu::text||'@debt-ledger-v29.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST debt ledger owner v29','owner',true,ou) returning id into os;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST debt ledger nurse v29','nurse',true,nu) returning id into ns;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST debt ledger outside nurse v29','nurse',true,xu) returning id into xs;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST debt ledger inactive v29','nurse',false,iu) returning id into ins;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-12-10',timestamptz '2096-12-10 08:30+03',timestamptz '2096-12-10 16:00+03','open') returning id into sh;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-12-11',timestamptz '2096-12-11 08:30+03',timestamptz '2096-12-11 16:00+03','open') returning id into fsh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,ns),(fsh,xs);
 insert into public.patients(full_name) values('TEST debt ledger patient v29') returning id into pt;
 insert into public.patients(full_name) values('TEST debt ledger deleted patient v29') returning id into deleted_pt;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST debt ledger medicine v29','амп.',10,0,1000,0,0) returning id into m;
 insert into public.stock(medication_id,location,quantity) values(m,'reserve',0),(m,'work',0);
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST debt ledger procedure v29',1000,0,true) returning id into sv;
 update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
 perform set_config('test.v29.owner',ou::text,true);perform set_config('test.v29.nurse',nu::text,true);
 perform set_config('test.v29.outsider',xu::text,true);perform set_config('test.v29.inactive',iu::text,true);
 perform set_config('test.v29.owner_staff',os::text,true);perform set_config('test.v29.nurse_staff',ns::text,true);
 perform set_config('test.v29.outsider_staff',xs::text,true);perform set_config('test.v29.shift',sh::text,true);
 perform set_config('test.v29.foreign_shift',fsh::text,true);perform set_config('test.v29.patient',pt::text,true);
 perform set_config('test.v29.deleted_patient',deleted_pt::text,true);perform set_config('test.v29.med',m::text,true);
 perform set_config('test.v29.service',sv::text,true);perform set_config('test.v29.patient_count',(select count(*)::text from public.patients),true);
 perform set_config('request.jwt.claim.sub',nu::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',nu,'role','authenticated')::text,true);
end $$;

create function pg_temp.v29_payload(kind_n text,status_n text,pay_n jsonb) returns jsonb language sql as $$
 select jsonb_build_object('shift_id',current_setting('test.v29.shift'),'nurse_id',current_setting('test.v29.nurse_staff'),
  'patient_id',case when kind_n='procedure' then current_setting('test.v29.patient') else null end,
  'service_id',case when kind_n='procedure' then current_setting('test.v29.service') else null end,
  'items',case when kind_n='sale' then jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v29.med'),'quantity',1)) else '[]'::jsonb end,
  'charge_total',1000,'payment_status',status_n,'expected_stock_deducted',false,'payments',pay_n,'notes','TEST debt ledger v29')
$$;
create function pg_temp.v29_target(kind_n text,key_n text) returns jsonb language sql as $$
 select jsonb_build_object('kind',kind_n,'id',current_setting('test.v29.'||key_n))
$$;
-- Stable state fingerprint for validation failures and idempotent replays.
create function pg_temp.v29_state() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'procedures',(select jsonb_agg(to_jsonb(p) order by p.id) from public.procedures p where p.shift_id in(current_setting('test.v29.shift')::uuid,current_setting('test.v29.foreign_shift')::uuid)),
  'sales',(select jsonb_agg(to_jsonb(s) order by s.id) from public.sales s where s.shift_id in(current_setting('test.v29.shift')::uuid,current_setting('test.v29.foreign_shift')::uuid)),
  'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a
   where a.procedure_id in(select id from public.procedures where shift_id in(current_setting('test.v29.shift')::uuid,current_setting('test.v29.foreign_shift')::uuid))
    or a.sale_id in(select id from public.sales where shift_id in(current_setting('test.v29.shift')::uuid,current_setting('test.v29.foreign_shift')::uuid))),
  'receipts',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r
   where r.procedure_id in(select id from public.procedures where shift_id in(current_setting('test.v29.shift')::uuid,current_setting('test.v29.foreign_shift')::uuid))
    or r.sale_id in(select id from public.sales where shift_id in(current_setting('test.v29.shift')::uuid,current_setting('test.v29.foreign_shift')::uuid))),
  'stock',(select jsonb_agg(to_jsonb(s) order by s.location) from public.stock s where s.medication_id=current_setting('test.v29.med')::uuid),
  'movements',(select count(*) from public.stock_movements where medication_id=current_setting('test.v29.med')::uuid),
  'requests',(select jsonb_agg(to_jsonb(r) order by r.id) from private.warehouse_requests r where r.staff_user in(
   current_setting('test.v29.owner')::uuid,current_setting('test.v29.nurse')::uuid,current_setting('test.v29.outsider')::uuid,current_setting('test.v29.inactive')::uuid)),
  'audit',(select count(*) from private.crm_audit_log where entity_id in(
   select id::text from public.procedures where shift_id in(current_setting('test.v29.shift')::uuid,current_setting('test.v29.foreign_shift')::uuid)
   union all select id::text from public.sales where shift_id in(current_setting('test.v29.shift')::uuid,current_setting('test.v29.foreign_shift')::uuid))))
$$;

set local role authenticated;
do $$declare a jsonb;p jsonb;req uuid;report_n jsonb;begin
 -- True debts and a normal waiting-for-payment visit coexist in one shift.
 a:=public.record_treatment_v5('procedure',pg_temp.v29_payload('procedure','debt','{"cash":100}'),gen_random_uuid());
 perform set_config('test.v29.debt_procedure',a->>'id',true);
 a:=public.record_treatment_v5('sale',pg_temp.v29_payload('sale','debt','{"terminal":100}'),gen_random_uuid());
 perform set_config('test.v29.debt_sale',a->>'id',true);
 a:=public.record_treatment_v5('procedure',pg_temp.v29_payload('procedure','pending','{"cash":0}'),gen_random_uuid());
 perform set_config('test.v29.pending_procedure',a->>'id',true);
 perform pg_temp.v29_assert((a->>'payment_pending')::boolean,'After-procedure visit lost its waiting state');
 a:=public.record_treatment_v5('sale',pg_temp.v29_payload('sale','pending','{"cash":100}'),gen_random_uuid());
 perform set_config('test.v29.pending_sale',a->>'id',true);
 a:=public.record_treatment_v5('procedure',pg_temp.v29_payload('procedure','paid','{"cash":1000}'),gen_random_uuid());
 perform set_config('test.v29.mistaken_procedure',a->>'id',true);
 p:=pg_temp.v29_payload('procedure','paid','{"owner_card":500}')||jsonb_build_object('charge_total',500,
  'discount_reason','Скидка от владельца','discount_comment','TEST regular discount v29');
 a:=public.record_treatment_v5('procedure',p,gen_random_uuid());perform set_config('test.v29.paid_procedure',a->>'id',true);
end $$;
reset role;
-- Synthetic dates make period totals deterministic without touching live rows.
update public.procedures set visit_at=timestamptz '2096-12-10 10:00+03' where shift_id=current_setting('test.v29.shift')::uuid;
update public.sales set sold_at=timestamptz '2096-12-10 10:00+03' where shift_id=current_setting('test.v29.shift')::uuid;

select set_config('request.jwt.claim.sub',current_setting('test.v29.owner'),true);
set local role authenticated;
do $$declare a jsonb;p jsonb;req uuid:=gen_random_uuid();before_n jsonb;begin
 -- A separate synthetic shift keeps deleted-patient guard fixtures out of the
 -- main shift's exact arithmetic.
 p:=pg_temp.v29_payload('procedure','debt','{"cash":0}')||jsonb_build_object('patient_id',current_setting('test.v29.deleted_patient'),
  'shift_id',current_setting('test.v29.foreign_shift'),'nurse_id',current_setting('test.v29.outsider_staff'));
 a:=public.record_treatment_v5('procedure',p,gen_random_uuid());perform set_config('test.v29.deleted_procedure',a->>'id',true);
 -- Correcting a payment marked in error creates real debt without erasing its
 -- original allocation; a later collection must use the separate debt ledger.
 a:=public.crm_clinical_v10('treatment_get',pg_temp.v29_target('procedure','mistaken_procedure'));
 p:=jsonb_build_object('kind','procedure','id',a->>'id','expected_version',a->'version','expected_stock_deducted',false,
  'expected_received_total',1000,'confirm_no_money_received',true,'correction_reason','TEST money was never received v29',
  'services',a->'services','items',a->'items','own_medications',a->'own_medications','charge_total',1000,
  'paid_total',0,'payment_status','debt','payments',jsonb_build_object('cash',0));
 a:=public.crm_payment_correction_v22(p,req);
 perform pg_temp.v29_assert((a->>'received_total')::numeric=0 and (a->>'debt_total')::numeric=1000,'Correction did not restore unpaid debt');
 before_n:=pg_temp.v29_state();
 perform pg_temp.v29_assert(public.crm_payment_correction_v22(p,req)=a,'Correction replay differs');
 perform pg_temp.v29_assert(pg_temp.v29_state()=before_n,'Correction replay changed state');
end $$;
reset role;

set local role authenticated;
do $$declare report_n jsonb;debts_n jsonb;a jsonb;begin
 a:=public.crm_clinical_v10('treatment_get',pg_temp.v29_target('procedure','pending_procedure'));
 perform pg_temp.v29_assert((a->>'debt_total')::numeric=1000 and (a->>'pending_total')::numeric=1000
  and (a->>'loan_debt_total')::numeric=0,'Pending snapshot must retain balance while exposing no true debt');
 a:=public.crm_clinical_v10('treatment_get',pg_temp.v29_target('procedure','debt_procedure'));
 perform pg_temp.v29_assert((a->>'debt_total')::numeric=900 and (a->>'loan_debt_total')::numeric=900
  and (a->>'pending_total')::numeric=0,'True-debt snapshot lost its outstanding balance');
 report_n:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v29.shift')));
 perform pg_temp.v29_assert((report_n->'revenue'->>'total')::numeric=800
  and (report_n->'revenue'->>'cash')::numeric=200 and (report_n->'revenue'->>'terminal')::numeric=100
  and (report_n->'revenue'->>'owner_card')::numeric=500,'Initial shift receipts or correction arithmetic is wrong');
 perform pg_temp.v29_assert((report_n->>'debt_total')::numeric=2800,'Waiting after-procedure visits counted as true shift debt');
 debts_n:=public.crm_clinical_v10('debts','{}');
 perform pg_temp.v29_assert(not exists(select 1 from jsonb_array_elements(debts_n->'debts') x
  where x->>'id' in(current_setting('test.v29.pending_procedure'),current_setting('test.v29.pending_sale'))),
  'Debt register contains ordinary waiting-for-payment visits');
 perform pg_temp.v29_assert(exists(select 1 from jsonb_array_elements(debts_n->'debts') x where x->>'id'=current_setting('test.v29.debt_sale')),
  'Debt register omitted anonymous medication sale');
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v29.nurse'),true);
set local role authenticated;
do $$declare a jsonb;p jsonb;req uuid;before_n jsonb;begin
 -- Ordinary after-drip payment still needs an authorized open payment shift.
 p:=pg_temp.v29_target('procedure','pending_procedure')||jsonb_build_object('shift_id',current_setting('test.v29.foreign_shift'),
  'nurse_id',current_setting('test.v29.outsider_staff'),'payments',jsonb_build_object('cash',200),'comment','TEST pending wrong shift v29');
 before_n:=pg_temp.v29_state();
 begin perform public.crm_clinical_v10('debt_payment',p,gen_random_uuid());raise exception 'Forbidden foreign pending receipt succeeded';
 exception when others then if sqlerrm='Forbidden foreign pending receipt succeeded' then raise;end if;end;
 perform pg_temp.v29_assert(pg_temp.v29_state()=before_n,'Rejected foreign pending payment changed financial state');
 p:=p||jsonb_build_object('shift_id',current_setting('test.v29.shift'),'nurse_id',current_setting('test.v29.nurse_staff'));
 req:=gen_random_uuid();a:=public.crm_clinical_v10('debt_payment',p,req);
 perform set_config('test.v29.pending_partial_request',req::text,true);
 perform pg_temp.v29_assert((a->>'received_total')::numeric=200 and (a->>'payment_pending')::boolean,
  'Partial ordinary payment should retain waiting state');
 before_n:=pg_temp.v29_state();
 perform pg_temp.v29_assert(public.crm_clinical_v10('debt_payment',p,req)=a,'Pending payment replay differs');
 perform pg_temp.v29_assert(pg_temp.v29_state()=before_n,'Pending payment replay duplicated money');
 p:=p||jsonb_build_object('payments',jsonb_build_object('cash',800),'comment','TEST ordinary completed after drip v29');
 req:=gen_random_uuid();a:=public.crm_clinical_v10('debt_payment',p,req);
 perform set_config('test.v29.pending_paid_request',req::text,true);
 perform pg_temp.v29_assert((a->>'received_total')::numeric=1000 and (a->>'debt_total')::numeric=0
  and (a->>'payment_pending')::boolean is false,'Ordinary after-procedure settlement did not complete');
 p:=pg_temp.v29_target('sale','pending_sale')||jsonb_build_object('shift_id',current_setting('test.v29.shift'),
  'nurse_id',current_setting('test.v29.nurse_staff'),'payments',jsonb_build_object('terminal',900),'comment','TEST ordinary sale completion v29');
 req:=gen_random_uuid();a:=public.crm_clinical_v10('debt_payment',p,req);
 perform set_config('test.v29.pending_sale_request',req::text,true);
 perform pg_temp.v29_assert((a->>'received_total')::numeric=1000 and (a->>'payment_pending')::boolean is false,
  'Anonymous waiting sale could not be paid normally');
end $$;
reset role;
update private.crm_receipts_v10 set created_at=timestamptz '2096-12-10 11:00+03'
 where id in(current_setting('test.v29.pending_partial_request')::uuid,current_setting('test.v29.pending_paid_request')::uuid,
  current_setting('test.v29.pending_sale_request')::uuid);

select set_config('request.jwt.claim.sub',current_setting('test.v29.owner'),true);
set local role authenticated;
do $$declare a jsonb;report_n jsonb;begin
 report_n:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v29.shift')));
 perform pg_temp.v29_assert((report_n->'revenue'->>'total')::numeric=2700
  and (report_n->'revenue'->>'cash')::numeric=1200 and (report_n->'revenue'->>'terminal')::numeric=1000
  and (report_n->'revenue'->>'owner_card')::numeric=500,'Normal after-procedure receipts are missing from shift income');
 perform pg_temp.v29_assert((report_n->>'debt_total')::numeric=2800 and jsonb_array_length(report_n->'receipts')=3,
  'Shift debt or ordinary receipt count changed on pending settlement');
 perform set_config('test.v29.report_before_debt',report_n::text,true);
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-12-10','to','2096-12-10','group_by','day'));
 perform pg_temp.v29_assert((a->'revenue'->>'total')::numeric=2700 and (a->'revenue'->>'cash')::numeric=1200
  and (a->>'charge_total')::numeric=5500 and (a->>'debt_total')::numeric=2800,'Period summary miscounts normal after-procedure payment');
end $$;
reset role;

-- Separate true-debt collection acceptance sections follow the v29 API contract.
create function pg_temp.v29_repayment(kind_n text,key_n text,amount_n numeric,purpose_n text) returns jsonb language sql as $$
 select pg_temp.v29_target(kind_n,key_n)||jsonb_build_object('amount',amount_n,'paid_on',(current_date-1)::text,'purpose',purpose_n)
$$;
create function pg_temp.v29_reject(action_n text,payload_n jsonb,request_n uuid,label_n text) returns void language plpgsql as $$
declare before_n jsonb:=pg_temp.v29_state();failed_n boolean:=false;
begin
 begin perform public.crm_clinical_v10(action_n,payload_n,request_n);exception when others then failed_n:=true;end;
 perform pg_temp.v29_assert(failed_n,label_n||' was accepted');
 perform pg_temp.v29_assert(pg_temp.v29_state()=before_n,label_n||' changed financial state');
end $$;

-- Validation occurs before writing a receipt, request result, stock or audit.
select set_config('request.jwt.claim.sub',current_setting('test.v29.nurse'),true);
set local role authenticated;
do $$declare p jsonb;bad jsonb;x jsonb;begin
 p:=pg_temp.v29_repayment('procedure','debt_procedure',200,'TEST procedure debt repayment v29');
 for x in select value from jsonb_array_elements('[null,0,-1,900.01,0.001,"NaN","Infinity","1e1000","invalid"]'::jsonb) loop
  bad:=p||jsonb_build_object('amount',x);
  perform pg_temp.v29_reject('debt_payment',bad,gen_random_uuid(),'Invalid repayment amount '||x::text);
 end loop;
 perform pg_temp.v29_reject('debt_payment',p-'amount',gen_random_uuid(),'Missing repayment amount');
 for x in select value from jsonb_array_elements('[null,"","2024-02-30","2024-2-03","2024-02-29T12:00:00Z","infinity"]'::jsonb) loop
  perform pg_temp.v29_reject('debt_payment',p||jsonb_build_object('paid_on',x),gen_random_uuid(),'Invalid repayment date '||x::text);
 end loop;
 perform pg_temp.v29_reject('debt_payment',p-'paid_on',gen_random_uuid(),'Missing repayment date');
 perform pg_temp.v29_reject('debt_payment',p-'purpose',gen_random_uuid(),'Missing repayment purpose');
 perform pg_temp.v29_reject('debt_payment',p||jsonb_build_object('purpose','   '),gen_random_uuid(),'Blank repayment purpose');
 perform pg_temp.v29_reject('debt_payment',p||jsonb_build_object('purpose',repeat('x',2001)),gen_random_uuid(),'Oversized repayment purpose');
 perform pg_temp.v29_reject('debt_payment',p||jsonb_build_object('payments',jsonb_build_object('cash',200)),gen_random_uuid(),'Ambiguous amount and payment methods');
 perform pg_temp.v29_reject('debt_payment',p,null,'Missing repayment request ID');
 perform pg_temp.v29_reject('debt_payment',p||jsonb_build_object('kind','unknown'),gen_random_uuid(),'Unknown repayment record kind');
 perform pg_temp.v29_reject('debt_payment',p||jsonb_build_object('id',gen_random_uuid()),gen_random_uuid(),'Missing repayment record');
 perform pg_temp.v29_reject('debt_payment',pg_temp.v29_repayment('procedure','paid_procedure',1,'TEST paid discounted bill v29'),gen_random_uuid(),'Collection above discounted paid bill balance');
 perform pg_temp.v29_reject('debt_history','{}'::jsonb,gen_random_uuid(),'Nurse unscoped repayment history');
end $$;
reset role;

-- Removing only the synthetic nurse's assignment proves true debt does not
-- require an open assigned shift or a payment method.
delete from public.shift_staff where shift_id=current_setting('test.v29.shift')::uuid and staff_id=current_setting('test.v29.nurse_staff')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.v29.nurse'),true);
set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid:=gen_random_uuid();before_n jsonb;begin
 p:=pg_temp.v29_repayment('procedure','debt_procedure',200,'  TEST procedure debt repayment v29  ');
 a:=public.crm_clinical_v10('debt_payment',p,req);
 perform pg_temp.v29_assert((a->>'received_total')::numeric=300 and (a->>'paid_total')::numeric=300
  and (a->>'debt_total')::numeric=700 and (a->>'loan_debt_total')::numeric=700
  and (a->>'pending_total')::numeric=0 and (a->>'payment_pending')::boolean is false,
  'Standalone partial debt collection did not update the treatment snapshot');
 perform set_config('test.v29.true_request',req::text,true);perform set_config('test.v29.true_payload',p::text,true);
 perform set_config('test.v29.true_result',a::text,true);
 before_n:=pg_temp.v29_state();
 perform pg_temp.v29_assert(public.crm_clinical_v10('debt_payment',p,req)=a,'Standalone debt replay differs');
 perform pg_temp.v29_assert(pg_temp.v29_state()=before_n,'Standalone debt replay duplicated state');
 perform pg_temp.v29_reject('debt_payment',p||jsonb_build_object('amount',201),req,'Reused repayment request with another amount');
 perform pg_temp.v29_reject('debt_payment',p||jsonb_build_object('paid_on',current_date::text),req,'Reused repayment request with another date');
 perform pg_temp.v29_reject('debt_payment',p||jsonb_build_object('purpose','TEST changed purpose'),req,'Reused repayment request with another purpose');
 -- Cache a valid collection before deleting its synthetic patient so replay
 -- must pass the current patient authorization guard as well.
 p:=pg_temp.v29_repayment('procedure','deleted_procedure',20,'TEST before patient deletion v29');req:=gen_random_uuid();
 a:=public.crm_clinical_v10('debt_payment',p,req);
 perform set_config('test.v29.deleted_request',req::text,true);perform set_config('test.v29.deleted_payload',p::text,true);
end $$;
reset role;
insert into public.shift_staff(shift_id,staff_id) values(current_setting('test.v29.shift')::uuid,current_setting('test.v29.nurse_staff')::uuid);
update public.patients set deleted_at=now(),deleted_by=current_setting('test.v29.owner')::uuid,archived=true
 where id=current_setting('test.v29.deleted_patient')::uuid;

set local role authenticated;
do $$declare history_n jsonb;item_n jsonb;begin
 perform pg_temp.v29_reject('debt_payment',current_setting('test.v29.deleted_payload')::jsonb,current_setting('test.v29.deleted_request')::uuid,'Deleted-patient cached repayment');
 perform pg_temp.v29_reject('debt_payment',current_setting('test.v29.deleted_payload')::jsonb,gen_random_uuid(),'Deleted-patient new repayment');
 perform pg_temp.v29_reject('debt_history',jsonb_build_object('patient_id',current_setting('test.v29.deleted_patient')),null,'Deleted-patient repayment history');
 perform pg_temp.v29_reject('debt_history',pg_temp.v29_target('procedure','deleted_procedure'),null,'Deleted-record repayment history');
 history_n:=public.crm_clinical_v10('debt_history',jsonb_build_object('patient_id',current_setting('test.v29.patient')));
 select value into item_n from jsonb_array_elements(history_n->'items') where value->>'id'=current_setting('test.v29.true_request');
 perform pg_temp.v29_assert((item_n->>'amount')::numeric=200 and item_n->>'paid_on'=(current_date-1)::text
  and item_n->>'purpose'='TEST procedure debt repayment v29' and item_n->>'record_id'=current_setting('test.v29.debt_procedure'),
  'Patient repayment history lost exact amount, date, purpose or target');
 perform pg_temp.v29_assert(not exists(select 1 from jsonb_array_elements(history_n->'items') x
  where x->>'id' in(current_setting('test.v29.pending_partial_request'),current_setting('test.v29.pending_paid_request'),current_setting('test.v29.pending_sale_request'),current_setting('test.v29.deleted_request'))),
  'Patient history included ordinary payment or another patient');
end $$;
reset role;

-- Another actor cannot read a cached repayment through its request ID.
select set_config('request.jwt.claim.sub',current_setting('test.v29.outsider'),true);
set local role authenticated;
select pg_temp.v29_reject('debt_payment',current_setting('test.v29.true_payload')::jsonb,current_setting('test.v29.true_request')::uuid,'Another actor repayment replay');
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v29.inactive'),true);
set local role authenticated;
select pg_temp.v29_reject('debt_payment',current_setting('test.v29.true_payload')::jsonb,current_setting('test.v29.true_request')::uuid,'Inactive actor repayment replay');
select pg_temp.v29_reject('debt_history',jsonb_build_object('patient_id',current_setting('test.v29.patient')),null,'Inactive actor repayment history');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.v29_reject('debt_payment',current_setting('test.v29.true_payload')::jsonb,current_setting('test.v29.true_request')::uuid,'Anonymous repayment replay');
select pg_temp.v29_reject('debt_history','{}'::jsonb,null,'Anonymous repayment history');
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v29.owner'),true);
set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid;report_n jsonb;history_n jsonb;begin
 -- Anonymous medication sales have the same standalone ledger contract.
 p:=pg_temp.v29_repayment('sale','debt_sale',350,'TEST anonymous medication debt repayment v29');req:=gen_random_uuid();
 a:=public.crm_clinical_v10('debt_payment',p,req);perform set_config('test.v29.sale_debt_request',req::text,true);
 perform pg_temp.v29_assert((a->>'received_total')::numeric=450 and (a->>'debt_total')::numeric=550,
  'Anonymous medication debt cannot be collected separately');
 p:=pg_temp.v29_repayment('procedure','mistaken_procedure',1000,'TEST corrected erroneous payment collected v29');req:=gen_random_uuid();
 a:=public.crm_clinical_v10('debt_payment',p,req);perform set_config('test.v29.corrected_debt_request',req::text,true);
 perform pg_temp.v29_assert((a->>'received_total')::numeric=1000 and (a->>'debt_total')::numeric=0,
  'Real collection after mistaken-payment correction did not settle debt');
 p:=pg_temp.v29_repayment('procedure','debt_procedure',700,'TEST procedure debt balance v29');req:=gen_random_uuid();
 a:=public.crm_clinical_v10('debt_payment',p,req);perform set_config('test.v29.balance_debt_request',req::text,true);
 perform pg_temp.v29_assert((a->>'received_total')::numeric=1000 and (a->>'debt_total')::numeric=0,
  'Final standalone collection did not settle debt');
 perform pg_temp.v29_reject('debt_payment',p,gen_random_uuid(),'Collection after true debt was fully settled');
 report_n:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v29.shift')));
 perform pg_temp.v29_assert(report_n->'revenue'=(current_setting('test.v29.report_before_debt')::jsonb)->'revenue'
  and report_n->'receipts'=(current_setting('test.v29.report_before_debt')::jsonb)->'receipts',
  'Standalone debt collections contaminated shift revenue or ordinary receipts');
 perform pg_temp.v29_assert((report_n->>'debt_total')::numeric=550,'Shift debt did not decrease after separate collection');
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-12-10','to','2096-12-10','group_by','day'));
 perform pg_temp.v29_assert((a->'revenue'->>'total')::numeric=2700 and (a->'revenue'->>'cash')::numeric=1200
  and (a->'revenue'->>'terminal')::numeric=1000 and (a->'revenue'->>'owner_card')::numeric=500
  and (a->>'charge_total')::numeric=5500 and (a->>'debt_total')::numeric=550,
  'Period summary included standalone debt as ordinary income or failed to reduce debt');
 history_n:=public.crm_clinical_v10('debt_history','{}');
 perform pg_temp.v29_assert((select count(*) from jsonb_array_elements(history_n->'items') x where x->>'id' in(
  current_setting('test.v29.true_request'),current_setting('test.v29.sale_debt_request'),current_setting('test.v29.corrected_debt_request'),
  current_setting('test.v29.balance_debt_request'),current_setting('test.v29.deleted_request')))=5,
  'Manager history did not include all synthetic true repayments, including deleted patient and anonymous sale');
 perform pg_temp.v29_assert(not exists(select 1 from jsonb_array_elements(history_n->'items') x where x->>'id' in(
  current_setting('test.v29.pending_partial_request'),current_setting('test.v29.pending_paid_request'),current_setting('test.v29.pending_sale_request'))),
  'Manager repayment history contains ordinary after-procedure payments');
 history_n:=public.crm_clinical_v10('debt_history',pg_temp.v29_target('sale','debt_sale'));
 perform pg_temp.v29_assert(jsonb_array_length(history_n->'items')=1
  and history_n->'items'->0->>'id'=current_setting('test.v29.sale_debt_request'),
  'Record-scoped history includes another record');
 a:=public.crm_clinical_v10('debts',jsonb_build_object('patient_id',current_setting('test.v29.patient')));
 perform pg_temp.v29_assert(jsonb_array_length(a->'debts')=0 and (a->>'debt_total')::numeric=0,
  'Patient debt register retained fully repaid records');
end $$;
reset role;

-- Storage checks use the actual persisted receipt, not merely RPC labels.
do $$declare r private.crm_receipts_v10%rowtype;begin
 select * into r from private.crm_receipts_v10 where id=current_setting('test.v29.true_request')::uuid;
 perform pg_temp.v29_assert(r.is_debt_repayment and r.shift_id is null and r.unclassified_amount=200
  and r.cash=0 and r.terminal=0 and r.owner_card=0 and r.cash_received=0 and r.change_amount=0
  and r.paid_on=current_date-1 and r.purpose='TEST procedure debt repayment v29'
  and r.nurse_id=current_setting('test.v29.nurse_staff')::uuid and r.created_by=current_setting('test.v29.nurse')::uuid,
  'Standalone receipt invented a shift/payment method or lost its ledger fields');
 perform pg_temp.v29_assert((select count(*) from private.crm_receipts_v10 where procedure_id=current_setting('test.v29.debt_procedure')::uuid and is_debt_repayment)=2,
  'True debt idempotence left duplicate receipts');
 perform pg_temp.v29_assert((select count(*) from private.crm_receipts_v10 where id in(current_setting('test.v29.pending_partial_request')::uuid,
  current_setting('test.v29.pending_paid_request')::uuid,current_setting('test.v29.pending_sale_request')::uuid)
  and not is_debt_repayment and unclassified_amount=0 and shift_id=current_setting('test.v29.shift')::uuid)=3,
  'Normal after-procedure payments were stored as separate debt');
 perform pg_temp.v29_assert((select paid_total from public.procedures where id=current_setting('test.v29.debt_procedure')::uuid)=100
  and (select paid_total from public.sales where id=current_setting('test.v29.debt_sale')::uuid)=100
  and (select paid_total from public.procedures where id=current_setting('test.v29.mistaken_procedure')::uuid)=0,
  'Collection rewrote historical treatment payment amounts');
 perform pg_temp.v29_assert(not exists(select 1 from public.stock where medication_id=current_setting('test.v29.med')::uuid and quantity<>0)
  and not exists(select 1 from public.stock_movements where medication_id=current_setting('test.v29.med')::uuid),
  'Payment-only clinical or debt flow changed stock');
 perform pg_temp.v29_assert((select count(*) from public.patients)::text=current_setting('test.v29.patient_count'),
  'Anonymous sale repayment created a dummy patient');
 perform pg_temp.v29_assert(not has_table_privilege('authenticated','private.crm_receipts_v10','SELECT')
  and not has_table_privilege('anon','private.crm_receipts_v10','SELECT'), 'Repayment ledger is directly exposed');
 perform pg_temp.v29_assert(not exists(select 1 from v29_existing_patients e left join public.patients p using(id) where to_jsonb(p) is distinct from e.original)
  and not exists(select 1 from v29_existing_procedures e left join public.procedures p using(id) where to_jsonb(p) is distinct from e.original)
  and not exists(select 1 from v29_existing_sales e left join public.sales s using(id) where to_jsonb(s) is distinct from e.original)
  and not exists(select 1 from v29_existing_allocations e left join private.crm_payment_allocations a using(id) where to_jsonb(a) is distinct from e.original)
  and not exists(select 1 from v29_existing_receipts e left join private.crm_receipts_v10 receipt_existing using(id) where to_jsonb(receipt_existing) is distinct from e.original),
  'Acceptance test modified a preexisting row');
end $$;

select true as debt_ledger_v29_verified;
rollback;
