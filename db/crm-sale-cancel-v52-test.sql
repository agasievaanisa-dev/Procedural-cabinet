-- Synthetic cancellation acceptance only. Execute after v52; every fixture rolls back.
-- Includes anonymous sales, retained paid/mixed money, pending/debt, stock and CAS.
begin;
set local statement_timeout='90s';
create function pg_temp.v52c_assert(ok boolean,why text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v52 cancellation: %',why;end if;end $$;
create function pg_temp.v52c_actor(key_n text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',current_setting('test.v52c.'||key_n),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v52c.'||key_n),'role','authenticated')::text,true);
end $$;
do $$declare admin_u uuid:=gen_random_uuid();owner_u uuid:=gen_random_uuid();nurse_u uuid:=gen_random_uuid();inactive_u uuid:=gen_random_uuid();
 nurse_n uuid;sh uuid;partial_sh uuid;pt uuid;other_pt uuid;med_n uuid;partial_med uuid;batch_n uuid;
begin
 insert into auth.users(id,email) values(admin_u,admin_u::text||'@cancel-v52.example.invalid'),
  (owner_u,owner_u::text||'@cancel-v52.example.invalid'),(nurse_u,nurse_u::text||'@cancel-v52.example.invalid'),
  (inactive_u,inactive_u::text||'@cancel-v52.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cancellation admin v52','admin',true,admin_u),
  ('TEST cancellation owner v52','owner',true,owner_u),('TEST inactive admin v52','admin',false,inactive_u);
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST cancellation nurse v52','nurse',true,nurse_u) returning id into nurse_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2001-02-11',timestamptz '2001-02-11 08:30+03',timestamptz '2001-02-11 16:00+03','open') returning id into sh;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2001-02-12',timestamptz '2001-02-12 08:30+03',timestamptz '2001-02-12 16:00+03','open') returning id into partial_sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,nurse_n),(partial_sh,nurse_n);
 insert into public.patients(full_name) values('TEST duplicate-only patient v52') returning id into pt;
 insert into public.patients(full_name) values('TEST retained patient v52') returning id into other_pt;

 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST exact-return medicine v52','амп.',10,10,100,0,0) returning id into med_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST partial-return medicine v52','амп.',5,10,100,0,0) returning id into partial_med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(med_n,100,100,100,10,current_date+365) returning id into batch_n;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(partial_med,1,1,1,10,current_date+365);
 insert into public.stock(medication_id,location,quantity) values(med_n,'reserve',0),(med_n,'work',100),(partial_med,'reserve',0),(partial_med,'work',1);
 update private.crm_finance_settings set payment_only=false,partial_stock=false where id;
 perform set_config('test.v52c.admin',admin_u::text,true);perform set_config('test.v52c.owner',owner_u::text,true);
 perform set_config('test.v52c.nurse',nurse_u::text,true);perform set_config('test.v52c.inactive',inactive_u::text,true);
 perform set_config('test.v52c.nurse_id',nurse_n::text,true);perform set_config('test.v52c.shift',sh::text,true);
 perform set_config('test.v52c.partial_shift',partial_sh::text,true);perform set_config('test.v52c.patient',pt::text,true);
 perform set_config('test.v52c.other_patient',other_pt::text,true);
 perform set_config('test.v52c.med',med_n::text,true);perform set_config('test.v52c.partial_med',partial_med::text,true);
 perform set_config('test.v52c.batch',batch_n::text,true);
 perform pg_temp.v52c_actor('admin');
 perform pg_temp.v52c_assert(not has_table_privilege('authenticated','private.crm_cancelled_sales_v52','SELECT')
  and not has_table_privilege('anon','private.crm_active_sales_v52','SELECT')
  and not has_function_privilege('anon','public.crm_sale_cancel_v52(jsonb,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.crm_sale_cancel_v52(jsonb,uuid)','EXECUTE'),'Private history/API grants exposed');
end $$;
create function pg_temp.v52c_create(q numeric,paid_n numeric default 0,patient_n text default null) returns jsonb language sql as $$
 select public.record_treatment_v5('sale',jsonb_build_object('shift_id',current_setting('test.v52c.shift'),
  'nurse_id',current_setting('test.v52c.nurse_id'),'patient_id',patient_n,
  'items',case when q>0 then jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v52c.med'),'quantity',q)) else '[]'::jsonb end,
  'charge_total',q*100,'paid_total',paid_n,'payment_status',case when paid_n=q*100 then 'paid' else 'pending' end,
  'payments',jsonb_build_object('cash',paid_n/4,'terminal',paid_n/4,'owner_card',paid_n/4,'other_card',paid_n/4),'expected_stock_deducted',true,'expected_partial_stock',false),gen_random_uuid())
$$;
create function pg_temp.v52c_payload(a jsonb) returns jsonb language sql as $$
 select jsonb_build_object('id',a->>'id','expected_version',a->'version','expected_received_total',a->'received_total',
  'reason','TEST nurse duplicate v52','confirmed_duplicate',true)
$$;
set local role authenticated;
do $$declare a jsonb;p jsonb;req uuid;failed_n boolean;
begin
 a:=pg_temp.v52c_create(3);perform set_config('test.v52c.duplicate',a->>'id',true);
 p:=pg_temp.v52c_payload(a);perform set_config('test.v52c.stale_payload',p::text,true);
 a:=public.crm_clinical_v10('treatment_edit',jsonb_build_object('kind','sale','id',a->>'id','expected_version',a->'version',
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v52c.med'),'quantity',2)),
  'services',a->'services','own_medications','[]'::jsonb,'charge_total',200,'payment_status','pending',
  'payments','{}'::jsonb,'edit_reason','TEST reduce by one before cancellation','expected_stock_deducted',true),gen_random_uuid());
 perform set_config('test.v52c.cancel_payload',pg_temp.v52c_payload(a)::text,true);
 a:=pg_temp.v52c_create(1,0,current_setting('test.v52c.other_patient'));perform set_config('test.v52c.keep',a->>'id',true);
 a:=pg_temp.v52c_create(1,100,current_setting('test.v52c.other_patient'));perform set_config('test.v52c.paid',a->>'id',true);
 failed_n:=false;begin perform public.crm_sale_cancel_v52(pg_temp.v52c_payload(a),gen_random_uuid());
 exception when invalid_parameter_value then failed_n:=position('есть полученная оплата' in sqlerrm)>0;end;
 perform pg_temp.v52c_assert(failed_n,'Received money must block cancellation');
 a:=pg_temp.v52c_create(1,0,current_setting('test.v52c.other_patient'));perform set_config('test.v52c.race',a->>'id',true);
 p:=pg_temp.v52c_payload(a);perform set_config('test.v52c.race_payload',p::text,true);
 perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','sale','id',a->>'id',
  'shift_id',current_setting('test.v52c.shift'),'nurse_id',current_setting('test.v52c.nurse_id'),'payments',jsonb_build_object('cash',10)),gen_random_uuid());
 failed_n:=false;begin perform public.crm_sale_cancel_v52(p,gen_random_uuid());
 exception when serialization_failure then failed_n:=true;end;
 perform pg_temp.v52c_assert(failed_n,'A receipt arriving after preview must invalidate cancellation CAS');
 failed_n:=false;begin perform public.crm_sale_cancel_v52(current_setting('test.v52c.stale_payload')::jsonb,gen_random_uuid());
 exception when serialization_failure then failed_n:=true;end;
 perform pg_temp.v52c_assert(failed_n,'An intervening composition edit must invalidate cancellation CAS');
 failed_n:=false;begin perform public.crm_sale_cancel_v52(current_setting('test.v52c.cancel_payload')::jsonb||'{"confirmed_duplicate":false}',gen_random_uuid());
 exception when invalid_parameter_value then failed_n:=true;end;
 perform pg_temp.v52c_assert(failed_n,'Deletion requires explicit duplicate confirmation');
 failed_n:=false;begin perform public.crm_sale_cancel_v52(current_setting('test.v52c.cancel_payload')::jsonb||'{"reason":""}',gen_random_uuid());
 exception when invalid_parameter_value then failed_n:=true;end;
 perform pg_temp.v52c_assert(failed_n,'Deletion requires an audit reason');
end $$;
reset role;
-- Same administrative API is denied to a nurse and an inactive administrator.
select pg_temp.v52c_actor('nurse');
set local role authenticated;
do $$declare rejected_n boolean:=false;begin
 begin perform public.crm_sale_cancel_v52(current_setting('test.v52c.cancel_payload')::jsonb,gen_random_uuid());
 exception when insufficient_privilege then rejected_n:=true;end;
 perform pg_temp.v52c_assert(rejected_n,'Nurse deleted a sale');
end $$;
reset role;
select pg_temp.v52c_actor('inactive');
set local role authenticated;
do $$declare rejected_n boolean:=false;begin
 begin perform public.crm_sale_cancel_v52(current_setting('test.v52c.cancel_payload')::jsonb,gen_random_uuid());
 exception when insufficient_privilege then rejected_n:=true;end;
 perform pg_temp.v52c_assert(rejected_n,'Inactive manager deleted a sale');
end $$;
reset role;
select pg_temp.v52c_actor('admin');
-- Snapshot exact money and preserved bill/details before canceling a CLOSED
-- shift. Cash counts remain immutable. Before v53 the mixed account becomes
-- stale; with separate sales, cancellation must leave procedure cash current.
select set_config('test.v52c.money_before',(select jsonb_build_object('allocations',
 (select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a join public.sales p on p.id=a.sale_id where p.shift_id=current_setting('test.v52c.shift')::uuid),
 'receipts',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r where r.shift_id=current_setting('test.v52c.shift')::uuid))::text),true);
select set_config('test.v52c.original_bill',(select to_jsonb(p)::text from public.sales p where id=current_setting('test.v52c.duplicate')::uuid),true);
select set_config('test.v52c.original_details',(select jsonb_agg(to_jsonb(d) order by medication_id)::text from public.sale_items d where sale_id=current_setting('test.v52c.duplicate')::uuid),true);
select set_config('test.v52c.report_before',private.crm_build_shift_report_v5(current_setting('test.v52c.shift')::uuid)::text,true);
set local role authenticated;
do $$declare a jsonb;answer_n jsonb;req uuid:=gen_random_uuid();failed_n boolean;
begin
 a:=public.crm_cash_reconciliation_v37('status',jsonb_build_object('shift_id',current_setting('test.v52c.shift')));
 a:=public.crm_cash_reconciliation_v37('save',jsonb_build_object('shift_id',current_setting('test.v52c.shift'),
  'expected_token',a->'reconciliation_v37'->>'token','counted_cash',case when a->'sales_separate'='true'::jsonb then 0 else 35 end,'salary_confirmed',false,
  'opening_amount',0,'reason','TEST unchanged money before duplicate deletion v52'),gen_random_uuid());
 perform set_config('test.v52c.cash_count_before',(a->'reconciliation_v37'->'count')::text,true);
 perform set_config('test.v52c.cash_token_before',a->'reconciliation_v37'->>'token',true);
 perform public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v52c.shift')));
 answer_n:=public.crm_sale_cancel_v52(current_setting('test.v52c.cancel_payload')::jsonb,req);
 perform pg_temp.v52c_assert(answer_n=public.crm_sale_cancel_v52(current_setting('test.v52c.cancel_payload')::jsonb,req),
  'Completed retry must return exactly once after the sale is hidden');
 perform pg_temp.v52c_assert((answer_n->>'cancelled')::boolean and(answer_n->'returned_stock'->0->>'quantity')::numeric=2,
  'Cancellation returned original 3 instead of net 2 consumed units');
 perform set_config('test.v52c.cancel_request',req::text,true);
 failed_n:=false;begin perform public.crm_sale_cancel_v52(current_setting('test.v52c.cancel_payload')::jsonb||'{"reason":"different"}',req);
 exception when invalid_parameter_value then failed_n:=true;end;
 perform pg_temp.v52c_assert(failed_n,'Completed request accepted changed payload');
 failed_n:=false;begin perform public.crm_sale_cancel_v52(current_setting('test.v52c.cancel_payload')::jsonb,gen_random_uuid());
 exception when object_not_in_prerequisite_state then failed_n:=true;end;
 perform pg_temp.v52c_assert(failed_n,'A second UUID returned stock twice');
 failed_n:=false;begin perform public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v52c.duplicate')));
 exception when object_not_in_prerequisite_state then failed_n:=true;end;
 perform pg_temp.v52c_assert(failed_n,'Canceled sale remained available for edit/repeat/payment');
 a:=public.crm_clinical_v10('patient_treatments',jsonb_build_object('patient_id',current_setting('test.v52c.patient')));
 perform pg_temp.v52c_assert(jsonb_array_length(a->'sales')=0,'Canceled sale remained in full patient history');
 a:=public.patient_history_v8(current_setting('test.v52c.patient')::uuid);
 perform pg_temp.v52c_assert(jsonb_array_length(a->'sales')=0,'Canceled sale remained in compact patient history');
 a:=public.crm_clinical_v10('debts',jsonb_build_object('patient_id',current_setting('test.v52c.patient')));
 perform pg_temp.v52c_assert(jsonb_array_length(a->'debts')=0 and(a->>'pending_total')::numeric=0,'Canceled bill remained in debt/pending totals');
 a:=public.crm_finance_v5('summary',jsonb_build_object('patient_id',current_setting('test.v52c.patient')));
 perform pg_temp.v52c_assert((a->>'sales_count')::integer=0 and(a->>'charge_total')::numeric=0,'Canceled bill remained in period totals');
end $$;
reset role;
do $$declare a jsonb;b jsonb;money_n jsonb;rejected_n boolean:=false;
begin
 a:=private.crm_build_shift_report_v5(current_setting('test.v52c.shift')::uuid);b:=current_setting('test.v52c.report_before')::jsonb;
 perform pg_temp.v52c_assert((a->>'sales_count')::integer=(b->>'sales_count')::integer-1
  and(a->>'patients_count')::integer=(b->>'patients_count')::integer,'Shift patients/sales still include duplicate');
 if a->'sales_separate'='true'::jsonb then
  perform pg_temp.v52c_assert(a->'charge_total'=b->'charge_total'
   and(a->'sales_summary'->>'sales_count')::integer=(b->'sales_summary'->>'sales_count')::integer-1
   and(a->'sales_summary'->>'charge_total')::numeric=(b->'sales_summary'->>'charge_total')::numeric-200
   and(a->'sales_summary'->>'pending_total')::numeric=(b->'sales_summary'->>'pending_total')::numeric-200,
   'Canceled sale remained in its separate charge/pending account or changed procedure charges');
  perform pg_temp.v52c_assert(a->'sales_summary'->'revenue'=b->'sales_summary'->'revenue',
   'Unpaid sale cancellation changed separate sale receipts');
 else
  perform pg_temp.v52c_assert((a->>'charge_total')::numeric=(b->>'charge_total')::numeric-200,
   'Shift charge still includes duplicate');
 end if;
 perform pg_temp.v52c_assert(a->'revenue'=b->'revenue','Unpaid anonymous sale cancellation changed received money');
 perform pg_temp.v52c_assert(a->'cash_drawer'->'reconciliation_v37'->'count'=current_setting('test.v52c.cash_count_before')::jsonb,
  'Cancellation rewrote the saved cash count');
 if a->'sales_separate'='true'::jsonb then
  perform pg_temp.v52c_assert((a->'cash_drawer'->>'received_cash')::numeric=0
   and(a->'cash_drawer'->'reconciliation_v37'->>'stale')::boolean=false
   and a->'cash_drawer'->'reconciliation_v37'->>'token'=current_setting('test.v52c.cash_token_before'),
   'Separate sale cancellation changed procedure cash or invalidated its cash count');
 else
  perform pg_temp.v52c_assert((a->'cash_drawer'->>'received_cash')::numeric=35
   and(a->'cash_drawer'->'reconciliation_v37'->>'stale')::boolean,'Cash changed or old cash count was not marked stale');
 end if;
 perform pg_temp.v52c_assert(not exists(select 1 from jsonb_array_elements((select report->'sales' from private.crm_shift_reports where shift_id=current_setting('test.v52c.shift')::uuid)) x where x->>'id'=current_setting('test.v52c.duplicate')),'Closed cached report retained canceled row');
 perform pg_temp.v52c_assert((select to_jsonb(p) from public.sales p where id=current_setting('test.v52c.duplicate')::uuid)=current_setting('test.v52c.original_bill')::jsonb
  and(select jsonb_agg(to_jsonb(d) order by medication_id) from public.sale_items d where sale_id=current_setting('test.v52c.duplicate')::uuid)=current_setting('test.v52c.original_details')::jsonb,'Cancellation destroyed original bill/details');
 perform pg_temp.v52c_assert((select quantity from public.stock where medication_id=current_setting('test.v52c.med')::uuid and location='work')=97
  and(select quantity_remaining from public.medication_batches where id=current_setting('test.v52c.batch')::uuid)=97,'Batch-exact net return did not preserve other sale consumption');
 select jsonb_build_object('allocations',(select jsonb_agg(to_jsonb(x) order by x.id) from private.crm_payment_allocations x join public.sales p on p.id=x.sale_id where p.shift_id=current_setting('test.v52c.shift')::uuid),
  'receipts',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r where r.shift_id=current_setting('test.v52c.shift')::uuid)) into money_n;
 perform pg_temp.v52c_assert(money_n=current_setting('test.v52c.money_before')::jsonb,'Cancellation altered allocation/receipt metadata or money');
 begin update public.sales set notes='TEST forbidden stale edit' where id=current_setting('test.v52c.duplicate')::uuid;
 exception when object_not_in_prerequisite_state then rejected_n:=true;end;
 perform pg_temp.v52c_assert(rejected_n,'A stale internal update mutated a canceled sale');
 perform pg_temp.v52c_assert((select count(*) from private.crm_audit_log where entity_id=current_setting('test.v52c.duplicate') and action='sale_cancelled_v52')=1,'Cancellation audit/retry duplicated');
end $$;
-- Gradual inventory: one real unit and two unresolved units. Only the real
-- unit returns; unresolved demand disappears without inventing two ampoules.
update private.crm_finance_settings set payment_only=true,partial_stock=true where id;
select pg_temp.v52c_actor('owner');
set local role authenticated;
do $$declare a jsonb;p jsonb;answer_n jsonb;
begin
 a:=public.record_treatment_v5('sale',jsonb_build_object('shift_id',current_setting('test.v52c.partial_shift'),
  'nurse_id',current_setting('test.v52c.nurse_id'),'patient_id',current_setting('test.v52c.patient'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v52c.partial_med'),'quantity',3)),
  'charge_total',300,'payment_status','debt','payments','{}'::jsonb,'expected_stock_deducted',false,'expected_partial_stock',true),gen_random_uuid());
 perform pg_temp.v52c_assert((a->'stock_summary'->>'deducted_quantity')::numeric=1
  and(a->'stock_summary'->>'pending_quantity')::numeric=2,'Gradual fixture must consume one and defer two');
 perform set_config('test.v52c.partial_sale',a->>'id',true);
 answer_n:=public.crm_sale_cancel_v52(pg_temp.v52c_payload(a),gen_random_uuid());
 perform pg_temp.v52c_assert((answer_n->'returned_stock'->0->>'quantity')::numeric=1,'Unresolved units were returned as real stock');
 a:=public.crm_clinical_v10('debts',jsonb_build_object('patient_id',current_setting('test.v52c.patient')));
 perform pg_temp.v52c_assert(jsonb_array_length(a->'debts')=0,'Canceled genuine-debt bill remained in debt list');
end $$;
reset role;
do $$begin
 perform pg_temp.v52c_assert(not exists(select 1 from private.crm_partial_stock_lines_v28 where kind='sale' and record_id=current_setting('test.v52c.partial_sale')::uuid)
  and exists(select 1 from private.crm_partial_stock_records_v28 where kind='sale' and record_id=current_setting('test.v52c.partial_sale')::uuid),'Partial pending demand not cleared or original tracking marker destroyed');
 perform pg_temp.v52c_assert((select quantity from public.stock where medication_id=current_setting('test.v52c.partial_med')::uuid and location='work')=1,'Gradual return manufactured units');
 perform pg_temp.v52c_assert((select count(*) from private.crm_cancelled_sales_v52 where sale_id in(current_setting('test.v52c.duplicate')::uuid,current_setting('test.v52c.partial_sale')::uuid))=2,'Manager and owner cancellation not persisted');
end $$;

update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
select pg_temp.v52c_actor('owner');
set local role authenticated;
do $$declare a jsonb;result_n jsonb;remaining_n jsonb;begin
 a:=public.record_treatment_v5('sale',jsonb_build_object('shift_id',current_setting('test.v52c.partial_shift'),
  'nurse_id',current_setting('test.v52c.nurse_id'),'patient_id',null,
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v52c.med'),'quantity',1)),
  'charge_total',100,'payment_status','debt','payments','{}'::jsonb,'expected_stock_deducted',false,'expected_partial_stock',false),gen_random_uuid());
 perform pg_temp.v52c_assert(a->>'patient_id' is null and(a->>'debt_total')::numeric=100,'Anonymous genuine-debt fixture invalid');
 result_n:=public.crm_sale_cancel_v52(pg_temp.v52c_payload(a),gen_random_uuid());
 perform pg_temp.v52c_assert(result_n->'returned_stock'='[]'::jsonb,'Payment-only cancellation manufactured stock');
 remaining_n:=public.crm_clinical_v10('debts','{}'::jsonb);
 perform pg_temp.v52c_assert(not exists(select 1 from jsonb_array_elements(remaining_n->'debts') r where r->>'id'=a->>'id'),
  'Cancelled anonymous true debt remains in debt list');
end $$;
reset role;

do $$declare backup_n jsonb;failed_n boolean:=false;begin
 backup_n:=private.crm_backup_data_v5();
 perform pg_temp.v52c_assert(backup_n->'tables' ? 'private.crm_cancelled_sales_v52'
  and backup_n->'tables' ? 'private.crm_cancelled_procedures_v51','Backup omits cancellation archive');
 perform pg_temp.v52c_assert(exists(select 1 from jsonb_array_elements(backup_n->'tables'->'public.sales') r
  where r->>'id'=current_setting('test.v52c.duplicate')),'Backup lost original cancelled raw sale');
 perform pg_temp.v52c_assert(exists(select 1 from jsonb_array_elements(backup_n->'tables'->'private.crm_cancelled_sales_v52') r
  where r->>'sale_id'=current_setting('test.v52c.duplicate')),'Backup lost sale cancellation marker');
end $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$declare denied_n boolean:=false;begin
 begin perform public.crm_sale_cancel_v52(current_setting('test.v52c.cancel_payload')::jsonb,gen_random_uuid());
 exception when insufficient_privilege then denied_n:=true;end;
 perform pg_temp.v52c_assert(denied_n,'Anonymous caller can cancel sale');
end $$;
reset role;
select 'crm_sale_cancel_v52' as passed_suite;
rollback;
