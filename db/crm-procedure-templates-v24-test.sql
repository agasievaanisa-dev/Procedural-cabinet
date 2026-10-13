-- Shared reusable protocols are examples: patient edits never rewrite the protocol.
-- Synthetic users, catalog rows, treatments and save receipts all roll back.
begin;

do $$declare admin_user uuid:=gen_random_uuid();owner_user uuid:=gen_random_uuid();nurse_user uuid:=gen_random_uuid();
 inactive_user uuid:=gen_random_uuid();unlinked_user uuid:=gen_random_uuid();admin_staff uuid;owner_staff uuid;nurse_staff uuid;
 shift_n uuid;patient_n uuid;service_n uuid;med_a uuid;med_b uuid;archived_med uuid;
begin
 insert into auth.users(id,email) values(admin_user,admin_user::text||'@v24.example.invalid'),
  (owner_user,owner_user::text||'@v24.example.invalid'),(nurse_user,nurse_user::text||'@v24.example.invalid'),
  (inactive_user,inactive_user::text||'@v24.example.invalid'),(unlinked_user,unlinked_user::text||'@v24.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST template administrator v24','admin',true,admin_user) returning id into admin_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST template owner v24','owner',true,owner_user) returning id into owner_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST template nurse v24','nurse',true,nurse_user) returning id into nurse_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST template inactive nurse v24','nurse',false,inactive_user);
 perform set_config('request.jwt.claim.sub',admin_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_user,'role','authenticated')::text,true);
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-10-24',timestamptz '2096-10-24 08:30+03',timestamptz '2096-10-24 16:00+03','open') returning id into shift_n;
 insert into public.shift_staff(shift_id,staff_id) values(shift_n,nurse_staff);
 insert into public.patients(full_name) values('TEST protocol patient v24') returning id into patient_n;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST protocol infusion v24',500,100,true) returning id into service_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST protocol A v24','амп.',10,100,1000,0,0) returning id into med_a;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST protocol B v24','фл.',5,100,500,0,0) returning id into med_b;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold,active)
  values('TEST protocol archived v24','амп.',10,100,200,0,0,false) returning id into archived_med;
 update private.crm_finance_settings set payment_only=true where id;
 perform set_config('test.v24.admin',admin_user::text,true);perform set_config('test.v24.owner',owner_user::text,true);
 perform set_config('test.v24.nurse',nurse_user::text,true);perform set_config('test.v24.inactive',inactive_user::text,true);
 perform set_config('test.v24.unlinked',unlinked_user::text,true);perform set_config('test.v24.nurse_staff',nurse_staff::text,true);
 perform set_config('test.v24.shift',shift_n::text,true);perform set_config('test.v24.patient',patient_n::text,true);
 perform set_config('test.v24.service',service_n::text,true);perform set_config('test.v24.med_a',med_a::text,true);
 perform set_config('test.v24.med_b',med_b::text,true);perform set_config('test.v24.archived_med',archived_med::text,true);
end $$;

-- A nurse can create a common protocol through the same replay-safe save as admin.
select set_config('request.jwt.claim.sub',current_setting('test.v24.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v24.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare p jsonb;args jsonb;a jsonb;b jsonb;req uuid:=gen_random_uuid();bad jsonb;bad_req uuid;failed_requests jsonb:='[]';route text;
begin
 p:=jsonb_build_object('name','TEST nurse common protocol v24','service_id',current_setting('test.v24.service'),
  'items',jsonb_build_array(
   jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',1,'dose','  500 мг / 5 мл  '),
   jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',1,'dose','500 мг / 5 мл'),
   jsonb_build_object('medication_id',current_setting('test.v24.med_b'),'quantity',1,'dose',null)),
  'notes','TEST reusable example, individually adjusted');
 args:=jsonb_build_object('p_action','template_save','p_payload',p);
 a:=public.crm_save_recovery_v16('crm_management_v5',args,req)->'result';
 if a->>'id' is null or jsonb_array_length(a->'items')<>2 then raise exception 'Nurse shared template create or duplicate aggregation failed';end if;
 select value into b from jsonb_array_elements(a->'items') where value->>'medication_id'=current_setting('test.v24.med_a');
 if (b->>'quantity')::numeric<>2 or b->>'dose' is distinct from '500 мг / 5 мл' then raise exception 'Template amount and dose lost on canonicalization';end if;
 select value into b from jsonb_array_elements(a->'items') where value->>'medication_id'=current_setting('test.v24.med_b');
 if b->>'dose' is not null then raise exception 'Optional template dose became fabricated';end if;
 if public.crm_save_recovery_v16('crm_management_v5',args,req)->'result' is distinct from a then raise exception 'Template save replay differs';end if;
 perform set_config('test.v24.template',a->>'id',true);perform set_config('test.v24.template_initial',a::text,true);
 perform set_config('test.v24.create_args',args::text,true);perform set_config('test.v24.create_req',req::text,true);
 b:=public.crm_management_v5('templates_list','{}');
 if not exists(select 1 from jsonb_array_elements(b) x where x->>'id'=a->>'id' and x->'items'=a->'items') then raise exception 'Nurse cannot read shared protocol';end if;
 begin
  perform public.crm_save_recovery_v16('crm_management_v5',args||jsonb_build_object('p_payload',p||jsonb_build_object('name','Changed replay')),req);
  raise exception 'Changed protocol reused request UUID';
 exception when invalid_parameter_value then null;end;
 -- Reject invalid dose types/length and invalid stock-count quantities atomically.
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('dose',123),jsonb_build_object('dose',true),jsonb_build_object('dose',jsonb_build_array('500 мг')),
  jsonb_build_object('dose',jsonb_build_object('value','500 мг')),jsonb_build_object('dose',repeat('д',201)),
  jsonb_build_object('quantity',0.5),jsonb_build_object('quantity',0),jsonb_build_object('medication_id',current_setting('test.v24.archived_med')))) loop
  bad_req:=gen_random_uuid();failed_requests:=failed_requests||to_jsonb(bad_req::text);
  begin
   perform public.crm_save_recovery_v16('crm_management_v5',jsonb_build_object('p_action','template_save',
    'p_payload',jsonb_build_object('name','TEST rejected protocol v24','service_id',current_setting('test.v24.service'),
     'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',1,'dose','500 мг')||bad))),bad_req);
   raise exception 'Invalid protocol dose/type/count accepted: %',bad;
  exception when others then if sqlerrm like 'Invalid protocol dose/type/count accepted:%' then raise;end if;end;
 end loop;
 perform set_config('test.v24.failed_template_requests',failed_requests::text,true);
 -- The new nurse permission is limited to protocols, not all owner management.
 foreach route in array array['patient_archive','service_save','staff_list','staff_save','audit_list','backup_export'] loop
  begin
   perform public.crm_management_v5(route,jsonb_build_object('id',current_setting('test.v24.patient'),'name','TEST denied v24','full_name','TEST denied v24'));
   raise exception 'Nurse gained unrelated manager action: %',route;
  exception when others then if sqlerrm like 'Nurse gained unrelated manager action:%' then raise;end if;end;
 end loop;
end $$;
reset role;
do $$begin
 if (select count(*) from private.crm_procedure_templates where id=current_setting('test.v24.template')::uuid)<>1
  or (select count(*) from private.crm_audit_log where entity_type='procedure_templates' and entity_id=current_setting('test.v24.template'))<>1 then raise exception 'Template replay duplicated row or audit';end if;
 if exists(select 1 from private.crm_procedure_templates where name='TEST rejected protocol v24')
  or exists(select 1 from private.crm_save_requests_v16 where request_id in
   (select value::uuid from jsonb_array_elements_text(current_setting('test.v24.failed_template_requests')::jsonb))) then raise exception 'Rejected template left a row or save receipt';end if;
 if has_table_privilege('authenticated','private.crm_procedure_templates','INSERT')
  or has_table_privilege('authenticated','private.crm_procedure_templates','UPDATE')
  or has_table_privilege('authenticated','private.crm_procedure_templates','DELETE')
  or has_table_privilege('anon','private.crm_procedure_templates','SELECT') then raise exception 'Protocol table exposed directly';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname like '%dose%v24%'
   and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))) then raise exception 'Private dose helper directly executable';end if;
end $$;

-- Admin can modify a nurse-created common protocol; owner can modify it as well.
select set_config('request.jwt.claim.sub',current_setting('test.v24.admin'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v24.admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.crm_management_v5('template_save',jsonb_build_object('id',current_setting('test.v24.template'),
  'name','TEST shared adjusted protocol v24','notes','TEST administrator adjusted common example'));
 if a->'items' is distinct from current_setting('test.v24.template_initial')::jsonb->'items' then raise exception 'Partial protocol edit erased doses';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v24.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v24.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.crm_management_v5('template_save',jsonb_build_object('id',current_setting('test.v24.template'),'notes','TEST owner shared example'));
 if a->>'notes' is distinct from 'TEST owner shared example' then raise exception 'Owner cannot adjust shared protocol';end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v24.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v24.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid:=gen_random_uuid();t jsonb;begin
 t:=public.crm_management_v5('template_save',jsonb_build_object('id',current_setting('test.v24.template'),'active',false));
 if (t->>'active')::boolean is distinct from false then raise exception 'Nurse cannot archive common protocol';end if;
 t:=public.crm_management_v5('template_save',jsonb_build_object('id',current_setting('test.v24.template'),'active',true));
 if (t->>'active')::boolean is distinct from true then raise exception 'Nurse cannot restore common protocol';end if;
 perform set_config('test.v24.template_applied',t::text,true);
 -- Apply the example by copying its contents to the patient's independent bill.
 p:=jsonb_build_object('patient_id',current_setting('test.v24.patient'),'shift_id',current_setting('test.v24.shift'),
  'nurse_id',current_setting('test.v24.nurse_staff'),'service_id',t->>'service_id','items',t->'items',
  'own_medications',jsonb_build_array(jsonb_build_object('name','TEST patient own vitamin v24','quantity',1,'unit','амп.','source','patient','dose','250 мг')),
  'charge_total',2800,'paid_total',0,'payment_status','pending','discount_reason','Постоянный пациент','discount_comment','TEST индивидуальная цена',
  'payments',jsonb_build_object('cash',0),'expected_stock_deducted',false,'arrival_at','2096-10-24T09:30:00+03:00');
 a:=public.record_treatment_v5('procedure',p,req);
 if (a->>'list_total')::numeric<>3100 or (a->>'charge_total')::numeric<>2800 or (a->>'debt_total')::numeric<>2800
  or a->'own_medications'->0->>'dose' is distinct from '250 мг' then raise exception 'Protocol bill/independent patient price/own dose lost';end if;
 if not exists(select 1 from jsonb_array_elements(a->'items') x where x->>'medication_id'=current_setting('test.v24.med_a')
   and (x->>'quantity')::numeric=2 and x->>'dose'='500 мг / 5 мл') then raise exception 'Applied protocol dose missing from treatment snapshot';end if;
 if public.record_treatment_v5('procedure',p,req) is distinct from a then raise exception 'Protocol treatment creation replay differs';end if;
 perform set_config('test.v24.procedure',a->>'id',true);perform set_config('test.v24.procedure_before',a::text,true);
 perform set_config('test.v24.procedure_create_payload',p::text,true);
 -- Legacy integrations still support absent dose, and a sale captures dose separately.
 a:=public.record_treatment_v5('sale',jsonb_build_object('patient_id',current_setting('test.v24.patient'),'shift_id',current_setting('test.v24.shift'),
  'nurse_id',current_setting('test.v24.nurse_staff'),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v24.med_b'),'quantity',1)),
  'charge_total',500,'paid_total',0,'payment_status','pending','payments',jsonb_build_object('cash',0),'expected_stock_deducted',false),gen_random_uuid());
 if a->'items'->0->>'dose' is not null or (a->>'list_total')::numeric<>500 then raise exception 'Legacy item without dose changed';end if;
 perform set_config('test.v24.sale',a->>'id',true);
end $$;
reset role;

create function pg_temp.v24_non_dose_state() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'procedure',(select to_jsonb(p)-array['version','updated_at','notes'] from public.procedures p where p.id=current_setting('test.v24.procedure')::uuid),
  'items',(select jsonb_agg(to_jsonb(i)-array['dose','id'] order by i.medication_id) from public.procedure_medications i where i.procedure_id=current_setting('test.v24.procedure')::uuid),
  'own',(select jsonb_agg(to_jsonb(i)-array['dose','id'] order by i.position) from private.crm_own_medications i where i.procedure_id=current_setting('test.v24.procedure')::uuid),
  'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a where a.procedure_id=current_setting('test.v24.procedure')::uuid),
  'receipts',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r where r.procedure_id=current_setting('test.v24.procedure')::uuid),
  'stock',(select jsonb_agg(to_jsonb(s) order by s.medication_id,s.location) from public.stock s where s.medication_id in(current_setting('test.v24.med_a')::uuid,current_setting('test.v24.med_b')::uuid)),
  'catalog',(select jsonb_agg(to_jsonb(m) order by m.id) from public.medications m where m.id in(current_setting('test.v24.med_a')::uuid,current_setting('test.v24.med_b')::uuid)));
$$;
do $$begin perform set_config('test.v24.non_dose_before',pg_temp.v24_non_dose_state()::text,true);end $$;

set local role authenticated;
do $$declare original jsonb;p jsonb;a jsonb;req uuid:=gen_random_uuid();bad jsonb;bad_req uuid;failed_requests jsonb:='[]';
begin
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v24.procedure')));
 p:=jsonb_build_object('kind','procedure','id',original->>'id','expected_version',original->'version','expected_stock_deducted',false,
  'services',original->'services','items',jsonb_build_array(
   jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',2,'dose','750 мг'),
   jsonb_build_object('medication_id',current_setting('test.v24.med_b'),'quantity',1,'dose','')),
  'own_medications',jsonb_build_array(original->'own_medications'->0||jsonb_build_object('dose','  300 мг  ')),
  'charge_total',2800,'paid_total',0,'payment_status','pending','discount_reason',original->>'discount_reason',
  'discount_comment',original->>'discount_comment','payments',jsonb_build_object('cash',0));
 a:=public.crm_clinical_v10('treatment_edit',p,req);
 if a->'own_medications'->0->>'dose' is distinct from '300 мг'
  or not exists(select 1 from jsonb_array_elements(a->'items') x where x->>'medication_id'=current_setting('test.v24.med_a') and x->>'dose'='750 мг') then raise exception 'Nurse individual dose edit did not persist';end if;
 if public.crm_clinical_v10('treatment_edit',p,req) is distinct from a then raise exception 'Individual dose edit replay differs';end if;
 perform set_config('test.v24.individual_dose_result',a::text,true);perform set_config('test.v24.edit_payload',p::text,true);
 for bad in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_object('dose',10),jsonb_build_object('dose',false),
  jsonb_build_object('dose',jsonb_build_array('750 мг')),jsonb_build_object('dose',repeat('м',201)))) loop
  bad_req:=gen_random_uuid();failed_requests:=failed_requests||to_jsonb(bad_req::text);
  begin
   perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('expected_version',2,'items',jsonb_build_array(
    jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',2)||bad,
    jsonb_build_object('medication_id',current_setting('test.v24.med_b'),'quantity',1))),bad_req);
   raise exception 'Invalid clinical item dose accepted: %',bad;
  exception when others then if sqlerrm like 'Invalid clinical item dose accepted:%' then raise;end if;end;
  bad_req:=gen_random_uuid();failed_requests:=failed_requests||to_jsonb(bad_req::text);
  begin
   perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('expected_version',2,'own_medications',
    jsonb_build_array(original->'own_medications'->0||bad)),bad_req);
   raise exception 'Invalid own medication dose accepted: %',bad;
  exception when others then if sqlerrm like 'Invalid own medication dose accepted:%' then raise;end if;end;
  bad_req:=gen_random_uuid();failed_requests:=failed_requests||to_jsonb(bad_req::text);
  begin
   perform public.record_treatment_v5('procedure',current_setting('test.v24.procedure_create_payload')::jsonb||jsonb_build_object('items',
    jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',2)||bad,
     jsonb_build_object('medication_id',current_setting('test.v24.med_b'),'quantity',1))),bad_req);
   raise exception 'Invalid clinical creation dose accepted: %',bad;
  exception when others then if sqlerrm like 'Invalid clinical creation dose accepted:%' then raise;end if;end;
 end loop;
 perform set_config('test.v24.failed_clinical_requests',failed_requests::text,true);
end $$;
reset role;
do $$begin
 if pg_temp.v24_non_dose_state() is distinct from current_setting('test.v24.non_dose_before')::jsonb then raise exception 'Dose-only edit changed quantity/catalog/prices/receipts/stock';end if;
 if exists(select 1 from private.warehouse_requests where id in
  (select value::uuid from jsonb_array_elements_text(current_setting('test.v24.failed_clinical_requests')::jsonb))) then raise exception 'Invalid dose edit left receipt';end if;
end $$;

-- Common protocol updates are separate from saved patient-specific procedures.
set local role authenticated;
do $$declare t jsonb;a jsonb;p jsonb;h jsonb;r jsonb;begin
 t:=public.crm_management_v5('template_save',jsonb_build_object('id',current_setting('test.v24.template'),'items',
  jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',3,'dose','1000 мг'))));
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v24.procedure')));
 if a is distinct from (current_setting('test.v24.individual_dose_result')::jsonb-'payments') then raise exception 'Common protocol update rewrote saved patient procedure';end if;
 p:=current_setting('test.v24.edit_payload')::jsonb||jsonb_build_object('expected_version',2,
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',1,'dose','250 мг')),
  'charge_total',1400,'discount_comment','TEST removed extra vial for this patient');
 a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if jsonb_array_length(a->'items')<>1 or (a->'items'->0->>'quantity')::numeric<>1 or a->'items'->0->>'dose' is distinct from '250 мг'
  or (a->>'list_total')::numeric<>1600 or (a->>'charge_total')::numeric<>1400 then raise exception 'Patient-specific drug removal/quantity/dose/price edit failed';end if;
 if public.crm_management_v5('templates_list','{}') @> jsonb_build_array(t) is distinct from true then raise exception 'Individualized patient edit changed protocol example';end if;
 h:=public.crm_clinical_v10('patient_treatments',jsonb_build_object('patient_id',current_setting('test.v24.patient')));
 select value into r from jsonb_array_elements(h->'procedures') where value->>'id'=a->>'id';
 if r->'items'->0->>'dose' is distinct from '250 мг' or r->'own_medications'->0->>'dose' is distinct from '300 мг' then raise exception 'Full patient history omits individualized dose';end if;
 h:=public.patient_history_v8(current_setting('test.v24.patient')::uuid);
 select value into r from jsonb_array_elements(h->'procedures') where value->>'id'=a->>'id';
 if r->'medications'->0->>'dose' is distinct from '250 мг' then raise exception 'Compact patient history omits dose';end if;
 h:=public.crm_shift_journal_v12(date '2096-10-24');r:=h->'reports'->0->'procedures'->0;
 if r->>'id' is distinct from a->>'id' or r->'items'->0->>'dose' is distinct from '250 мг'
  or r->'own_medications'->0->>'dose' is distinct from '300 мг' then raise exception 'Shift journal/report omits personalized doses';end if;
 if (h->'reports'->0->'revenue'->>'total')::numeric<>0 then raise exception 'Protocol/dose edit fabricated revenue';end if;
 -- Removing a common protocol leaves saved procedure history intact.
 perform public.crm_management_v5('template_save',jsonb_build_object('id',t->>'id','active',false));
 r:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',a->>'id'));
 if r is distinct from a-'payments' then raise exception 'Protocol archive changed patient procedure';end if;
end $$;
reset role;

-- Doses are clinical text; warehouse consumption still counts whole ampoules.
insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
 values(current_setting('test.v24.med_a')::uuid,10,10,10,100,current_date+100);
insert into public.stock(medication_id,location,quantity)
 values(current_setting('test.v24.med_a')::uuid,'work',10),(current_setting('test.v24.med_a')::uuid,'reserve',0);
update private.crm_finance_settings set payment_only=false where id;
set local role authenticated;
do $$declare p jsonb;a jsonb;begin
 p:=jsonb_build_object('patient_id',current_setting('test.v24.patient'),'shift_id',current_setting('test.v24.shift'),
  'nurse_id',current_setting('test.v24.nurse_staff'),'service_id',current_setting('test.v24.service'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',2,'dose','1500 мг')),
  'charge_total',2600,'paid_total',0,'payment_status','pending','payments',jsonb_build_object('cash',0),'expected_stock_deducted',true);
 a:=public.record_treatment_v5('procedure',p,gen_random_uuid());
 perform set_config('test.v24.tracked_procedure',a->>'id',true);
 p:=jsonb_build_object('kind','procedure','id',a->>'id','expected_version',1,'expected_stock_deducted',true,
  'services',a->'services','items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',2,'dose','3000 мг')),
  'charge_total',2600,'paid_total',0,'payment_status','pending','payments',jsonb_build_object('cash',0));
 a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if a->'items'->0->>'dose' is distinct from '3000 мг' or (a->'items'->0->>'quantity')::numeric<>2
  or (a->>'list_total')::numeric<>2600 or (a->>'charge_total')::numeric<>2600 then raise exception 'Tracked clinical dose edit changed bill or consumption count';end if;
end $$;
reset role;
do $$begin
 if (select quantity from public.stock where medication_id=current_setting('test.v24.med_a')::uuid and location='work')<>8
  or (select sum(work_quantity) from public.medication_batches where medication_id=current_setting('test.v24.med_a')::uuid)<>8
  or (select sum(quantity) from public.stock_movements where medication_id=current_setting('test.v24.med_a')::uuid and procedure_id=current_setting('test.v24.tracked_procedure')::uuid)<>2 then
  raise exception 'Dose converted to erroneous warehouse consumption';end if;
 perform private.assert_stock_v3(current_setting('test.v24.med_a')::uuid);
end $$;

-- Inactive/unlinked users remain denied. No public anonymous access is introduced.
do $$declare u text;begin
 foreach u in array array[current_setting('test.v24.inactive'),current_setting('test.v24.unlinked')] loop
  perform set_config('request.jwt.claim.sub',u,true);
  begin
   perform public.crm_management_v5('templates_list','{}');raise exception 'Inactive/unlinked user read shared protocols';
  exception when others then if sqlerrm='Inactive/unlinked user read shared protocols' then raise;end if;end;
  begin
   perform public.crm_save_recovery_v16('crm_management_v5',jsonb_build_object('p_action','template_save',
    'p_payload',jsonb_build_object('name','TEST forbidden protocol v24','items','[]'::jsonb)),gen_random_uuid());
   raise exception 'Inactive/unlinked user wrote protocol';
  exception when others then if sqlerrm='Inactive/unlinked user wrote protocol' then raise;end if;end;
 end loop;
 if has_function_privilege('anon','public.crm_management_v5(text,jsonb)','EXECUTE')
  or has_function_privilege('anon','public.crm_save_recovery_v16(text,jsonb,uuid)','EXECUTE') then raise exception 'Anonymous protocol API access exposed';end if;
end $$;

rollback;
