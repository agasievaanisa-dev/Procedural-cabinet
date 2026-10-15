-- Targeted regressions for dose compatibility, atomic failures and individual prices.
-- Every user, catalog item, treatment, payment and save receipt is synthetic and rolls back.
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

-- Compare complete synthetic state before and after each rejected RPC.
create function pg_temp.v24_regression_state() returns jsonb
language sql security definer set search_path='' as $$
 with p as (select id from public.procedures where shift_id=current_setting('test.v24.shift')::uuid),
 s as (select id from public.sales where shift_id=current_setting('test.v24.shift')::uuid)
 select jsonb_build_object(
  'procedures',(select jsonb_agg(to_jsonb(x) order by x.id) from public.procedures x where x.id in(select id from p)),
  'sales',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sales x where x.id in(select id from s)),
  'procedure_items',(select jsonb_agg(to_jsonb(x) order by x.procedure_id,x.medication_id) from public.procedure_medications x where x.procedure_id in(select id from p)),
  'sale_items',(select jsonb_agg(to_jsonb(x) order by x.sale_id,x.medication_id) from public.sale_items x where x.sale_id in(select id from s)),
  'services',(select jsonb_agg(to_jsonb(x) order by x.procedure_id,x.position) from private.crm_treatment_services x where x.procedure_id in(select id from p)),
  'own',(select jsonb_agg(to_jsonb(x) order by x.procedure_id,x.position) from private.crm_own_medications x where x.procedure_id in(select id from p)),
  'allocations',(select jsonb_agg(to_jsonb(x) order by x.id) from private.crm_payment_allocations x where x.procedure_id in(select id from p) or x.sale_id in(select id from s)),
  'receipts',(select jsonb_agg(to_jsonb(x) order by x.id) from private.crm_receipts_v10 x where x.procedure_id in(select id from p) or x.sale_id in(select id from s)),
  'templates',(select jsonb_agg(to_jsonb(x) order by x.id) from private.crm_procedure_templates x where x.name like 'TEST regression % v24'),
  'requests',(select jsonb_agg(to_jsonb(x) order by x.id) from private.warehouse_requests x where x.staff_user in(current_setting('test.v24.admin')::uuid,current_setting('test.v24.nurse')::uuid)),
  'save_requests',(select jsonb_agg(to_jsonb(x) order by x.request_id) from private.crm_save_requests_v16 x where x.actor_user in(current_setting('test.v24.admin')::uuid,current_setting('test.v24.nurse')::uuid)),
  'audit',(select jsonb_agg(to_jsonb(x) order by x.id) from private.crm_audit_log x where x.actor_user in(current_setting('test.v24.admin')::uuid,current_setting('test.v24.nurse')::uuid)),
  'catalog',(select jsonb_agg(to_jsonb(x) order by x.id) from public.medications x where x.id in(current_setting('test.v24.med_a')::uuid,current_setting('test.v24.med_b')::uuid)),
  'service_catalog',(select to_jsonb(x) from public.procedure_services x where x.id=current_setting('test.v24.service')::uuid),
  'stock',(select jsonb_agg(to_jsonb(x) order by x.medication_id,x.location) from public.stock x where x.medication_id in(current_setting('test.v24.med_a')::uuid,current_setting('test.v24.med_b')::uuid)),
  'movements',(select jsonb_agg(to_jsonb(x) order by x.id) from public.stock_movements x where x.medication_id in(current_setting('test.v24.med_a')::uuid,current_setting('test.v24.med_b')::uuid)),
  'salary',(select jsonb_agg(to_jsonb(x) order by x.staff_id) from private.crm_shift_payroll x where x.shift_id=current_setting('test.v24.shift')::uuid),
  'shift_staff',(select jsonb_agg(to_jsonb(x) order by x.staff_id) from public.shift_staff x where x.shift_id=current_setting('test.v24.shift')::uuid));
$$;

do $$declare pt uuid;begin
 insert into public.patients(full_name) values('TEST regression mixed-payment patient v24') returning id into pt;
 perform set_config('test.v24.paid_patient',pt::text,true);
 perform set_config('test.v24.regression_baseline',pg_temp.v24_regression_state()::text,true);
end $$;

-- A nurse's repeated equal doses aggregate; conflicting doses cannot partially save.
select set_config('request.jwt.claim.sub',current_setting('test.v24.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v24.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare p jsonb;args jsonb;a jsonb;before_n jsonb;bad jsonb;failed boolean;req uuid:=gen_random_uuid();mode_n text;
begin
 p:=jsonb_build_object('name','TEST regression shared protocol v24','service_id',current_setting('test.v24.service'),
  'items',jsonb_build_array(
   jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',1,'dose','  500 мг  '),
   jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',1,'dose','500 мг')));
 args:=jsonb_build_object('p_action','template_save','p_payload',p);
 a:=public.crm_save_recovery_v16('crm_management_v5',args,req)->'result';
 if jsonb_array_length(a->'items') is distinct from 1 or (a->'items'->0->>'quantity')::numeric is distinct from 2::numeric
  or a->'items'->0->>'dose' is distinct from '500 мг' then raise exception 'Equal template doses did not canonicalize';end if;
 before_n:=pg_temp.v24_regression_state();
 if public.crm_save_recovery_v16('crm_management_v5',args,req)->'result' is distinct from a
  or pg_temp.v24_regression_state() is distinct from before_n then raise exception 'Nurse template replay duplicated state';end if;
 perform set_config('test.v24.regression_template',a->>'id',true);
 for bad in select value from jsonb_array_elements(jsonb_build_array(to_jsonb('750 мг'::text),'null'::jsonb)) loop
  foreach mode_n in array array['create','edit'] loop
   before_n:=pg_temp.v24_regression_state();failed:=false;
   begin
    perform public.crm_save_recovery_v16('crm_management_v5',jsonb_build_object('p_action','template_save','p_payload',
     p||jsonb_build_object('name','TEST regression rejected protocol v24','items',jsonb_build_array(
      jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',1,'dose','500 мг'),
      jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',1,'dose',bad)))
      ||case when mode_n='edit' then jsonb_build_object('id',a->>'id') else '{}'::jsonb end),gen_random_uuid());
   exception when others then failed:=true;end;
   if not failed then raise exception 'Conflicting template doses accepted: % / %',mode_n,bad;end if;
   if pg_temp.v24_regression_state() is distinct from before_n then raise exception 'Rejected template conflict mutated rows, audit or receipts';end if;
  end loop;
 end loop;
end $$;

-- Legacy template editors also preserve omitted item doses and can clear them explicitly.
do $$declare a jsonb;p jsonb;req uuid:=gen_random_uuid();before_n jsonb;begin
 p:=jsonb_build_object('id',current_setting('test.v24.regression_template'),'items',jsonb_build_array(
  jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',2)));
 a:=public.crm_save_recovery_v16('crm_management_v5',jsonb_build_object('p_action','template_save','p_payload',p),req)->'result';
 if a->'items'->0->>'dose' is distinct from '500 мг' then raise exception 'Legacy template item edit erased dose';end if;
 before_n:=pg_temp.v24_regression_state();
 if public.crm_save_recovery_v16('crm_management_v5',jsonb_build_object('p_action','template_save','p_payload',p),req)->'result' is distinct from a
  or pg_temp.v24_regression_state() is distinct from before_n then raise exception 'Legacy template replay mutated state';end if;
 a:=public.crm_management_v5('template_save',p||jsonb_build_object('items',jsonb_build_array(
  jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',2,'dose',null))));
 if a->'items'->0->>'dose' is not null then raise exception 'Explicit null did not clear template dose';end if;
end $$;

-- Higher individual prices are valid for both an unpaid procedure and a partial sale.
do $$declare p jsonb;a jsonb;req uuid:=gen_random_uuid();begin
 p:=jsonb_build_object('patient_id',current_setting('test.v24.patient'),'shift_id',current_setting('test.v24.shift'),
  'nurse_id',current_setting('test.v24.nurse_staff'),'service_id',current_setting('test.v24.service'),
  'items',jsonb_build_array(
   jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',1,'dose','500 мг'),
   jsonb_build_object('medication_id',current_setting('test.v24.med_a'),'quantity',1,'dose',' 500 мг ')),
  'own_medications',jsonb_build_array(jsonb_build_object('name','TEST regression own vitamin v24','quantity',1,'unit','амп.','source','patient','dose','100 мг')),
  'charge_total',3000,'paid_total',0,'payment_status','pending','discount_reason','Индивидуальная цена',
  'discount_comment','TEST approved higher individual price','payments',jsonb_build_object('cash',0),'expected_stock_deducted',false);
 a:=public.record_treatment_v5('procedure',p,req);
 if (a->>'list_total')::numeric is distinct from 2600::numeric or (a->>'charge_total')::numeric is distinct from 3000::numeric
  or (a->>'debt_total')::numeric is distinct from 3000::numeric or (a->>'payment_pending')::boolean is distinct from true
  or (a->>'discount_amount')::numeric is distinct from 0::numeric or (a->>'discount_percent')::numeric is distinct from 0::numeric
  or jsonb_array_length(a->'items') is distinct from 1 or (a->'items'->0->>'quantity')::numeric is distinct from 2::numeric
  or a->'items'->0->>'dose' is distinct from '500 мг' then raise exception 'Higher-charge pending procedure or same-dose aggregation wrong: %',a;end if;
 if public.record_treatment_v5('procedure',p,req) is distinct from a then raise exception 'Higher-price procedure replay differs';end if;
 perform set_config('test.v24.regression_procedure',a->>'id',true);
 perform set_config('test.v24.regression_create',p::text,true);
 p:=(p-'service_id'-'own_medications')||jsonb_build_object('items',jsonb_build_array(
  jsonb_build_object('medication_id',current_setting('test.v24.med_b'),'quantity',1,'dose','250 мг')),
  'charge_total',650,'paid_total',600,'payment_status','debt','payments',jsonb_build_object('cash',600));
 a:=public.record_treatment_v5('sale',p,gen_random_uuid());
 if (a->>'list_total')::numeric is distinct from 500::numeric or (a->>'charge_total')::numeric is distinct from 650::numeric
  or (a->>'received_total')::numeric is distinct from 600::numeric or (a->>'debt_total')::numeric is distinct from 50::numeric
  or (a->>'discount_amount')::numeric is distinct from 0::numeric or (a->>'discount_percent')::numeric is distinct from 0::numeric
  or a->'items'->0->>'dose' is distinct from '250 мг' then raise exception 'Higher-charge partial sale wrong: %',a;end if;
 perform set_config('test.v24.regression_sale',a->>'id',true);
 perform set_config('test.v24.regression_sale_create',p::text,true);
end $$;

-- Old callers that resend items without dose preserve doses; explicit null clears them.
do $$declare kind_n text;a jsonb;p jsonb;req uuid;before_n jsonb;begin
 foreach kind_n in array array['procedure','sale'] loop
  a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind',kind_n,'id',current_setting('test.v24.regression_'||kind_n)));
  p:=jsonb_build_object('kind',kind_n,'id',a->>'id','expected_version',a->'version','expected_stock_deducted',false,
   'services',a->'services','items',jsonb_build_array((a->'items'->0)-'dose'),'charge_total',a->'charge_total',
   'payment_status',case when kind_n='procedure' then 'pending' else 'debt' end,
   'discount_reason',a->>'discount_reason','discount_comment',a->>'discount_comment','payments',jsonb_build_object('cash',0),
   'edit_reason','TEST legacy caller changes note without dose','notes','TEST compatible legacy edit');
  if kind_n='procedure' then p:=p||jsonb_build_object('own_medications',jsonb_build_array((a->'own_medications'->0)-'dose'));end if;
  req:=gen_random_uuid();a:=public.crm_clinical_v10('treatment_edit',p,req);
  if a->'items'->0->>'dose' is distinct from (case when kind_n='procedure' then '500 мг' else '250 мг' end)
   or (kind_n='procedure' and a->'own_medications'->0->>'dose' is distinct from '100 мг') then raise exception 'Legacy % edit erased dose',kind_n;end if;
  before_n:=pg_temp.v24_regression_state();
  if public.crm_clinical_v10('treatment_edit',p,req) is distinct from a or pg_temp.v24_regression_state() is distinct from before_n then raise exception 'Legacy dose edit replay changed state';end if;
  p:=p||jsonb_build_object('expected_version',a->'version','items',jsonb_build_array((a->'items'->0)||jsonb_build_object('dose',null)),
   'edit_reason','TEST explicitly clear optional dose');
  if kind_n='procedure' then p:=p||jsonb_build_object('own_medications',jsonb_build_array((a->'own_medications'->0)||jsonb_build_object('dose',null)));end if;
  a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
  if a->'items'->0->>'dose' is not null or (kind_n='procedure' and a->'own_medications'->0->>'dose' is not null)
   then raise exception 'Explicit null did not clear % dose',kind_n;end if;
 end loop;
end $$;

-- A conflict rejects creation and editing, including a null-versus-text conflict.
do $$declare kind_n text;bad jsonb;p jsonb;a jsonb;before_n jsonb;failed boolean;mode_n text;med_n text;begin
 foreach kind_n in array array['procedure','sale'] loop
  med_n:=current_setting(case when kind_n='procedure' then 'test.v24.med_a' else 'test.v24.med_b' end);
  for bad in select value from jsonb_array_elements(jsonb_build_array(to_jsonb('750 мг'::text),'null'::jsonb)) loop
   foreach mode_n in array array['create','edit'] loop
    if mode_n='create' then
     p:=current_setting(case when kind_n='procedure' then 'test.v24.regression_create' else 'test.v24.regression_sale_create' end)::jsonb;
     if kind_n='sale' then p:=p||jsonb_build_object('charge_total',1300);end if;
    else
     a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind',kind_n,'id',current_setting('test.v24.regression_'||kind_n)));
     p:=jsonb_build_object('kind',kind_n,'id',a->>'id','expected_version',a->'version','expected_stock_deducted',false,
      'services',a->'services','own_medications',a->'own_medications','charge_total',case when kind_n='sale' then 1300 else (a->>'charge_total')::numeric end,
      'payment_status',case when kind_n='procedure' then 'pending' else 'debt' end,'discount_reason','Индивидуальная цена',
      'discount_comment','TEST approved higher individual price','payments',jsonb_build_object('cash',0),'edit_reason','TEST rejected conflicting duplicate doses');
    end if;
    p:=p||jsonb_build_object('items',jsonb_build_array(
     jsonb_build_object('medication_id',med_n,'quantity',1,'dose','500 мг'),
     jsonb_build_object('medication_id',med_n,'quantity',1,'dose',bad)));
    before_n:=pg_temp.v24_regression_state();failed:=false;
    begin
     if mode_n='create' then perform public.record_treatment_v5(kind_n,p,gen_random_uuid());
     else perform public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());end if;
    exception when others then failed:=true;end;
    if not failed then raise exception 'Conflicting clinical doses accepted: % / % / %',kind_n,mode_n,bad;end if;
    if pg_temp.v24_regression_state() is distinct from before_n then raise exception 'Rejected clinical conflict mutated treatment, receipts, audit or stock';end if;
   end loop;
  end loop;
 end loop;
end $$;

-- Higher-charge edits retain pending/debt behavior and all previously received money.
do $$declare kind_n text;a jsonb;p jsonb;before_n jsonb;failed boolean;begin
 foreach kind_n in array array['procedure','sale'] loop
  a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind',kind_n,'id',current_setting('test.v24.regression_'||kind_n)));
  p:=jsonb_build_object('kind',kind_n,'id',a->>'id','expected_version',a->'version','expected_stock_deducted',false,
   'services',a->'services','items',a->'items','own_medications',a->'own_medications',
   'charge_total',case when kind_n='procedure' then 3300 else 750 end,
   'payment_status',case when kind_n='procedure' then 'pending' else 'debt' end,'discount_reason','Индивидуальная цена',
   'discount_comment','TEST approved higher corrected price','payments',case when kind_n='procedure' then jsonb_build_object('cash',0) else jsonb_build_object('terminal',25) end,
   'edit_reason','TEST change individual charge above catalog');
  a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
  if (a->>'list_total')::numeric is distinct from (case when kind_n='procedure' then 2600::numeric else 500::numeric end)
   or (a->>'charge_total')::numeric is distinct from (case when kind_n='procedure' then 3300::numeric else 750::numeric end)
   or (a->>'debt_total')::numeric is distinct from (case when kind_n='procedure' then 3300::numeric else 125::numeric end)
   or (a->>'loan_debt_total')::numeric is distinct from (case when kind_n='procedure' then 0::numeric else 125::numeric end)
   or (a->>'pending_total')::numeric is distinct from (case when kind_n='procedure' then 3300::numeric else 0::numeric end)
   or (a->>'received_total')::numeric is distinct from (case when kind_n='procedure' then 0::numeric else 625::numeric end)
   or (a->>'discount_amount')::numeric is distinct from 0::numeric or (a->>'discount_percent')::numeric is distinct from 0::numeric
   then raise exception 'Higher % correction changed list, charge, receipts or discount',kind_n;end if;
  if kind_n='sale' then
   -- 600 is above the catalog 500, but below 625 already received.
   p:=p||jsonb_build_object('expected_version',a->'version','charge_total',600,'payments',jsonb_build_object('cash',0));
   before_n:=pg_temp.v24_regression_state();failed:=false;
   begin perform public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());exception when others then failed:=true;end;
   if not failed then raise exception 'Above-list correction lowered charge below received money';end if;
   if pg_temp.v24_regression_state() is distinct from before_n then raise exception 'Rejected below-received charge mutated history or receipts';end if;
  elsif (a->>'payment_pending')::boolean is distinct from true then raise exception 'Higher pending price lost payment pending state';
  end if;
 end loop;
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v24.shift')));
 -- The additional 25 settles a true loan in the separate ledger. Only the
 -- original 600 belongs to shift income; the unpaid procedure is still waiting.
 if (a->'revenue'->>'cash')::numeric is distinct from 600::numeric or (a->'revenue'->>'terminal')::numeric is distinct from 0::numeric
  or (a->'revenue'->>'total')::numeric is distinct from 600::numeric
  or (a->>'debt_total')::numeric is distinct from 125::numeric or (a->>'loan_debt_total')::numeric is distinct from 125::numeric
  or (a->>'pending_total')::numeric is distinct from 3300::numeric or jsonb_array_length(a->'receipts') is distinct from 0
  then raise exception 'Higher charges mixed shift income, loan repayments or waiting payments: %',a;end if;
end $$;

-- Price deviations still require both explanations; invalid amounts roll back entirely.
do $$declare kind_n text;a jsonb;p jsonb;bad jsonb;before_n jsonb;failed boolean;mode_n text;begin
 foreach kind_n in array array['procedure','sale'] loop
  foreach mode_n in array array['create','edit'] loop
   if mode_n='create' then p:=current_setting(case when kind_n='procedure' then 'test.v24.regression_create' else 'test.v24.regression_sale_create' end)::jsonb;
   else
    a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind',kind_n,'id',current_setting('test.v24.regression_'||kind_n)));
    p:=jsonb_build_object('kind',kind_n,'id',a->>'id','expected_version',a->'version','expected_stock_deducted',false,
     'services',a->'services','items',a->'items','own_medications',a->'own_medications','charge_total',a->'charge_total',
     'payment_status',case when kind_n='procedure' then 'pending' else 'debt' end,'discount_reason','Индивидуальная цена',
     'discount_comment','TEST approved higher individual price','payments',jsonb_build_object('cash',0),'edit_reason','TEST reject unexplained price');
   end if;
   for bad in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('discount_reason',null),jsonb_build_object('discount_comment',null),
    jsonb_build_object('discount_reason','   '),jsonb_build_object('discount_comment','   '))) loop
    before_n:=pg_temp.v24_regression_state();failed:=false;
    begin
     if mode_n='create' then perform public.record_treatment_v5(kind_n,p||bad,gen_random_uuid());
     else perform public.crm_clinical_v10('treatment_edit',p||bad,gen_random_uuid());end if;
    exception when others then failed:=true;end;
    if not failed then raise exception 'Unexplained higher price accepted: % / % / %',kind_n,mode_n,bad;end if;
    if pg_temp.v24_regression_state() is distinct from before_n then raise exception 'Rejected unexplained price mutated synthetic state';end if;
   end loop;
  end loop;
 end loop;
 p:=current_setting('test.v24.regression_create')::jsonb;
 for bad in select value from jsonb_array_elements(jsonb_build_array('null'::jsonb,to_jsonb('NaN'::text),to_jsonb('Infinity'::text),
  to_jsonb('-Infinity'::text),to_jsonb(-1),to_jsonb(0.001))) loop
  before_n:=pg_temp.v24_regression_state();failed:=false;
  begin perform public.record_treatment_v5('procedure',p||jsonb_build_object('charge_total',bad),gen_random_uuid());exception when others then failed:=true;end;
  if not failed then raise exception 'Invalid individual amount accepted: %',bad;end if;
  if pg_temp.v24_regression_state() is distinct from before_n then raise exception 'Invalid individual amount left treatment or payment receipt';end if;
 end loop;
end $$;
reset role;

-- A fully paid higher price retains the cash/terminal ratio and catalog line prices.
select set_config('request.jwt.claim.sub',current_setting('test.v24.admin'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v24.admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare p jsonb;a jsonb;b jsonb;r jsonb;req uuid:=gen_random_uuid();before_n jsonb;day_n date:=(now() at time zone 'Europe/Moscow')::date;begin
 p:=current_setting('test.v24.regression_create')::jsonb||jsonb_build_object('patient_id',current_setting('test.v24.paid_patient'),
  'charge_total',3120,'paid_total',3120,'payment_status','paid','payments',jsonb_build_object('cash',1248,'terminal',1872,'cash_received',1500));
 a:=public.record_treatment_v5('procedure',p,req);
 if (a->>'list_total')::numeric is distinct from 2600::numeric or (a->>'charge_total')::numeric is distinct from 3120::numeric
  or (a->>'received_total')::numeric is distinct from 3120::numeric or (a->>'debt_total')::numeric is distinct from 0::numeric
  or (a->>'discount_amount')::numeric is distinct from 0::numeric or (a->>'discount_percent')::numeric is distinct from 0::numeric
  or (a->'items'->0->>'unit_price')::numeric is distinct from 1000::numeric
  or (a->'items'->0->>'line_total')::numeric is distinct from 2000::numeric
  or (a->'payments'->>'change')::numeric is distinct from 252::numeric then raise exception 'Fully paid higher price changed catalog or actual receipt amount: %',a;end if;
 before_n:=pg_temp.v24_regression_state();
 if public.record_treatment_v5('procedure',p,req) is distinct from a or pg_temp.v24_regression_state() is distinct from before_n then raise exception 'Mixed-payment replay duplicated income';end if;
 perform set_config('test.v24.regression_paid',a->>'id',true);
 b:=public.crm_finance_v5('summary',jsonb_build_object('from',day_n-1,'to',day_n+1,'group_by','medication','patient_id',current_setting('test.v24.paid_patient')));
 select value into r from jsonb_array_elements(b->'rows') where value->>'id'=current_setting('test.v24.med_a');
 if r is null or (r->'revenue'->>'cash')::numeric is distinct from 960::numeric
  or (r->'revenue'->>'terminal')::numeric is distinct from 1440::numeric or (r->'revenue'->>'total')::numeric is distinct from 2400::numeric
  or (b->'revenue'->>'cash')::numeric is distinct from 1248::numeric or (b->'revenue'->>'terminal')::numeric is distinct from 1872::numeric
  or (b->'revenue'->>'total')::numeric is distinct from 3120::numeric then raise exception 'Higher-price medication revenue lost proportional methods: %',b;end if;
 b:=public.crm_finance_v5('summary',jsonb_build_object('from',day_n-1,'to',day_n+1,'group_by','service','patient_id',current_setting('test.v24.paid_patient')));
 select value into r from jsonb_array_elements(b->'rows') where value->>'id'=current_setting('test.v24.service');
 if r is null or (r->'revenue'->>'cash')::numeric is distinct from 1248::numeric
  or (r->'revenue'->>'terminal')::numeric is distinct from 1872::numeric or (r->'revenue'->>'total')::numeric is distinct from 3120::numeric
  then raise exception 'Higher-price service report omitted or distorted receipt methods: %',b;end if;
end $$;
reset role;

do $$declare a jsonb:=pg_temp.v24_regression_state();baseline jsonb:=current_setting('test.v24.regression_baseline')::jsonb;begin
 if a->'catalog' is distinct from baseline->'catalog' or a->'service_catalog' is distinct from baseline->'service_catalog'
  or a->'stock' is distinct from baseline->'stock' or a->'movements' is distinct from baseline->'movements'
  or a->'salary' is distinct from baseline->'salary' or a->'shift_staff' is distinct from baseline->'shift_staff'
  then raise exception 'Individual doses/prices changed shared catalog, stock or salary';end if;
 if (select count(*) from private.crm_payment_allocations where procedure_id=current_setting('test.v24.regression_paid')::uuid)<>1
  then raise exception 'Mixed-payment create replay duplicated allocation';end if;
 if (select paid_total from public.sales where id=current_setting('test.v24.regression_sale')::uuid)<>600
  or (select count(*) from private.crm_receipts_v10 where sale_id=current_setting('test.v24.regression_sale')::uuid)<>1
  or not exists(select 1 from private.crm_receipts_v10 where sale_id=current_setting('test.v24.regression_sale')::uuid
   and is_debt_repayment and shift_id is null and terminal=25 and cash=0 and owner_card=0 and voided_at is null)
  then raise exception 'Higher debt correction rewrote original money or duplicated later receipt';end if;
end $$;

rollback;
