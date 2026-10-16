-- Run after v34. Synthetic RPC records only; all data is rolled back.
begin;
create function pg_temp.v34_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v34 acceptance: %',message;end if;end $$;

do $$declare u uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();s uuid;s2 uuid;sh uuid;pt uuid;sv uuid;m uuid;
begin
 insert into auth.users(id,email) values(u,u::text||'@payment-v34.example.invalid'),(u2,u2::text||'@payment-v34.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST methods nurse v34','nurse',true,u) returning id into s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST methods peer v34','nurse',true,u2) returning id into s2;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2099-02-20',timestamptz '2099-02-20 08:30+03',timestamptz '2099-02-20 16:00+03','open') returning id into sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,s);
 insert into public.patients(full_name) values('TEST methods patient v34') returning id into pt;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('TEST methods service v34',1000,0,true) returning id into sv;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST methods medicine v34','амп.',5,0,1000,0,0) returning id into m;
 insert into public.stock(medication_id,location,quantity) values(m,'reserve',0),(m,'work',0);
 update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
 perform set_config('test.v34.user',u::text,true);perform set_config('test.v34.peer',u2::text,true);
 perform set_config('test.v34.staff',s::text,true);perform set_config('test.v34.shift',sh::text,true);
 perform set_config('test.v34.patient',pt::text,true);perform set_config('test.v34.service',sv::text,true);perform set_config('test.v34.med',m::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
create function pg_temp.v34_payload(kind_n text,status_n text,pay_n jsonb) returns jsonb language sql as $$
 select jsonb_build_object('patient_id',current_setting('test.v34.patient'),'shift_id',current_setting('test.v34.shift'),
  'nurse_id',current_setting('test.v34.staff'),'service_id',case when kind_n='procedure' then current_setting('test.v34.service') else null end,
  'items',case when kind_n='sale' then jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v34.med'),'quantity',1)) else '[]'::jsonb end,
  'charge_total',1000,'payment_status',status_n,'expected_stock_deducted',false,'payments',pay_n)
$$;

set local role authenticated;
do $$declare a jsonb;p jsonb;begin
 a:=public.record_treatment_v5('procedure',pg_temp.v34_payload('procedure','paid','{"cash":100,"terminal":200,"owner_card":700}'),gen_random_uuid());
 perform set_config('test.v34.mixed',a->>'id',true);
 a:=public.record_treatment_v5('procedure',pg_temp.v34_payload('procedure','pending','{"cash":100,"terminal":200,"owner_card":300}'),gen_random_uuid());
 perform set_config('test.v34.pending',a->>'id',true);
 p:=jsonb_build_object('kind','procedure','id',a->>'id','shift_id',current_setting('test.v34.shift'),
  'nurse_id',current_setting('test.v34.staff'),'payments',jsonb_build_object('owner_card',400),'comment','TEST normal after-procedure payment');
 perform public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
 a:=public.record_treatment_v5('sale',pg_temp.v34_payload('sale','debt','{"terminal":100}'),gen_random_uuid());
 perform set_config('test.v34.debt',a->>'id',true);
 perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','sale','id',a->>'id',
  'amount',300,'paid_on','2099-02-21','purpose','TEST separate debt repayment'),gen_random_uuid());
 a:=public.record_treatment_v5('procedure',pg_temp.v34_payload('procedure','paid','{"terminal":1000}'),gen_random_uuid());
 perform set_config('test.v34.legacy',a->>'id',true);
 a:=public.record_treatment_v5('procedure',pg_temp.v34_payload('procedure','pending','{"cash":100}'),gen_random_uuid());
 perform set_config('test.v34.voided',a->>'id',true);
 p:=jsonb_build_object('kind','procedure','id',a->>'id','shift_id',current_setting('test.v34.shift'),
  'nurse_id',current_setting('test.v34.staff'),'payments',jsonb_build_object('terminal',200),'comment','TEST receipt later marked erroneous');
 perform public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
end $$;
reset role;

-- Model a legacy initial receipt without allocation and an explicitly voided
-- ordinary receipt. Fixture changes affect only synthetic rows in this rollback.
delete from private.crm_payment_allocations where procedure_id=current_setting('test.v34.legacy')::uuid;
do $$declare req uuid:=gen_random_uuid();begin
 insert into private.warehouse_requests(id,staff_user,action,payload) values(req,current_setting('test.v34.user')::uuid,'TEST v34 void','{}');
 update private.crm_receipts_v10 set voided_at=now(),voided_by=current_setting('test.v34.user')::uuid,
  void_reason='TEST mistaken payment',void_request_id=req where procedure_id=current_setting('test.v34.voided')::uuid;
 update private.crm_payment_allocations set voided_at=now(),voided_by=current_setting('test.v34.user')::uuid,
  void_reason='TEST mistaken payment',void_request_id=req where procedure_id=current_setting('test.v34.voided')::uuid;
 update public.procedures set paid_total=0 where id=current_setting('test.v34.voided')::uuid;
end $$;
create temporary table v34_before_read as select jsonb_build_object(
 'allocations',(select jsonb_agg(to_jsonb(x) order by id) from private.crm_payment_allocations x),
 'receipts',(select jsonb_agg(to_jsonb(x) order by id) from private.crm_receipts_v10 x),
 'stock',(select jsonb_agg(to_jsonb(x) order by medication_id,location) from public.stock x)) state;

set local role authenticated;
do $$declare a jsonb;h jsonb;begin
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v34.mixed')));
 perform pg_temp.v34_assert((a->>'payments_complete')::boolean and a->'payments'='{"cash":100,"terminal":200,"owner_card":700,"unclassified":0,"total":1000}'::jsonb,
  'Mixed initial payment channels were not preserved');
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v34.pending')));
 perform pg_temp.v34_assert(a->'payments'='{"cash":100,"terminal":200,"owner_card":700,"unclassified":0,"total":1000}'::jsonb
  and (a->>'received_total')::numeric=1000 and (a->>'debt_repayments_total')::numeric=0 and not(a->>'payment_pending')::boolean,
  'Ordinary after-procedure payment missing or incorrectly treated as debt');
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v34.debt')));
 perform pg_temp.v34_assert(a->'payments'='{"cash":0,"terminal":100,"owner_card":0,"unclassified":0,"total":100}'::jsonb
  and (a->>'debt_repayments_total')::numeric=300 and (a->>'received_total')::numeric=400 and (a->>'debt_total')::numeric=600,
  'True debt repayment entered ordinary payment methods or lifetime arithmetic changed');
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v34.legacy')));
 perform pg_temp.v34_assert(a->'payments'='{"cash":0,"terminal":0,"owner_card":0,"unclassified":1000,"total":1000}'::jsonb,
  'Unknown historic method fabricated as cash/card/terminal');
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v34.voided')));
 perform pg_temp.v34_assert(a->'payments'='{"cash":0,"terminal":0,"owner_card":0,"unclassified":0,"total":0}'::jsonb
  and (a->>'received_total')::numeric=0,'Voided allocations/receipts counted');
 h:=public.crm_clinical_v10('patient_treatments',jsonb_build_object('patient_id',current_setting('test.v34.patient')));
 perform pg_temp.v34_assert(jsonb_array_length(h->'procedures')=4 and jsonb_array_length(h->'sales')=1,
  'Patient history lost past procedures or medication sales');
end $$;
reset role;

do $$declare a jsonb;begin
 a:=private.crm_shift_treatment_snapshot_v29('sale',current_setting('test.v34.debt')::uuid);
 perform pg_temp.v34_assert((a->>'received_total')::numeric=100 and (a->>'lifetime_received_total')::numeric=400
  and(a->'payments'->>'total')::numeric=100 and(a->>'debt_repayments_total')::numeric=300,
  'Shift snapshot must retain ordinary/debt separation');
 perform pg_temp.v34_assert((select state from v34_before_read)=jsonb_build_object(
  'allocations',(select jsonb_agg(to_jsonb(x) order by id) from private.crm_payment_allocations x),
  'receipts',(select jsonb_agg(to_jsonb(x) order by id) from private.crm_receipts_v10 x),
  'stock',(select jsonb_agg(to_jsonb(x) order by medication_id,location) from public.stock x)),
  'History reads changed payment or stock data');
 perform pg_temp.v34_assert(not has_function_privilege('anon','private.crm_treatment_snapshot_v10(text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_treatment_snapshot_v10(text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_treatment_snapshot_v10_before_v34(text,uuid)','EXECUTE'),
  'Private snapshot is directly callable');
end $$;

-- A nurse from another/closed shift may inspect the complete patient history,
-- but that does not grant permission to edit the original procedure.
update public.shifts set status='closed',ended_at=planned_end_at where id=current_setting('test.v34.shift')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.v34.peer'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v34.peer'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare h jsonb;a jsonb;begin
 h:=public.crm_clinical_v10('patient_treatments',jsonb_build_object('patient_id',current_setting('test.v34.patient')));
 perform pg_temp.v34_assert(jsonb_array_length(h->'procedures')=4,'Nurse history restricted to own shift');
 for a in select value from jsonb_array_elements(h->'procedures') loop
  perform pg_temp.v34_assert(not(a->>'editable')::boolean and (a->>'payments_complete')::boolean,
   'Cross-nurse history lost methods or gained edit rights');
 end loop;
end $$;
reset role;
rollback;
