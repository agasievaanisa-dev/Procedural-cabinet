-- Run after crm-partial-stock-v28.sql on the local integration database.
-- Every identity, visit, receipt, warehouse movement and setting rolls back.
-- Existing clinical rows are snapshotted to detect accidental historical edits.
begin;
create temporary table v28_existing_patients as select id,to_jsonb(p) original from public.patients p;
create temporary table v28_existing_procedures as select id,to_jsonb(p) original from public.procedures p;
create temporary table v28_existing_sales as select id,to_jsonb(p) original from public.sales p;

do $$declare u uuid:=gen_random_uuid();n uuid:=gen_random_uuid();o uuid:=gen_random_uuid();
 os uuid;ns uuid;outs uuid;sh uuid;foreign_sh uuid;pt uuid;sv uuid;m uuid;b uuid;
begin
 insert into auth.users(id,email) values(u,u::text||'@partial-v28.example.invalid'),
  (n,n::text||'@partial-v28.example.invalid'),(o,o::text||'@partial-v28.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST partial stock owner v28','owner',true,u) returning id into os;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST partial stock nurse v28','nurse',true,n) returning id into ns;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST partial stock outside nurse v28','nurse',true,o) returning id into outs;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-11-28',timestamptz '2096-11-28 08:30+03',timestamptz '2096-11-28 16:00+03','open') returning id into sh;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-11-29',timestamptz '2096-11-29 08:30+03',timestamptz '2096-11-29 16:00+03','open') returning id into foreign_sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,ns),(foreign_sh,outs);
 insert into public.patients(full_name) values('TEST partial stock synthetic patient v28') returning id into pt;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST partial stock synthetic service v28',50,0,true) returning id into sv;
 perform set_config('test.v28.owner',u::text,true);perform set_config('test.v28.nurse',n::text,true);
 perform set_config('test.v28.outsider',o::text,true);perform set_config('test.v28.nurse_staff',ns::text,true);
 perform set_config('test.v28.shift',sh::text,true);perform set_config('test.v28.foreign_shift',foreign_sh::text,true);
 perform set_config('test.v28.patient',pt::text,true);perform set_config('test.v28.service',sv::text,true);
 -- Work FEFO has two dated batches and a separate, later reserve batch.
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST partial FEFO v28','амп.',10,0,100,0,0) returning id into m;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(m,3,3,3,11,current_date+40) returning id into b;
 perform set_config('test.v28.early_batch',b::text,true);
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(m,2,2,2,17,current_date+80) returning id into b;
 perform set_config('test.v28.late_batch',b::text,true);
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(m,4,4,0,23,current_date+120);
 insert into public.stock(medication_id,location,quantity) values(m,'work',5),(m,'reserve',4);
 perform set_config('test.v28.known',m::text,true);
 -- Auto-transfer must move only the shortage, never a whole package.
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST partial reserve refill v28','амп.',10,0,100,0,0) returning id into m;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(m,5,5,1,19,current_date+90) returning id into b;
 insert into public.stock(medication_id,location,quantity) values(m,'work',1),(m,'reserve',4);
 perform set_config('test.v28.auto',m::text,true);perform set_config('test.v28.auto_batch',b::text,true);
 -- Pending lines are not fabricated as physical stock or silently dropped.
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST partial unknown expiry v28','амп.',10,0,100,0,0) returning id into m;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(m,7,7,7,null,null);
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(m,4,4,0,null,null);
 insert into public.stock(medication_id,location,quantity) values(m,'work',7),(m,'reserve',4);
 perform set_config('test.v28.unknown',m::text,true);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST partial expired v28','амп.',10,0,100,0,0) returning id into m;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(m,6,6,6,13,current_date-1);
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(m,3,3,0,13,current_date-1);
 insert into public.stock(medication_id,location,quantity) values(m,'work',6),(m,'reserve',3);
 perform set_config('test.v28.expired',m::text,true);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST partial no stock entered v28','амп.',10,0,100,0,0) returning id into m;
 insert into public.stock(medication_id,location,quantity) values(m,'work',0),(m,'reserve',0);
 perform set_config('test.v28.untracked',m::text,true);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST partial shortage v28','амп.',10,0,100,0,0) returning id into m;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(m,2,2,2,31,current_date+60) returning id into b;
 insert into public.stock(medication_id,location,quantity) values(m,'work',2),(m,'reserve',0);
 perform set_config('test.v28.short',m::text,true);perform set_config('test.v28.short_batch',b::text,true);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST partial legacy mode v28','амп.',10,0,100,0,0) returning id into m;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(m,20,20,20,41,current_date+180);
 insert into public.stock(medication_id,location,quantity) values(m,'work',20),(m,'reserve',0);
 perform set_config('test.v28.legacy',m::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 update private.crm_finance_settings set payment_only=true where id;
end $$;

-- Helpers construct requests, not warehouse effects. Endpoints below run as
-- authenticated users, and independent SQL checks inspect actual batch changes.
create function pg_temp.v28_items(k text,q integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v28.'||k),'quantity',q))
$$;
create function pg_temp.v28_sale(items_n jsonb) returns jsonb language sql as $$
 select jsonb_build_object('shift_id',current_setting('test.v28.shift'),'nurse_id',current_setting('test.v28.nurse_staff'),
  'items',items_n,'charge_total',(select sum((x->>'quantity')::numeric*100) from jsonb_array_elements(items_n)x),
  'paid_total',0,'payment_status','debt',
  'expected_stock_deducted',false,'payments',jsonb_build_object('cash',0),'notes','TEST partial stock v28')
$$;
create function pg_temp.v28_edit(a jsonb,items_n jsonb) returns jsonb language sql as $$
 select pg_temp.v28_sale(items_n)||jsonb_build_object('kind',a->>'kind','id',a->>'id','expected_version',a->'version',
  'edit_reason','TEST partial stock v28 edit','payment_status','debt')
$$;

set local role authenticated;
do $$declare a jsonb;p jsonb;begin
 perform public.crm_partial_stock_v28('mode_set','{"enabled":false}',gen_random_uuid());
 p:=pg_temp.v28_sale(pg_temp.v28_items('legacy',1))||'{"expected_partial_stock":true}';
 begin perform public.record_treatment_v5('sale',p,gen_random_uuid());raise exception 'Stale partial-mode form accepted after accounting mode changed';
 exception when others then if sqlerrm<>'Режим учёта изменён. Обновите форму' then raise;end if;end;
 -- Opening old payment-only rows before enabling partial accounting must not
 -- retrospectively consume stock, including when subsequently edited.
 p:=pg_temp.v28_sale(pg_temp.v28_items('legacy',2));
 a:=public.record_treatment_v5('sale',p,gen_random_uuid());
 perform set_config('test.v28.legacy_sale',a->>'id',true);
 p:=p||jsonb_build_object('payment_status','paid','paid_total',200,'payments',jsonb_build_object('cash',200));
 a:=public.record_treatment_v5('sale',p,gen_random_uuid());
 perform set_config('test.v28.legacy_paid_sale',a->>'id',true);
 a:=public.crm_partial_stock_v28('mode_set','{"enabled":true}',gen_random_uuid());
 a:=public.crm_partial_stock_v28('status');
 if a->'partial_stock' is distinct from 'true'::jsonb or a->>'stock_mode' is distinct from 'partial' then
  raise exception 'Partial stock activation/status is incorrect: %',a;end if;
 p:=pg_temp.v28_sale(pg_temp.v28_items('legacy',1))||'{"expected_partial_stock":false}';
 begin perform public.record_treatment_v5('sale',p,gen_random_uuid());raise exception 'Stale payment-only form accepted after partial mode was enabled';
 exception when others then if sqlerrm<>'Режим учёта изменён. Обновите форму' then raise;end if;end;
 a:=public.work_catalog_v2();select x into a from jsonb_array_elements(a)x where x->>'id'=current_setting('test.v28.known');
 if (a->>'reserve_available')::numeric is distinct from 4 or (a->>'total_available')::numeric is distinct from 9 then
  raise exception 'Manager catalogue lost available reserve/total quantities';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v28.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v28.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid:=gen_random_uuid();bad jsonb;
begin
 a:=public.crm_partial_stock_v28('status');
 if a->>'stock_mode' is distinct from 'partial' or a?'medications' or a?'pending_rows' then raise exception 'Nurse status contract leaks warehouse details: %',a;end if;
 a:=public.work_catalog_v2();
 if exists(select 1 from jsonb_array_elements(a)x where x ?| array['reserve_available','total_available','reserve_qty','purchase_price','purchase_price_per_unit']) then
  raise exception 'Nurse catalogue leaked reserve stock or purchase costs';end if;
 if not exists(select 1 from jsonb_array_elements(a)x where x->>'id'=current_setting('test.v28.unknown') and(x->>'unknown_expiry_qty')::numeric=7)
  or not exists(select 1 from jsonb_array_elements(a)x where x->>'id'=current_setting('test.v28.expired') and(x->>'expired_qty')::numeric=6) then
  raise exception 'Nurse catalogue exposed reserve quantities via unknown/expired counters';end if;
 a:=public.crm_partial_stock_v28('medications');
 if exists(select 1 from jsonb_array_elements(a)x where x ?| array['reserve_available','total_available','reserve_qty','purchase_price','purchase_price_per_unit']) then
  raise exception 'Nurse partial medications endpoint leaked reserve stock or purchase costs';end if;
 -- Save a mixed-price-list sale, including medicines not entered into stock.
 p:=pg_temp.v28_sale(pg_temp.v28_items('known',4)||pg_temp.v28_items('untracked',3)||pg_temp.v28_items('unknown',2)||pg_temp.v28_items('expired',2))||'{"expected_partial_stock":true}';
 a:=public.record_treatment_v5('sale',p,req);
 if (a->>'charge_total')::numeric is distinct from 1100 or (a->>'debt_total')::numeric is distinct from 1100 or (a->>'received_total')::numeric is distinct from 0
  or a->>'stock_mode' is distinct from 'partial' or (a->'stock_summary'->>'requested_quantity')::numeric is distinct from 11
  or (a->'stock_summary'->>'deducted_quantity')::numeric is distinct from 4 or (a->'stock_summary'->>'pending_quantity')::numeric is distinct from 7 then
  raise exception 'Mixed partial-stock sale changed money or omitted pending quantities: %',a;end if;
 if public.record_treatment_v5('sale',p,req) is distinct from a then raise exception 'Partial create retry changed result';end if;
 begin perform public.record_treatment_v5('sale',p||jsonb_build_object('notes','different payload'),req);
  raise exception 'Changed payload accepted for an existing partial request';
 exception when others then if sqlerrm<>'Номер операции уже использован' then raise;end if;end;
 perform set_config('test.v28.mixed_sale',a->>'id',true);perform set_config('test.v28.mixed_create_request',req::text,true);
 perform set_config('test.v28.mixed_create_payload',p::text,true);perform set_config('test.v28.mixed_create_response',a::text,true);
 -- A shortage must save the financial record and account for the exact balance.
 p:=pg_temp.v28_sale(pg_temp.v28_items('short',5));a:=public.record_treatment_v5('sale',p,gen_random_uuid());
 if (a->'stock_summary'->>'deducted_quantity')::numeric is distinct from 2 or (a->'stock_summary'->>'pending_quantity')::numeric is distinct from 3
  or (a->>'debt_total')::numeric is distinct from 500 then raise exception 'Shortage did not save as 2 deducted plus 3 pending: %',a;end if;
 perform set_config('test.v28.short_sale',a->>'id',true);
 -- Reserve replenishment is automatic for an ordinary nurse's treatment.
 p:=pg_temp.v28_sale(pg_temp.v28_items('auto',3));a:=public.record_treatment_v5('sale',p,gen_random_uuid());
 if (a->'stock_summary'->>'deducted_quantity')::numeric is distinct from 3 or (a->'stock_summary'->>'pending_quantity')::numeric is distinct from 0 then
  raise exception 'Valid reserve stock did not replenish the work cabinet';end if;
 perform set_config('test.v28.auto_sale',a->>'id',true);
 -- Procedures use the same line accounting; own medicines are never deducted.
 p:=pg_temp.v28_sale(pg_temp.v28_items('untracked',1))||jsonb_build_object('patient_id',current_setting('test.v28.patient'),
  'service_id',current_setting('test.v28.service'),'charge_total',150,
  'own_medications',jsonb_build_array(jsonb_build_object('name','TEST patient own vial','quantity',3,'unit','фл.','source','patient')));
 a:=public.record_treatment_v5('procedure',p,gen_random_uuid());
 if (a->>'charge_total')::numeric is distinct from 150 or (a->'stock_summary'->>'requested_quantity')::numeric is distinct from 1
  or (a->'stock_summary'->>'pending_quantity')::numeric is distinct from 1 or jsonb_array_length(a->'own_medications')<>1 then
  raise exception 'Partial procedure counted own medicines or lost patient bill: %',a;end if;
 perform set_config('test.v28.procedure',a->>'id',true);
 p:=pg_temp.v28_edit(a||'{"kind":"procedure"}',pg_temp.v28_items('untracked',1))||jsonb_build_object('charge_total',150,'services',a->'services','own_medications',a->'own_medications');
 req:=gen_random_uuid();a:=public.crm_clinical_v10('treatment_edit',p,req);
 perform set_config('test.v28.patient_edit_request',req::text,true);perform set_config('test.v28.patient_edit_payload',p::text,true);
 foreach bad in array array['{"enabled":false}'::jsonb,'{"enabled":"true"}'::jsonb] loop
  begin perform public.crm_partial_stock_v28('mode_set',bad,gen_random_uuid());raise exception 'Nurse changed partial mode';
   exception when insufficient_privilege then null;end;
 end loop;
 begin perform public.crm_partial_stock_v28('tracking_set',jsonb_build_object('id',current_setting('test.v28.known'),'enabled',false),gen_random_uuid());
  raise exception 'Nurse changed medication tracking';exception when insufficient_privilege then null;end;
 begin perform public.crm_partial_stock_v28('review_summary');raise exception 'Nurse read global stock review';exception when insufficient_privilege then null;end;
 begin perform public.crm_partial_stock_v28('review_detail');raise exception 'Nurse read global stock review details';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$declare med_n uuid;begin
 if (select work_quantity from public.medication_batches where id=current_setting('test.v28.early_batch')::uuid)<>0
  or (select work_quantity from public.medication_batches where id=current_setting('test.v28.late_batch')::uuid)<>1
  or (select quantity from public.stock where medication_id=current_setting('test.v28.known')::uuid and location='reserve')<>4 then
  raise exception 'Partial work deduction was not FEFO or prematurely consumed reserve';end if;
 if (select quantity from public.stock where medication_id=current_setting('test.v28.auto')::uuid and location='work')<>0
  or (select quantity from public.stock where medication_id=current_setting('test.v28.auto')::uuid and location='reserve')<>2
  or (select quantity_remaining from public.medication_batches where id=current_setting('test.v28.auto_batch')::uuid)<>2 then
  raise exception 'Auto replenishment moved the wrong reserve/work quantities';end if;
 if (select quantity from public.stock where medication_id=current_setting('test.v28.unknown')::uuid and location='work')<>7
  or (select quantity from public.stock where medication_id=current_setting('test.v28.expired')::uuid and location='work')<>6
  or exists(select 1 from public.stock_movements where medication_id in(current_setting('test.v28.unknown')::uuid,current_setting('test.v28.expired')::uuid,current_setting('test.v28.untracked')::uuid)) then
  raise exception 'Unknown, expired or not-entered stock was consumed or invented';end if;
 if not exists(select 1 from private.crm_partial_stock_lines_v28 where kind='sale' and record_id=current_setting('test.v28.mixed_sale')::uuid
  and medication_id=current_setting('test.v28.known')::uuid and requested_qty=4 and deducted_qty=4 and pending_qty=0)
  or not exists(select 1 from private.crm_partial_stock_lines_v28 where kind='sale' and record_id=current_setting('test.v28.mixed_sale')::uuid
  and medication_id=current_setting('test.v28.untracked')::uuid and requested_qty=3 and deducted_qty=0 and pending_qty=3)
  or not exists(select 1 from private.crm_partial_stock_lines_v28 where kind='sale' and record_id=current_setting('test.v28.mixed_sale')::uuid
  and medication_id=current_setting('test.v28.unknown')::uuid and pending_qty=2)
  or not exists(select 1 from private.crm_partial_stock_lines_v28 where kind='sale' and record_id=current_setting('test.v28.mixed_sale')::uuid
  and medication_id=current_setting('test.v28.expired')::uuid and pending_qty=2) then raise exception 'Mixed record ledger does not reconcile each individual medicine';end if;
 if not exists(select 1 from private.crm_partial_stock_tracking_v28 where medication_id=current_setting('test.v28.short')::uuid and enabled)
  or (select quantity from public.stock where medication_id=current_setting('test.v28.short')::uuid and location='work')<>0 then
  raise exception 'Depleted tracked medicine silently reverted to untracked';end if;
 foreach med_n in array array[current_setting('test.v28.known')::uuid,current_setting('test.v28.auto')::uuid,current_setting('test.v28.unknown')::uuid,
  current_setting('test.v28.expired')::uuid,current_setting('test.v28.short')::uuid] loop perform private.assert_stock_v3(med_n);end loop;
end $$;

-- Cancel pending quantities first. Only lowering below already deducted
-- quantity can return physical stock, to the original batch with original cost.
set local role authenticated;
do $$declare a jsonb;p jsonb;req uuid;begin
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v28.short_sale')));
 p:=pg_temp.v28_edit(a||'{"kind":"sale"}',pg_temp.v28_items('short',4));a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if (a->'stock_summary'->>'deducted_quantity')::numeric is distinct from 2 or (a->'stock_summary'->>'pending_quantity')::numeric is distinct from 2 then raise exception 'Reduction returned physical units before cancelling pending shortage';end if;
 p:=pg_temp.v28_edit(a||'{"kind":"sale"}',pg_temp.v28_items('short',1));req:=gen_random_uuid();
 a:=public.crm_clinical_v10('treatment_edit',p,req);
 if (a->'stock_summary'->>'deducted_quantity')::numeric is distinct from 1 or (a->'stock_summary'->>'pending_quantity')::numeric is distinct from 0 then raise exception 'Shortage reduction failed to return one original unit';end if;
 if public.crm_clinical_v10('treatment_edit',p,req) is distinct from a then raise exception 'Partial return retry changed response';end if;
 perform set_config('test.v28.short_edit_request',req::text,true);perform set_config('test.v28.short_edit_payload',p::text,true);
 perform set_config('test.v28.short_edit_response',a::text,true);
 p:=pg_temp.v28_edit(a||'{"kind":"sale"}',pg_temp.v28_items('short',4));a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if (a->'stock_summary'->>'deducted_quantity')::numeric is distinct from 2 or (a->'stock_summary'->>'pending_quantity')::numeric is distinct from 2 then raise exception 'Later increase overspent previously returned stock';end if;
 -- Stale retry of an already committed edit returns its original receipt and
 -- never applies the old quantity after a subsequent edit.
 if public.crm_clinical_v10('treatment_edit',current_setting('test.v28.short_edit_payload')::jsonb,current_setting('test.v28.short_edit_request')::uuid)
  is distinct from current_setting('test.v28.short_edit_response')::jsonb then raise exception 'Stale edit replay changed historical response';end if;
 -- Legacy records (both unpaid and paid) are not retroactively deducted.
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v28.legacy_sale')));
 p:=pg_temp.v28_edit(a||'{"kind":"sale"}',pg_temp.v28_items('legacy',2));
 a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v28.legacy_paid_sale')));
 p:=pg_temp.v28_edit(a||'{"kind":"sale"}',pg_temp.v28_items('legacy',2))||'{"payment_status":"paid"}';
 a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 -- Debt payments have no warehouse effect; they only settle money received.
 p:=jsonb_build_object('kind','sale','id',current_setting('test.v28.auto_sale'),'shift_id',current_setting('test.v28.shift'),
  'nurse_id',current_setting('test.v28.nurse_staff'),'payments',jsonb_build_object('terminal',300));
 req:=gen_random_uuid();a:=public.crm_clinical_v10('debt_payment',p,req);
 if (a->>'debt_total')::numeric is distinct from 0 or (a->>'received_total')::numeric is distinct from 300 then raise exception 'Partial-stock debt collection changed payment total';end if;
 if public.crm_clinical_v10('debt_payment',p,req) is distinct from a then raise exception 'Partial-stock debt receipt retry changed response';end if;
 -- Reopen mixed record after a later edit, then replay its original create.
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v28.mixed_sale')));
 p:=pg_temp.v28_edit(a||'{"kind":"sale"}',pg_temp.v28_items('known',4)||pg_temp.v28_items('untracked',3)||pg_temp.v28_items('unknown',2)||pg_temp.v28_items('expired',2));
 a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if public.record_treatment_v5('sale',current_setting('test.v28.mixed_create_payload')::jsonb,current_setting('test.v28.mixed_create_request')::uuid)
  is distinct from current_setting('test.v28.mixed_create_response')::jsonb then raise exception 'Create replay after an edit reapplied stock';end if;
end $$;
reset role;
do $$begin
 if (select quantity from public.stock where medication_id=current_setting('test.v28.short')::uuid and location='work')<>0
  or (select work_quantity from public.medication_batches where id=current_setting('test.v28.short_batch')::uuid)<>0
  or (select purchase_price_per_unit from public.medication_batches where id=current_setting('test.v28.short_batch')::uuid)<>31 then
  raise exception 'Edit/retry returned the wrong batch or changed original cost';end if;
 if (select quantity from public.stock where medication_id=current_setting('test.v28.legacy')::uuid and location='work')<>20
  or exists(select 1 from private.crm_partial_stock_records_v28 where kind='sale' and record_id in(current_setting('test.v28.legacy_sale')::uuid,current_setting('test.v28.legacy_paid_sale')::uuid)) then
  raise exception 'Enabling partial stock retroactively consumed a legacy record';end if;
 if (select quantity from public.stock where medication_id=current_setting('test.v28.auto')::uuid and location='reserve')<>2
  or (select quantity from public.stock where medication_id=current_setting('test.v28.auto')::uuid and location='work')<>0 then raise exception 'Debt collection deducted stock again';end if;
 if (select sum(quantity) from public.stock_movements where sale_id=current_setting('test.v28.auto_sale')::uuid and movement_type='sale')<>3
  or (select count(*) from private.crm_receipts_v10 where sale_id=current_setting('test.v28.auto_sale')::uuid)<>1
  or (select sum(quantity) from public.stock_movements where sale_id=current_setting('test.v28.mixed_sale')::uuid and movement_type='sale')<>4 then
  raise exception 'Create/edit/receipt retries duplicated a movement or payment receipt';end if;
 if (select sum(r.quantity) from private.crm_stock_returns_v10 r join public.stock_movements m on m.id=r.movement_id
  where m.sale_id=current_setting('test.v28.short_sale')::uuid)<>1 then raise exception 'A shortage edit retry returned an original unit more than once';end if;
end $$;

-- A later stock entry automatically starts tracking that medicine, while old
-- pending lines remain reviewable rather than being silently charged to it.
select set_config('request.jwt.claim.sub',current_setting('test.v28.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v28.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.warehouse_v5('opening',jsonb_build_object('id',current_setting('test.v28.untracked'),'quantity',6,'location','work',
  'expiry',(current_date+140)::text,'price',0,'comment','TEST first stock entry v28'),gen_random_uuid());
 a:=public.crm_partial_stock_v28('review_summary');
 if (a->>'pending_quantity')::numeric<10 then raise exception 'Manager review dropped previously pending quantities: %',a;end if;
 a:=public.crm_partial_stock_v28('review_detail',jsonb_build_object('id',current_setting('test.v28.untracked')));
 if a::text like '%TEST partial stock synthetic patient%' then raise exception 'Warehouse review unexpectedly contains patient identity';end if;
end $$;
reset role;
do $$begin
 if not exists(select 1 from private.crm_partial_stock_tracking_v28 where medication_id=current_setting('test.v28.untracked')::uuid and enabled) then raise exception 'Opening stock did not auto-enable tracking';end if;
 if (select quantity from public.stock where medication_id=current_setting('test.v28.untracked')::uuid and location='work')<>6 then raise exception 'Arrival retroactively consumed pending history';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.v28.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v28.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;p jsonb;begin
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v28.mixed_sale')));
 p:=pg_temp.v28_edit(a||'{"kind":"sale"}',pg_temp.v28_items('known',4)||pg_temp.v28_items('untracked',3)||pg_temp.v28_items('unknown',2)||pg_temp.v28_items('expired',2));
 a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if (a->'stock_summary'->>'pending_quantity')::numeric is distinct from 7 then raise exception 'Unchanged edit silently reconciled an old pending line after stock arrival';end if;
 a:=public.record_treatment_v5('sale',pg_temp.v28_sale(pg_temp.v28_items('untracked',2)),gen_random_uuid());
 if (a->'stock_summary'->>'deducted_quantity')::numeric is distinct from 2 or (a->'stock_summary'->>'pending_quantity')::numeric is distinct from 0 then raise exception 'New sale did not use newly entered stock';end if;
end $$;
reset role;
do $$begin
 if (select quantity from public.stock where medication_id=current_setting('test.v28.untracked')::uuid and location='work')<>4 then raise exception 'First stock arrival/edit/new sale did not reconcile to four actual units';end if;
end $$;

-- Manager pauses survive later arrivals, and mode toggles never rewrite
-- previous line ledgers. Malformed booleans cannot change settings.
select set_config('request.jwt.claim.sub',current_setting('test.v28.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v28.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;bad jsonb;failed boolean;begin
 perform public.crm_partial_stock_v28('tracking_set',jsonb_build_object('id',current_setting('test.v28.untracked'),'enabled',false,'reason','TEST manager pause'),gen_random_uuid());
 perform public.warehouse_v5('opening',jsonb_build_object('id',current_setting('test.v28.untracked'),'quantity',1,'location','reserve',
  'expiry',(current_date+150)::text,'price',0,'comment','TEST arrival after manager pause'),gen_random_uuid());
 a:=public.record_treatment_v5('sale',pg_temp.v28_sale(pg_temp.v28_items('untracked',1)),gen_random_uuid());
 if (a->'stock_summary'->>'pending_quantity')::numeric is distinct from 1 or (a->'stock_summary'->>'deducted_quantity')::numeric is distinct from 0 then raise exception 'Automatic arrival overrode a manager tracking pause';end if;
 foreach bad in array array['{"enabled":"true"}'::jsonb,'{"enabled":null}'::jsonb,'{"enabled":1}'::jsonb] loop
  failed:=false;begin perform public.crm_partial_stock_v28('mode_set',bad,gen_random_uuid());exception when others then failed:=true;end;
  if not failed then raise exception 'Malformed partial-stock mode was accepted: %',bad;end if;
 end loop;
 a:=public.crm_partial_stock_v28('mode_set','{"enabled":false}',gen_random_uuid());
 a:=public.crm_partial_stock_v28('mode_set','{"enabled":true}',gen_random_uuid());
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v28.shift')));
 -- v29 excludes the 300 true-debt repayment from ordinary shift income.
 if (a->'revenue'->>'total')::numeric is distinct from 200 or (a->>'charge_total')::numeric is distinct from 2650 or (a->>'debt_total')::numeric is distinct from 2150
  or (a->>'partial_stock_pending_quantity')::numeric is distinct from 11 or (a->>'partial_stock_sales_count')::integer is distinct from 5
  or (a->>'partial_stock_procedures_count')::integer is distinct from 1 then raise exception 'Partial-stock shift report changed money, debt or operation counts: %',a;end if;
 if (select coalesce(sum((x->>'quantity')::numeric),0) from jsonb_array_elements(a->'used')x)<>11 then
  raise exception 'Manager shift usage report omits actual partial-stock deductions: %',a->'used';end if;
end $$;
reset role;
do $$begin
 if exists(select 1 from private.crm_partial_stock_tracking_v28 where medication_id=current_setting('test.v28.untracked')::uuid and enabled)
  or (select quantity from public.stock where medication_id=current_setting('test.v28.untracked')::uuid and location='work')<>4
  or (select quantity from public.stock where medication_id=current_setting('test.v28.untracked')::uuid and location='reserve')<>1 then
  raise exception 'Manual pause or mode toggle changed physical stock';end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.v28.outsider'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v28.outsider'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare p jsonb;a jsonb;begin
 p:=pg_temp.v28_sale(pg_temp.v28_items('known',1));
 begin perform public.record_treatment_v5('sale',p,gen_random_uuid());raise exception 'Outside nurse saved a partial-stock sale in another shift';
  exception when others then if sqlerrm<>'Нет доступа к этой смене' then raise;end if;end;
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v28.mixed_sale')));
 p:=pg_temp.v28_edit(a||'{"kind":"sale"}',pg_temp.v28_items('known',1));
 begin perform public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());raise exception 'Outside nurse edited another shift partial-stock record';
  exception when others then if sqlerrm<>'Редактировать можно записи своей открытой смены. Другие записи исправляет владелец' then raise;end if;end;
end $$;
reset role;
set local role anon;
do $$begin
 begin perform public.crm_partial_stock_v28('status');raise exception 'Anonymous stock status access';exception when insufficient_privilege then null;end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v28.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v28.owner'),'role','authenticated')::text,true);
-- Closing a shift freezes its warehouse and payroll snapshots. A manager can
-- still correct an earlier medicine line: its actual return, debt and usage
-- must refresh without rewriting received money or those frozen snapshots.
set local role authenticated;
do $$declare a jsonb;p jsonb;before_n jsonb;after_n jsonb;req uuid:=gen_random_uuid();begin
 -- The current application requires a real reconciliation before closing.
 -- This synthetic drawer starts empty; no salary payout is fabricated.
 a:=public.crm_cash_reconciliation_v37('status',jsonb_build_object('shift_id',current_setting('test.v28.shift')));
 perform public.crm_cash_reconciliation_v37('save',jsonb_build_object('shift_id',current_setting('test.v28.shift'),
  'expected_token',a->'reconciliation_v37'->>'token','opening_amount',0,
  'counted_cash',(a->>'received_cash')::numeric+(a->>'cash_in')::numeric-(a->>'salary_paid')::numeric-(a->>'cash_out')::numeric,
  'salary_confirmed',false,'reason','TEST v28 fixture adapted for mandatory v37 reconciliation'),gen_random_uuid());
 a:=public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v28.shift')));
 before_n:=jsonb_build_object('stock',a->'stock','staff',a->'staff','payroll_total',a->'payroll_total',
  'payroll_complete',a->'payroll_complete','payroll_closed',a->'payroll_closed','payroll_open',a->'payroll_open',
  'payroll_unknown',a->'payroll_unknown','cash_after_salary',a->'cash_after_salary','revenue',a->'revenue','receipts',a->'receipts');
 perform set_config('test.v28.closed_snapshot',before_n::text,true);
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v28.short_sale')));
 p:=pg_temp.v28_edit(a||'{"kind":"sale"}',pg_temp.v28_items('short',1));
 a:=public.crm_clinical_v10('treatment_edit',p,req);
 if (a->'stock_summary'->>'deducted_quantity')::numeric is distinct from 1
  or (a->'stock_summary'->>'pending_quantity')::numeric is distinct from 0
  or (a->>'charge_total')::numeric is distinct from 100 then raise exception 'Manager closed-shift partial correction did not return only its originally deducted unit';end if;
 if public.crm_clinical_v10('treatment_edit',p,req) is distinct from a then raise exception 'Closed partial edit retry changed response';end if;
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v28.shift')));
 after_n:=jsonb_build_object('stock',a->'stock','staff',a->'staff','payroll_total',a->'payroll_total',
  'payroll_complete',a->'payroll_complete','payroll_closed',a->'payroll_closed','payroll_open',a->'payroll_open',
  'payroll_unknown',a->'payroll_unknown','cash_after_salary',a->'cash_after_salary','revenue',a->'revenue','receipts',a->'receipts');
 if after_n is distinct from before_n then raise exception 'Closed correction rewrote received money, payroll or frozen warehouse: before %, after %',before_n,after_n;end if;
 if (a->>'charge_total')::numeric is distinct from 2350 or (a->>'debt_total')::numeric is distinct from 1850
  or (a->>'partial_stock_pending_quantity')::numeric is distinct from 9
  or (select coalesce(sum((x->>'quantity')::numeric),0) from jsonb_array_elements(a->'used')x)<>10 then
  raise exception 'Closed report kept stale debt, used or pending quantities after manager correction: %',a;end if;
 if not exists(select 1 from jsonb_array_elements(a->'warnings')x where x->>'type'='partial_stock' and(x->>'count')::numeric=9) then
  raise exception 'Closed report kept a stale partial-stock warning';end if;
end $$;
reset role;
do $$begin
 if (select quantity from public.stock where medication_id=current_setting('test.v28.short')::uuid and location='work')<>1
  or (select work_quantity from public.medication_batches where id=current_setting('test.v28.short_batch')::uuid)<>1
  or (select purchase_price_per_unit from public.medication_batches where id=current_setting('test.v28.short_batch')::uuid)<>31 then
  raise exception 'Closed manager correction returned a wrong original batch or duplicated a return';end if;
end $$;

-- An idempotent receipt must not become a way to reopen a patient whose card
-- the administrator has since deleted. This writes only our synthetic patient.
update public.patients set deleted_at=now(),deleted_by=current_setting('test.v28.owner')::uuid where id=current_setting('test.v28.patient')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.v28.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v28.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$begin
 begin perform public.crm_clinical_v10('treatment_edit',current_setting('test.v28.patient_edit_payload')::jsonb,current_setting('test.v28.patient_edit_request')::uuid);
  raise exception 'Cached partial edit exposed a subsequently deleted patient to a nurse';
 exception when others then if sqlerrm<>'Пациент удалён. Обратитесь к владельцу' then raise;end if;end;
end $$;
reset role;

do $$declare m uuid;begin
 if exists(select 1 from v28_existing_patients b left join public.patients p using(id) where to_jsonb(p) is distinct from b.original)
  or exists(select 1 from v28_existing_procedures b left join public.procedures p using(id) where to_jsonb(p) is distinct from b.original)
  or exists(select 1 from v28_existing_sales b left join public.sales p using(id) where to_jsonb(p) is distinct from b.original) then
  raise exception 'Partial stock acceptance test changed pre-existing clinical data';end if;
 if exists(select 1 from private.crm_partial_stock_lines_v28 where requested_qty<>deducted_qty+pending_qty or deducted_qty<0 or pending_qty<0) then
  raise exception 'Partial line ledger arithmetic invariant failed';end if;
 for m in select id from public.medications where name like 'TEST partial%v28' loop perform private.assert_stock_v3(m);end loop;
end $$;
select true as partial_stock_v28_verified;
rollback;
