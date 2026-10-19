-- Synthetic identities and public-RPC financial scenarios; every write is rolled back.
begin;
set local statement_timeout='90s';
create function pg_temp.v47_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v47 acceptance: %',message;end if;end $$;
do $$declare a jsonb;bad jsonb;failed boolean;
begin
 a:=private.crm_validate_payment_v10('{"other_card":750}');
 perform pg_temp.v47_assert((a->>'total')::numeric=750 and (a->>'cash')::numeric=0 and(a->>'change')::numeric=0,'other card must be noncash');
 a:=private.crm_validate_payment_v10('{"cash":100,"terminal":200,"owner_card":300,"other_card":400,"cash_received":150}');
 perform pg_temp.v47_assert((a->>'total')::numeric=1000 and(a->>'change')::numeric=50,'four-channel sum and change');
 perform pg_temp.v47_assert((private.crm_validate_payment_v10('{"terminal":25}')->>'other_card')::numeric=0,'old clients default to zero');
 for bad in select value from jsonb_array_elements('[{"other_card":-1},{"other_card":0.001},{"other_card":"NaN"},{"other_card":"Infinity"},{"other_card":1,"unknown":1},{"other_card":1,"cash_received":2}]') loop
  failed:=false;begin perform private.crm_validate_payment_v10(bad);exception when others then failed:=true;end;
  perform pg_temp.v47_assert(failed,'invalid allocation accepted');
 end loop;
end $$;
do $$declare u uuid:=gen_random_uuid();admin_u uuid:=gen_random_uuid();s uuid;ad uuid;sh uuid;sh2 uuid;pt uuid;sv uuid;m uuid;
begin
 insert into auth.users(id,email) values(u,u::text||'@v47.example.invalid'),(admin_u,admin_u::text||'@v47.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST other-card nurse v47','nurse',true,u) returning id into s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST other-card admin v47','admin',true,admin_u) returning id into ad;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2098-07-18',timestamptz '2098-07-18 08:30+03',timestamptz '2098-07-18 16:00+03','open') returning id into sh;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2098-07-19',timestamptz '2098-07-19 08:30+03',timestamptz '2098-07-19 16:00+03','open') returning id into sh2;
 insert into public.shift_staff(shift_id,staff_id) values(sh,s),(sh2,s);
 insert into public.patients(full_name) values('TEST other-card patient v47') returning id into pt;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('TEST other-card service v47',1000,0,true) returning id into sv;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold) values('TEST other-card medication v47','амп.',5,0,1000,0,0) returning id into m;
 insert into public.stock(medication_id,location,quantity) values(m,'reserve',0),(m,'work',0);
 update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
 perform set_config('test.v47.user',u::text,true);perform set_config('test.v47.admin',admin_u::text,true);perform set_config('test.v47.staff',s::text,true);
 perform set_config('test.v47.shift',sh::text,true);perform set_config('test.v47.shift2',sh2::text,true);perform set_config('test.v47.patient',pt::text,true);perform set_config('test.v47.service',sv::text,true);perform set_config('test.v47.med',m::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
create function pg_temp.v47_payload(kind_n text,status_n text,pay_n jsonb) returns jsonb language sql as $$
 select jsonb_build_object('patient_id',current_setting('test.v47.patient'),'shift_id',current_setting('test.v47.shift'),'nurse_id',current_setting('test.v47.staff'),
 'service_id',case when kind_n='procedure' then current_setting('test.v47.service') else null end,
 'items',case when kind_n='sale' then jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v47.med'),'quantity',1)) else '[]'::jsonb end,
 'charge_total',1000,'payment_status',status_n,'expected_stock_deducted',false,'payments',pay_n)
$$;
set local role authenticated;
do $$declare a jsonb;b jsonb;p jsonb;req uuid:=gen_random_uuid();begin
 p:=pg_temp.v47_payload('procedure','paid','{"other_card":1000}');a:=public.record_treatment_v5('procedure',p,req);b:=public.record_treatment_v5('procedure',p,req);
 perform pg_temp.v47_assert(a=b and(a->'payments'->>'other_card')::numeric=1000,'create/retry other card');perform set_config('test.v47.full',a->>'id',true);
 a:=public.record_treatment_v5('sale',pg_temp.v47_payload('sale','paid','{"cash":100,"terminal":200,"owner_card":300,"other_card":400,"cash_received":150}'),gen_random_uuid());perform set_config('test.v47.mixed',a->>'id',true);
 a:=public.record_treatment_v5('procedure',pg_temp.v47_payload('procedure','pending','{"other_card":200}'),gen_random_uuid());perform set_config('test.v47.pending',a->>'id',true);
 p:=jsonb_build_object('kind','procedure','id',a->>'id','shift_id',current_setting('test.v47.shift'),'nurse_id',current_setting('test.v47.staff'),'payments',jsonb_build_object('other_card',300),'comment','TEST ordinary collection v47');req:=gen_random_uuid();
 a:=public.crm_clinical_v10('debt_payment',p,req);b:=public.crm_clinical_v10('debt_payment',p,req);perform pg_temp.v47_assert(a=b,'ordinary receipt retry');
 p:=p||jsonb_build_object('shift_id',current_setting('test.v47.shift2'),'payments',jsonb_build_object('other_card',500));perform public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
 a:=public.record_treatment_v5('sale',pg_temp.v47_payload('sale','debt','{"other_card":100}'),gen_random_uuid());perform set_config('test.v47.debt',a->>'id',true);
 perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','sale','id',a->>'id','amount',300,'paid_on','2098-07-19','purpose','TEST separate debt v47'),gen_random_uuid());
 a:=public.record_treatment_v5('procedure',pg_temp.v47_payload('procedure','paid','{"terminal":1000}'),gen_random_uuid());perform set_config('test.v47.legacy',a->>'id',true);
end $$;
reset role;
-- Stable fictional calendar dates for the period/dashboard queries.
update public.procedures set visit_at=timestamptz '2098-07-18 10:00+03' where patient_id=current_setting('test.v47.patient')::uuid;
update public.sales set sold_at=timestamptz '2098-07-18 10:00+03' where patient_id=current_setting('test.v47.patient')::uuid;
update private.crm_receipts_v10 r set created_at=case when shift_id=current_setting('test.v47.shift')::uuid then timestamptz '2098-07-18 11:00+03' else timestamptz '2098-07-19 11:00+03' end where procedure_id=current_setting('test.v47.pending')::uuid;
do $$declare a jsonb;b jsonb;g text;begin
 a:=private.crm_treatment_snapshot_v10('procedure',current_setting('test.v47.pending')::uuid);
 perform pg_temp.v47_assert((a->'payments'->>'other_card')::numeric=1000 and(a->'payments'->>'total')::numeric=1000 and(a->>'debt_total')::numeric=0 and not(a->>'payment_pending')::boolean,'lifetime ordinary receipt snapshot');
 a:=private.crm_shift_treatment_snapshot_v29('procedure',current_setting('test.v47.pending')::uuid);
 perform pg_temp.v47_assert((a->'shift_payments_v45'->>'other_card')::numeric=500 and(a->>'received_other_shifts_v45')::numeric=500,'shift-scoped other card');
 a:=private.crm_treatment_snapshot_v10('sale',current_setting('test.v47.debt')::uuid);
 perform pg_temp.v47_assert((a->'payments'->>'other_card')::numeric=100 and(a->>'debt_repayments_total')::numeric=300 and(a->>'debt_total')::numeric=600,'true debt remains outside ordinary payment methods');
 a:=private.crm_build_shift_report_v5(current_setting('test.v47.shift')::uuid);b:=private.crm_build_shift_report_v5(current_setting('test.v47.shift2')::uuid);
 perform pg_temp.v47_assert((a->'revenue'->>'other_card')::numeric=2000 and(a->'revenue'->>'cash')::numeric=100 and(a->'revenue'->>'terminal')::numeric=1200 and(a->'revenue'->>'owner_card')::numeric=300 and(a->'revenue'->>'total')::numeric=3600,'first shift four-channel report');
 perform pg_temp.v47_assert((b->'revenue'->>'other_card')::numeric=500 and(b->'revenue'->>'total')::numeric=500,'second shift ordinary collection');
 a:=private.crm_cash_drawer_facts_v30(current_setting('test.v47.shift')::uuid);b:=private.crm_cash_drawer_facts_v30(current_setting('test.v47.shift2')::uuid);
 perform pg_temp.v47_assert((a->>'received_cash')::numeric=100 and(b->>'received_cash')::numeric=0,'other-card transfers must never enter cash');
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.v47.admin'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v47.admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;g text;begin
 for g in select unnest(array['day','employee','patient','medication','service']) loop
  a:=public.crm_finance_v5('summary',jsonb_build_object('from','2098-07-18','to','2098-07-19','group_by',g));
  perform pg_temp.v47_assert((a->'revenue'->>'other_card')::numeric=2500 and(a->'revenue'->>'total')::numeric=4100,'period fourth-channel total/grouping '||g);
 end loop;
 a:=public.crm_dashboard_day_v25(date '2098-07-18');
 perform pg_temp.v47_assert((a->'working_day'->'revenue'->>'other_card')::numeric=2000,'dashboard shift-day fourth channel');
end $$;
-- Extra work on a previously settled bill is a new ordinary collection,
-- while the old true-loan scenario above remains outside shift income.
do $$declare a jsonb;b jsonb;p jsonb;req uuid:=gen_random_uuid();begin
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v47.full')));
 p:=jsonb_build_object('kind','procedure','id',current_setting('test.v47.full'),'expected_version',a->'version',
  'edit_reason','TEST added medicine after original settlement v47','payment_status','paid','payments',jsonb_build_object('other_card',1000),
  'charge_total',2000,'expected_stock_deducted',false,
  'services',jsonb_build_array(jsonb_build_object('service_id',current_setting('test.v47.service'),'quantity',1)),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v47.med'),'quantity',1)),'own_medications','[]'::jsonb);
 a:=public.crm_clinical_v10('treatment_edit',p,req);b:=public.crm_clinical_v10('treatment_edit',p,req);
 perform pg_temp.v47_assert(a=b,'ordinary extra-charge edit retry');
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v47.full')));
 perform pg_temp.v47_assert((a->'payments'->>'other_card')::numeric=2000 and(a->>'received_total')::numeric=2000 and(a->>'debt_repayments_total')::numeric=0,'extra charge must not be a true-loan repayment');
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v47.shift')));
 perform pg_temp.v47_assert((a->'revenue'->>'other_card')::numeric=3000 and(a->'revenue'->>'total')::numeric=4600 and(a->'revenue'->>'cash')::numeric=100,'extra charge enters its receiving shift only');
end $$;
-- Correct only fictional money explicitly marked as never received.
do $$declare a jsonb;b jsonb;p jsonb;req uuid:=gen_random_uuid();begin
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v47.full')));
 p:=jsonb_build_object('kind','procedure','id',current_setting('test.v47.full'),'expected_version',a->'version','expected_received_total',2000,
  'confirm_no_money_received',true,'correction_reason','TEST other-card funds never received v47','payment_status','debt',
  'payments','{}'::jsonb,'paid_total',0,'charge_total',2000,'expected_stock_deducted',false,
  'services',jsonb_build_array(jsonb_build_object('service_id',current_setting('test.v47.service'),'quantity',1)),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v47.med'),'quantity',1)),'own_medications','[]'::jsonb);
 a:=public.crm_payment_correction_v22(p,req);b:=public.crm_payment_correction_v22(p,req);
 perform pg_temp.v47_assert(a=b and(a->'payments'->>'other_card')::numeric=0 and(a->>'debt_total')::numeric=2000,'other-card correction/void and retry');
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v47.shift')));
 perform pg_temp.v47_assert((a->'revenue'->>'cash')::numeric=100 and(a->'revenue'->>'other_card')::numeric=1000 and(a->'revenue'->>'total')::numeric=2600,'correction changes only the fourth channel');
end $$;
-- Editing an already-unpaid true loan must retain the separate debt ledger.
do $$declare a jsonb;b jsonb;p jsonb;req uuid:=gen_random_uuid();begin
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v47.debt')));
 p:=jsonb_build_object('kind','sale','id',current_setting('test.v47.debt'),'expected_version',a->'version',
  'edit_reason','TEST collection while editing an existing true loan v47','payment_status','debt','payments',jsonb_build_object('other_card',100),
  'charge_total',1000,'expected_stock_deducted',false,
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v47.med'),'quantity',1)),'own_medications','[]'::jsonb);
 a:=public.crm_clinical_v10('treatment_edit',p,req);b:=public.crm_clinical_v10('treatment_edit',p,req);
 perform pg_temp.v47_assert(a=b,'true-loan edit retry');
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v47.debt')));
 perform pg_temp.v47_assert((a->'payments'->>'other_card')::numeric=100 and(a->>'debt_repayments_total')::numeric=400 and(a->>'debt_total')::numeric=500,'editing an unpaid loan must not turn repayment into shift income');
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v47.shift')));
 perform pg_temp.v47_assert((a->'revenue'->>'other_card')::numeric=1000 and(a->'revenue'->>'total')::numeric=2600,'true-loan edit collection remains excluded from shift');
end $$;
reset role;
do $$begin
 perform pg_temp.v47_assert(not has_function_privilege('authenticated','private.crm_validate_payment_v10(jsonb)','execute') and not has_function_privilege('anon','private.crm_treatment_snapshot_v10(text,uuid)','execute'),'private helper ACL boundary');
 perform pg_temp.v47_assert(not exists(select 1 from pg_proc where oid in('private.crm_validate_payment_v10(jsonb)'::regprocedure,'private.crm_shift_treatment_snapshot_v29(text,uuid)'::regprocedure,'private.crm_cash_financial_snapshot_v37(uuid)'::regprocedure) and prosecdef),'new helper must not gain definer privilege');
end $$;
rollback;
