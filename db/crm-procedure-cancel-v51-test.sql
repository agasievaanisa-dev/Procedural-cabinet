-- Synthetic acceptance only. Execute after v51; every fixture rolls back.
begin;
set local statement_timeout='90s';
create function pg_temp.v51c_assert(ok boolean,why text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v51 cancellation: %',why;end if;end $$;
create function pg_temp.v51c_actor(key_n text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',current_setting('test.v51c.'||key_n),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v51c.'||key_n),'role','authenticated')::text,true);
end $$;
do $$declare admin_u uuid:=gen_random_uuid();owner_u uuid:=gen_random_uuid();nurse_u uuid:=gen_random_uuid();inactive_u uuid:=gen_random_uuid();
 nurse_n uuid;sh uuid;partial_sh uuid;pt uuid;other_pt uuid;service_n uuid;med_n uuid;partial_med uuid;batch_n uuid;
begin
 insert into auth.users(id,email) values(admin_u,admin_u::text||'@cancel-v51.example.invalid'),
  (owner_u,owner_u::text||'@cancel-v51.example.invalid'),(nurse_u,nurse_u::text||'@cancel-v51.example.invalid'),
  (inactive_u,inactive_u::text||'@cancel-v51.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cancellation admin v51','admin',true,admin_u),
  ('TEST cancellation owner v51','owner',true,owner_u),('TEST inactive admin v51','admin',false,inactive_u);
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cancellation nurse v51','nurse',true,nurse_u) returning id into nurse_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2001-02-11',timestamptz '2001-02-11 08:30+03',timestamptz '2001-02-11 16:00+03','open') returning id into sh;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2001-02-12',timestamptz '2001-02-12 08:30+03',timestamptz '2001-02-12 16:00+03','open') returning id into partial_sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,nurse_n),(partial_sh,nurse_n);
 insert into public.patients(full_name) values('TEST duplicate-only patient v51') returning id into pt;
 insert into public.patients(full_name) values('TEST retained patient v51') returning id into other_pt;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST cancellation service v51',100,0,true) returning id into service_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST exact-return medicine v51','амп.',10,10,100,0,0) returning id into med_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST partial-return medicine v51','амп.',5,10,100,0,0) returning id into partial_med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(med_n,100,100,100,10,current_date+365) returning id into batch_n;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(partial_med,1,1,1,10,current_date+365);
 insert into public.stock(medication_id,location,quantity) values(med_n,'reserve',0),(med_n,'work',100),(partial_med,'reserve',0),(partial_med,'work',1);
 update private.crm_finance_settings set payment_only=false,partial_stock=false where id;
 perform set_config('test.v51c.admin',admin_u::text,true);perform set_config('test.v51c.owner',owner_u::text,true);
 perform set_config('test.v51c.nurse',nurse_u::text,true);perform set_config('test.v51c.inactive',inactive_u::text,true);
 perform set_config('test.v51c.nurse_id',nurse_n::text,true);perform set_config('test.v51c.shift',sh::text,true);
 perform set_config('test.v51c.partial_shift',partial_sh::text,true);perform set_config('test.v51c.patient',pt::text,true);
 perform set_config('test.v51c.other_patient',other_pt::text,true);perform set_config('test.v51c.service',service_n::text,true);
 perform set_config('test.v51c.med',med_n::text,true);perform set_config('test.v51c.partial_med',partial_med::text,true);
 perform set_config('test.v51c.batch',batch_n::text,true);
 perform pg_temp.v51c_actor('admin');
 perform pg_temp.v51c_assert(not has_table_privilege('authenticated','private.crm_cancelled_procedures_v51','SELECT')
  and not has_table_privilege('anon','private.crm_active_procedures_v51','SELECT')
  and not has_function_privilege('anon','public.crm_procedure_cancel_v51(jsonb,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_procedure_cancel_v51(jsonb,uuid)','EXECUTE'),'Private history/API grants exposed');
end $$;
create function pg_temp.v51c_create(q numeric,paid_n numeric default 0,patient_n text default null) returns jsonb language sql as $$
 select public.record_treatment_v5('procedure',jsonb_build_object('shift_id',current_setting('test.v51c.shift'),
  'nurse_id',current_setting('test.v51c.nurse_id'),'patient_id',coalesce(patient_n,current_setting('test.v51c.patient')),
  'service_id',current_setting('test.v51c.service'),'items',case when q>0 then jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v51c.med'),'quantity',q)) else '[]'::jsonb end,
  'charge_total',100+q*100,'paid_total',paid_n,'payment_status',case when paid_n=100+q*100 then 'paid' else 'pending' end,
  'payments',jsonb_build_object('terminal',paid_n),'expected_stock_deducted',true,'expected_partial_stock',false),gen_random_uuid())
$$;
create function pg_temp.v51c_payload(a jsonb) returns jsonb language sql as $$
 select jsonb_build_object('id',a->>'id','expected_version',a->'version','expected_received_total',a->'received_total',
  'reason','TEST nurse duplicate v51','confirmed_duplicate',true)
$$;
set local role authenticated;
do $$declare a jsonb;p jsonb;req uuid;failed_n boolean;
begin
 a:=pg_temp.v51c_create(3);perform set_config('test.v51c.duplicate',a->>'id',true);
 p:=pg_temp.v51c_payload(a);perform set_config('test.v51c.stale_payload',p::text,true);
 a:=public.crm_clinical_v10('treatment_edit',jsonb_build_object('kind','procedure','id',a->>'id','expected_version',a->'version',
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v51c.med'),'quantity',2)),
  'services',a->'services','own_medications','[]'::jsonb,'charge_total',300,'payment_status','pending',
  'payments','{}'::jsonb,'edit_reason','TEST reduce by one before cancellation','expected_stock_deducted',true),gen_random_uuid());
 perform set_config('test.v51c.cancel_payload',pg_temp.v51c_payload(a)::text,true);
 a:=pg_temp.v51c_create(1,0,current_setting('test.v51c.other_patient'));perform set_config('test.v51c.keep',a->>'id',true);
 a:=pg_temp.v51c_create(0,100,current_setting('test.v51c.other_patient'));perform set_config('test.v51c.paid',a->>'id',true);
 failed_n:=false;begin perform public.crm_procedure_cancel_v51(pg_temp.v51c_payload(a),gen_random_uuid());
 exception when invalid_parameter_value then failed_n:=position('есть полученная оплата' in sqlerrm)>0;end;
 perform pg_temp.v51c_assert(failed_n,'Received money must block cancellation');
 a:=pg_temp.v51c_create(0,0,current_setting('test.v51c.other_patient'));perform set_config('test.v51c.race',a->>'id',true);
 p:=pg_temp.v51c_payload(a);perform set_config('test.v51c.race_payload',p::text,true);
 perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',a->>'id',
  'shift_id',current_setting('test.v51c.shift'),'nurse_id',current_setting('test.v51c.nurse_id'),'payments',jsonb_build_object('cash',10)),gen_random_uuid());
 failed_n:=false;begin perform public.crm_procedure_cancel_v51(p,gen_random_uuid());
 exception when serialization_failure then failed_n:=true;end;
 perform pg_temp.v51c_assert(failed_n,'A receipt arriving after preview must invalidate cancellation CAS');
 failed_n:=false;begin perform public.crm_procedure_cancel_v51(current_setting('test.v51c.stale_payload')::jsonb,gen_random_uuid());
 exception when serialization_failure then failed_n:=true;end;
 perform pg_temp.v51c_assert(failed_n,'An intervening composition edit must invalidate cancellation CAS');
 failed_n:=false;begin perform public.crm_procedure_cancel_v51(current_setting('test.v51c.cancel_payload')::jsonb||'{"confirmed_duplicate":false}',gen_random_uuid());
 exception when invalid_parameter_value then failed_n:=true;end;
 perform pg_temp.v51c_assert(failed_n,'Deletion requires explicit duplicate confirmation');
 failed_n:=false;begin perform public.crm_procedure_cancel_v51(current_setting('test.v51c.cancel_payload')::jsonb||'{"reason":""}',gen_random_uuid());
 exception when invalid_parameter_value then failed_n:=true;end;
 perform pg_temp.v51c_assert(failed_n,'Deletion requires an audit reason');
end $$;
reset role;
-- Same administrative API is denied to a nurse and an inactive administrator.
select pg_temp.v51c_actor('nurse');
set local role authenticated;
do $$declare rejected_n boolean:=false;begin
 begin perform public.crm_procedure_cancel_v51(current_setting('test.v51c.cancel_payload')::jsonb,gen_random_uuid());
 exception when insufficient_privilege then rejected_n:=true;end;
 perform pg_temp.v51c_assert(rejected_n,'Nurse deleted a procedure');
end $$;
reset role;
select pg_temp.v51c_actor('inactive');
set local role authenticated;
do $$declare rejected_n boolean:=false;begin
 begin perform public.crm_procedure_cancel_v51(current_setting('test.v51c.cancel_payload')::jsonb,gen_random_uuid());
 exception when insufficient_privilege then rejected_n:=true;end;
 perform pg_temp.v51c_assert(rejected_n,'Inactive manager deleted a procedure');
end $$;
reset role;
select pg_temp.v51c_actor('admin');
-- Snapshot exact money and preserved bill/details before canceling a CLOSED
-- shift. An immutable cash count must become stale, not be rewritten.
select set_config('test.v51c.money_before',(select jsonb_build_object('allocations',
 (select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a join public.procedures p on p.id=a.procedure_id where p.shift_id=current_setting('test.v51c.shift')::uuid),
 'receipts',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r where r.shift_id=current_setting('test.v51c.shift')::uuid))::text),true);
select set_config('test.v51c.original_bill',(select to_jsonb(p)::text from public.procedures p where id=current_setting('test.v51c.duplicate')::uuid),true);
select set_config('test.v51c.original_details',(select jsonb_agg(to_jsonb(d) order by medication_id)::text from public.procedure_medications d where procedure_id=current_setting('test.v51c.duplicate')::uuid),true);
select set_config('test.v51c.report_before',private.crm_build_shift_report_v5(current_setting('test.v51c.shift')::uuid)::text,true);
set local role authenticated;
do $$declare a jsonb;answer_n jsonb;req uuid:=gen_random_uuid();failed_n boolean;
begin
 a:=public.crm_cash_reconciliation_v37('status',jsonb_build_object('shift_id',current_setting('test.v51c.shift')));
 perform public.crm_cash_reconciliation_v37('save',jsonb_build_object('shift_id',current_setting('test.v51c.shift'),
  'expected_token',a->'reconciliation_v37'->>'token','counted_cash',10,'salary_confirmed',false,
  'opening_amount',0,'reason','TEST unchanged money before duplicate deletion v51'),gen_random_uuid());
 perform public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v51c.shift')));
 answer_n:=public.crm_procedure_cancel_v51(current_setting('test.v51c.cancel_payload')::jsonb,req);
 perform pg_temp.v51c_assert(answer_n=public.crm_procedure_cancel_v51(current_setting('test.v51c.cancel_payload')::jsonb,req),
  'Completed retry must return exactly once after the procedure is hidden');
 perform pg_temp.v51c_assert((answer_n->>'cancelled')::boolean and(answer_n->'returned_stock'->0->>'quantity')::numeric=2,
  'Cancellation returned original 3 instead of net 2 consumed units');
 perform set_config('test.v51c.cancel_request',req::text,true);
 failed_n:=false;begin perform public.crm_procedure_cancel_v51(current_setting('test.v51c.cancel_payload')::jsonb||'{"reason":"different"}',req);
 exception when invalid_parameter_value then failed_n:=true;end;
 perform pg_temp.v51c_assert(failed_n,'Completed request accepted changed payload');
 failed_n:=false;begin perform public.crm_procedure_cancel_v51(current_setting('test.v51c.cancel_payload')::jsonb,gen_random_uuid());
 exception when object_not_in_prerequisite_state then failed_n:=true;end;
 perform pg_temp.v51c_assert(failed_n,'A second UUID returned stock twice');
 failed_n:=false;begin perform public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v51c.duplicate')));
 exception when object_not_in_prerequisite_state then failed_n:=true;end;
 perform pg_temp.v51c_assert(failed_n,'Canceled procedure remained available for edit/repeat/payment');
 a:=public.crm_clinical_v10('patient_treatments',jsonb_build_object('patient_id',current_setting('test.v51c.patient')));
 perform pg_temp.v51c_assert(jsonb_array_length(a->'procedures')=0,'Canceled procedure remained in full patient history');
 a:=public.patient_history_v8(current_setting('test.v51c.patient')::uuid);
 perform pg_temp.v51c_assert(jsonb_array_length(a->'procedures')=0,'Canceled procedure remained in compact patient history');
 a:=public.crm_clinical_v10('debts',jsonb_build_object('patient_id',current_setting('test.v51c.patient')));
 perform pg_temp.v51c_assert(jsonb_array_length(a->'debts')=0 and(a->>'pending_total')::numeric=0,'Canceled bill remained in debt/pending totals');
 a:=public.crm_finance_v5('summary',jsonb_build_object('patient_id',current_setting('test.v51c.patient')));
 perform pg_temp.v51c_assert((a->>'procedures_count')::integer=0 and(a->>'charge_total')::numeric=0,'Canceled bill remained in period totals');
end $$;
reset role;
do $$declare a jsonb;b jsonb;money_n jsonb;rejected_n boolean:=false;
begin
 a:=private.crm_build_shift_report_v5(current_setting('test.v51c.shift')::uuid);b:=current_setting('test.v51c.report_before')::jsonb;
 perform pg_temp.v51c_assert((a->>'procedures_count')::integer=(b->>'procedures_count')::integer-1
  and(a->>'patients_count')::integer=(b->>'patients_count')::integer-1
  and(a->>'charge_total')::numeric=(b->>'charge_total')::numeric-300,'Shift patients/procedures/charge still include duplicate');
 perform pg_temp.v51c_assert(a->'revenue'=b->'revenue','Unpaid cancellation changed received money');
 perform pg_temp.v51c_assert((a->'cash_drawer'->>'received_cash')::numeric=10
  and(a->'cash_drawer'->'reconciliation_v37'->>'stale')::boolean,'Cash changed or old cash count was not marked stale');
 perform pg_temp.v51c_assert(not exists(select 1 from jsonb_array_elements((select report->'procedures' from private.crm_shift_reports where shift_id=current_setting('test.v51c.shift')::uuid)) x where x->>'id'=current_setting('test.v51c.duplicate')),'Closed cached report retained canceled row');
 perform pg_temp.v51c_assert((select to_jsonb(p) from public.procedures p where id=current_setting('test.v51c.duplicate')::uuid)=current_setting('test.v51c.original_bill')::jsonb
  and(select jsonb_agg(to_jsonb(d) order by medication_id) from public.procedure_medications d where procedure_id=current_setting('test.v51c.duplicate')::uuid)=current_setting('test.v51c.original_details')::jsonb,'Cancellation destroyed original bill/details');
 perform pg_temp.v51c_assert((select quantity from public.stock where medication_id=current_setting('test.v51c.med')::uuid and location='work')=99
  and(select quantity_remaining from public.medication_batches where id=current_setting('test.v51c.batch')::uuid)=99,'Batch-exact net return did not preserve other procedure consumption');
 select jsonb_build_object('allocations',(select jsonb_agg(to_jsonb(x) order by x.id) from private.crm_payment_allocations x join public.procedures p on p.id=x.procedure_id where p.shift_id=current_setting('test.v51c.shift')::uuid),
  'receipts',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r where r.shift_id=current_setting('test.v51c.shift')::uuid)) into money_n;
 perform pg_temp.v51c_assert(money_n=current_setting('test.v51c.money_before')::jsonb,'Cancellation altered allocation/receipt metadata or money');
 begin update public.procedures set notes='TEST forbidden stale edit' where id=current_setting('test.v51c.duplicate')::uuid;
 exception when object_not_in_prerequisite_state then rejected_n:=true;end;
 perform pg_temp.v51c_assert(rejected_n,'A stale internal update mutated a canceled procedure');
 perform pg_temp.v51c_assert((select count(*) from private.crm_audit_log where entity_id=current_setting('test.v51c.duplicate') and action='procedure_cancelled_v51')=1,'Cancellation audit/retry duplicated');
end $$;
-- Gradual inventory: one real unit and two unresolved units. Only the real
-- unit returns; unresolved demand disappears without inventing two ampoules.
update private.crm_finance_settings set payment_only=true,partial_stock=true where id;
select pg_temp.v51c_actor('owner');
set local role authenticated;
do $$declare a jsonb;p jsonb;answer_n jsonb;
begin
 a:=public.record_treatment_v5('procedure',jsonb_build_object('shift_id',current_setting('test.v51c.partial_shift'),
  'nurse_id',current_setting('test.v51c.nurse_id'),'patient_id',current_setting('test.v51c.patient'),
  'service_id',current_setting('test.v51c.service'),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v51c.partial_med'),'quantity',3)),
  'charge_total',400,'payment_status','debt','payments','{}'::jsonb,'expected_stock_deducted',false,'expected_partial_stock',true),gen_random_uuid());
 perform pg_temp.v51c_assert((a->'stock_summary'->>'deducted_quantity')::numeric=1
  and(a->'stock_summary'->>'pending_quantity')::numeric=2,'Gradual fixture must consume one and defer two');
 perform set_config('test.v51c.partial_procedure',a->>'id',true);
 answer_n:=public.crm_procedure_cancel_v51(pg_temp.v51c_payload(a),gen_random_uuid());
 perform pg_temp.v51c_assert((answer_n->'returned_stock'->0->>'quantity')::numeric=1,'Unresolved units were returned as real stock');
 a:=public.crm_clinical_v10('debts',jsonb_build_object('patient_id',current_setting('test.v51c.patient')));
 perform pg_temp.v51c_assert(jsonb_array_length(a->'debts')=0,'Canceled genuine-debt bill remained in debt list');
end $$;
reset role;
do $$begin
 perform pg_temp.v51c_assert(not exists(select 1 from private.crm_partial_stock_lines_v28 where kind='procedure' and record_id=current_setting('test.v51c.partial_procedure')::uuid)
  and exists(select 1 from private.crm_partial_stock_records_v28 where kind='procedure' and record_id=current_setting('test.v51c.partial_procedure')::uuid),'Partial pending demand not cleared or original tracking marker destroyed');
 perform pg_temp.v51c_assert((select quantity from public.stock where medication_id=current_setting('test.v51c.partial_med')::uuid and location='work')=1,'Gradual return manufactured units');
 perform pg_temp.v51c_assert((select count(*) from private.crm_cancelled_procedures_v51 where procedure_id in(current_setting('test.v51c.duplicate')::uuid,current_setting('test.v51c.partial_procedure')::uuid))=2,'Manager and owner cancellation not persisted');
end $$;
rollback;
