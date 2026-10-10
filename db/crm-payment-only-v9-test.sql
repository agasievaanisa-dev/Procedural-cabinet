-- Run after crm-payment-only-v9.sql. All fixtures, mode changes and writes roll back.
-- Only existing staff login metadata is read; clinical fixtures are synthetic.
begin;
select set_config('test.v9.manager',(select auth_user_id::text from public.staff where active and role in('admin','owner') and auth_user_id is not null limit 1),true);
select set_config('test.v9.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.v9.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v9.manager'),'role','authenticated')::text,true);
do $$ declare sh uuid; wrong_sh uuid; n uuid; peer uuid; outsider uuid; pt uuid; archived_pt uuid; sv uuid; med uuid; zero_med uuid; archived_med uuid; unpriced_med uuid; deleted_med uuid;
begin
 if nullif(current_setting('test.v9.manager'),'') is null or nullif(current_setting('test.v9.nurse'),'') is null then raise exception 'Tests require linked owner and nurse';end if;
 update private.crm_finance_settings set payment_only=false where id;
 select id into n from public.staff where auth_user_id=current_setting('test.v9.nurse')::uuid and active limit 1;
 insert into public.staff(full_name,role) values('Тест оплаты без склада — второй сотрудник','nurse') returning id into peer;
 insert into public.staff(full_name,role) values('Тест оплаты без склада — чужая смена','nurse') returning id into outsider;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2093-05-17',now(),now()+interval '8 hours','open') returning id into sh;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2093-05-18',now(),now()+interval '8 hours','open') returning id into wrong_sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,n),(sh,peer),(wrong_sh,outsider);
 insert into public.patients(full_name) values('Тест оплаты без склада — вымышленный пациент') returning id into pt;
 insert into public.patients(full_name,archived,archived_at) values('Тест оплаты без склада — архивный пациент',true,now()) returning id into archived_pt;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('Тест оплаты без склада — услуга',100,50,true) returning id into sv;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('Тест оплаты без склада — остатки сохраняются','амп.',10,100,20,0,0) returning id into med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(med,16,16,10,10,current_date+100);
 insert into public.stock(medication_id,location,quantity) values(med,'reserve',6),(med,'work',10);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price)
  values('Тест оплаты без склада — только прайс','амп.',10,0,20) returning id into zero_med;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,active)
  values('Тест оплаты без склада — архивный препарат','амп.',10,0,20,false) returning id into archived_med;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price)
  values('Тест оплаты без склада — цена не задана','амп.',10,0,0) returning id into unpriced_med;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price)
  values('Тест оплаты без склада — удалённый препарат','амп.',10,0,20) returning id into deleted_med;
 perform set_config('test.v9.shift',sh::text,true);perform set_config('test.v9.wrong_shift',wrong_sh::text,true);
 perform set_config('test.v9.nurse_id',n::text,true);perform set_config('test.v9.peer',peer::text,true);perform set_config('test.v9.outsider',outsider::text,true);
 perform set_config('test.v9.patient',pt::text,true);perform set_config('test.v9.archived_patient',archived_pt::text,true);perform set_config('test.v9.service',sv::text,true);
 perform set_config('test.v9.med',med::text,true);perform set_config('test.v9.zero_med',zero_med::text,true);perform set_config('test.v9.archived_med',archived_med::text,true);
 perform set_config('test.v9.unpriced_med',unpriced_med::text,true);perform set_config('test.v9.deleted_med',deleted_med::text,true);
end $$;

-- Owner explicitly enables the setting; malformed types cannot silently toggle it.
set local role authenticated;
do $$ declare r jsonb; bad jsonb; failed boolean;
begin
 r:=public.crm_finance_v5('settings_save','{"payment_only":true}');
 if r->'payment_only' is distinct from 'true'::jsonb then raise exception 'Owner enable failed';end if;
 r:=public.crm_finance_v5('accounting_mode');
 if r is distinct from '{"payment_only":true,"stock_deducted":false}'::jsonb then raise exception 'Mode API contract wrong: %',r;end if;
 foreach bad in array array['{"payment_only":"true"}'::jsonb,'{"payment_only":null}'::jsonb,'{"payment_only":1}'::jsonb] loop
  failed:=false;
  begin perform public.crm_finance_v5('settings_save',bad);exception when raise_exception then failed:=true;end;
  if not failed then raise exception 'Malformed setting accepted: %',bad;end if;
 end loop;
 r:=public.crm_finance_v5('settings_save','{"float_amount":50000}');
 if r->'payment_only' is distinct from 'true'::jsonb then raise exception 'Old settings client reset accounting mode';end if;
 perform public.crm_medication_delete_v7('delete',jsonb_build_object('id',current_setting('test.v9.deleted_med'),
  'expected_reserve',0,'expected_work',0,'reason','Вымышленный удалённый препарат для проверки доступа'),gen_random_uuid());
end $$;
reset role;
select set_config('test.v9.stock_before',(select coalesce(jsonb_agg(to_jsonb(s) order by location),'[]')::text from public.stock s where medication_id in(current_setting('test.v9.med')::uuid,current_setting('test.v9.zero_med')::uuid)),true);
select set_config('test.v9.batches_before',(select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]')::text from public.medication_batches b where medication_id in(current_setting('test.v9.med')::uuid,current_setting('test.v9.zero_med')::uuid)),true);

select set_config('request.jwt.claim.sub',current_setting('test.v9.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v9.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare p jsonb; r jsonb; req uuid:=gen_random_uuid(); failed boolean; bad jsonb; report_n jsonb;
begin
 r:=public.crm_finance_v5('accounting_mode');
 if r ? 'float_amount' or r ? 'revenue' or r is distinct from '{"payment_only":true,"stock_deducted":false}'::jsonb then raise exception 'Nurse safe mode API wrong';end if;
 failed:=false;begin perform public.crm_finance_v5('settings_save','{"payment_only":false}');exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse changed global mode';end if;
 failed:=false;begin perform public.crm_finance_v5('settings_get');exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse read private finance settings';end if;
 p:=jsonb_build_object('shift_id',current_setting('test.v9.shift'),'nurse_id',current_setting('test.v9.nurse_id'),'patient_id',current_setting('test.v9.patient'),
  'service_id',current_setting('test.v9.service'),'paid_total',250,'expected_stock_deducted',false,
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v9.med'),'quantity',3),jsonb_build_object('medication_id',current_setting('test.v9.zero_med'),'quantity',2)),
  'payments',jsonb_build_object('cash',50,'terminal',100,'owner_card',100,'cash_received',500));
 r:=public.record_treatment_v5('procedure',p,req);
 if r->'stock_deducted' is distinct from 'false'::jsonb or r->'payment_only' is distinct from 'true'::jsonb or(r->>'paid_total')::numeric is distinct from 250::numeric or(r->'payments'->>'change')::numeric is distinct from 450::numeric then raise exception 'Payment-only receipt incorrect: %',r;end if;
 if public.record_treatment_v5('procedure',p,req)<>r then raise exception 'Payment-only replay changed';end if;
 perform set_config('test.v9.procedure',r->>'id',true);perform set_config('test.v9.procedure_request',req::text,true);
 perform set_config('test.v9.procedure_payload',p::text,true);perform set_config('test.v9.procedure_receipt',r::text,true);
 failed:=false;begin perform public.record_treatment_v5('procedure',p||'{"expected_stock_deducted":true}',gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Stale tracked expectation accepted in payment-only mode';end if;
 foreach bad in array array['{"expected_stock_deducted":"false"}'::jsonb,'{"expected_stock_deducted":null}'::jsonb,'{"expected_stock_deducted":0}'::jsonb] loop
  failed:=false;begin perform public.record_treatment_v5('procedure',p||bad,gen_random_uuid());exception when raise_exception then failed:=true;end;
  if not failed then raise exception 'Malformed expected mode accepted: %',bad;end if;
 end loop;
 foreach bad in array array[
  jsonb_build_object('patient_id',current_setting('test.v9.archived_patient')),
  jsonb_build_object('shift_id',current_setting('test.v9.wrong_shift')),
  jsonb_build_object('nurse_id',current_setting('test.v9.outsider')),
  jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v9.archived_med'),'quantity',1)),'paid_total',170,'payments',jsonb_build_object('terminal',170)),
  jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v9.deleted_med'),'quantity',1)),'paid_total',170,'payments',jsonb_build_object('terminal',170)),
  jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v9.unpriced_med'),'quantity',1)),'paid_total',150,'payments',jsonb_build_object('terminal',150)),
  jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v9.zero_med'),'quantity',-1)),'paid_total',130,'payments',jsonb_build_object('terminal',130)),
  jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v9.zero_med'),'quantity',1.5)),'paid_total',180,'payments',jsonb_build_object('terminal',180)),
  jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication_id',gen_random_uuid(),'quantity',1)),'paid_total',150,'payments',jsonb_build_object('terminal',150)),
  jsonb_build_object('payments',jsonb_build_object('cash',249)),
  jsonb_build_object('payments',jsonb_build_object('cash',250,'cash_received',100)),
  jsonb_build_object('payments',jsonb_build_object('terminal',250.001)),
  jsonb_build_object('paid_total',230,'discount_reason','Акция','payments',jsonb_build_object('terminal',230))
 ] loop
  failed:=false;begin perform public.record_treatment_v5('procedure',p||bad,gen_random_uuid());exception when raise_exception then failed:=true;end;
  if not failed then raise exception 'Payment-only bypassed existing validation: %',bad;end if;
 end loop;
 failed:=false;begin perform public.record_treatment_v5('procedure',p||jsonb_build_object('payments',jsonb_build_object('terminal',250)),req);exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Same request accepted modified payments';end if;
 p:=p||jsonb_build_object('paid_total',60,'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v9.zero_med'),'quantity',1),jsonb_build_object('medication_id',current_setting('test.v9.zero_med'),'quantity',2)),
  'payments',jsonb_build_object('terminal',60));
 r:=public.record_treatment_v5('sale',p,gen_random_uuid());
 if r->'stock_deducted' is distinct from 'false'::jsonb or r->'payment_only' is distinct from 'true'::jsonb or(r->>'paid_total')::numeric is distinct from 60::numeric then raise exception 'Zero stock sale not recorded';end if;
 perform set_config('test.v9.sale',r->>'id',true);
 failed:=false;begin perform public.record_treatment_v5('sale',p||'{"reserve_sale":true}',gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse reserve privilege bypassed';end if;
 report_n:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v9.shift')));
 if report_n ? 'revenue' or report_n ? 'payroll_total' or report_n->'procedures'->0 ? 'paid_total' or report_n->'stock'->0 ? 'reserve' then raise exception 'Payment-only nurse report leaks finances/reserve';end if;
 if jsonb_array_length(report_n->'used') is distinct from 0 or(report_n->>'payment_only_procedures_count')::integer is distinct from 1 or(report_n->>'payment_only_sales_count')::integer is distinct from 1 then raise exception 'Nurse report confuses billed and deducted drugs';end if;
 r:=public.patient_history_v8(current_setting('test.v9.patient')::uuid);
 if not exists(select 1 from jsonb_array_elements(r->'procedures') e where e->>'id'=current_setting('test.v9.procedure') and e->'stock_deducted'='false'::jsonb) then raise exception 'Patient history lacks payment-only marker';end if;
end $$;
reset role;

do $$ begin
 if(select coalesce(jsonb_agg(to_jsonb(s) order by location),'[]') from public.stock s where medication_id in(current_setting('test.v9.med')::uuid,current_setting('test.v9.zero_med')::uuid))<>current_setting('test.v9.stock_before')::jsonb then raise exception 'Payment-only changed aggregate stock';end if;
 if(select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]') from public.medication_batches b where medication_id in(current_setting('test.v9.med')::uuid,current_setting('test.v9.zero_med')::uuid))<>current_setting('test.v9.batches_before')::jsonb then raise exception 'Payment-only changed any batch field';end if;
 if exists(select 1 from public.stock_movements where medication_id in(current_setting('test.v9.med')::uuid,current_setting('test.v9.zero_med')::uuid)) then raise exception 'Payment-only invented stock movement';end if;
 if(select count(*) from public.procedures where shift_id=current_setting('test.v9.shift')::uuid)<>1 or(select count(*) from public.sales where shift_id=current_setting('test.v9.shift')::uuid)<>1 then raise exception 'Failed operation/idempotency left clinical rows';end if;
 if(select count(*) from public.sale_items where sale_id=current_setting('test.v9.sale')::uuid)<>1 or(select sum(quantity) from public.sale_items where sale_id=current_setting('test.v9.sale')::uuid)<>3 then raise exception 'Duplicate medication rows not aggregated';end if;
 if not exists(select 1 from public.procedures where id=current_setting('test.v9.procedure')::uuid and not stock_deducted and list_total=250 and paid_total=250) then raise exception 'Procedure mode snapshot or totals wrong';end if;
 if not exists(select 1 from public.sales where id=current_setting('test.v9.sale')::uuid and not stock_deducted and list_total=60 and paid_total=60) then raise exception 'Sale mode snapshot or totals wrong';end if;
 if(select count(*) from private.crm_payment_allocations where procedure_id=current_setting('test.v9.procedure')::uuid or sale_id=current_setting('test.v9.sale')::uuid)<>2 then raise exception 'Missing/duplicate allocation';end if;
 if not exists(select 1 from private.crm_audit_log where action='payment_recorded' and entity_id=current_setting('test.v9.procedure') and after_data->'stock_deducted'='false'::jsonb) then raise exception 'Audit omits boolean mode';end if;
 if(select sum(amount) from private.crm_shift_payroll where shift_id=current_setting('test.v9.shift')::uuid)<>4000 then raise exception 'Payment-only altered flat payroll';end if;
 perform private.assert_stock_v3(current_setting('test.v9.med')::uuid);
end $$;

-- Owner reserve checkbox does not transfer or deduct stock in payment-only mode.
select set_config('request.jwt.claim.sub',current_setting('test.v9.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v9.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare p jsonb;r jsonb;
begin
 p:=jsonb_build_object('shift_id',current_setting('test.v9.shift'),'nurse_id',current_setting('test.v9.nurse_id'),'patient_id',current_setting('test.v9.patient'),'expected_stock_deducted',false,
  'reserve_sale',true,'paid_total',2000,'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v9.med'),'quantity',100)), 'payments',jsonb_build_object('owner_card',2000));
 r:=public.record_treatment_v5('sale',p,gen_random_uuid());
 if r->'stock_deducted' is distinct from 'false'::jsonb or r->'payment_only' is distinct from 'true'::jsonb then raise exception 'Reserve checkbox overrode payment-only';end if;
 perform set_config('test.v9.owner_sale',r->>'id',true);
 perform public.crm_finance_v5('settings_save','{"payment_only":false}');
end $$;
reset role;
do $$ begin
 if(select coalesce(jsonb_agg(to_jsonb(s) order by location),'[]') from public.stock s where medication_id=current_setting('test.v9.med')::uuid)<>current_setting('test.v9.stock_before')::jsonb then raise exception 'Owner sale/mode switch altered stock';end if;
 if exists(select 1 from public.stock_movements where medication_id=current_setting('test.v9.med')::uuid) then raise exception 'Reserve transfer happened in payment-only';end if;
end $$;

-- The old committed receipt replays with its saved mode even after the switch.
select set_config('request.jwt.claim.sub',current_setting('test.v9.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v9.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare p jsonb;r jsonb;failed boolean;
begin
 p:=current_setting('test.v9.procedure_payload')::jsonb;
 if public.record_treatment_v5('procedure',p,current_setting('test.v9.procedure_request')::uuid)<>current_setting('test.v9.procedure_receipt')::jsonb then raise exception 'Replay after mode change differs';end if;
 failed:=false;begin perform public.record_treatment_v5('procedure',p,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Stale payment-only expectation accepted in tracked mode';end if;
 p:=p||jsonb_build_object('expected_stock_deducted',true,'paid_total',170,'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v9.zero_med'),'quantity',1)), 'payments',jsonb_build_object('terminal',170));
 failed:=false;begin perform public.record_treatment_v5('procedure',p,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Tracked mode allowed zero-stock treatment';end if;
 p:=p||jsonb_build_object('paid_total',190,'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v9.med'),'quantity',2)),'payments',jsonb_build_object('cash',190,'cash_received',200));
 r:=public.record_treatment_v5('procedure',p,gen_random_uuid());
 if r->'stock_deducted' is distinct from 'true'::jsonb or r->'payment_only' is distinct from 'false'::jsonb or(r->'payments'->>'change')::numeric is distinct from 10::numeric then raise exception 'Tracked receipt incorrect';end if;
 perform set_config('test.v9.tracked',r->>'id',true);
end $$;
reset role;
do $$ begin
 if(select quantity from public.stock where medication_id=current_setting('test.v9.med')::uuid and location='work')<>8 or(select quantity from public.stock where medication_id=current_setting('test.v9.med')::uuid and location='reserve')<>6 then raise exception 'Tracked mode changed wrong stock';end if;
 if(select work_quantity from public.medication_batches where medication_id=current_setting('test.v9.med')::uuid)<>8 or(select quantity_remaining from public.medication_batches where medication_id=current_setting('test.v9.med')::uuid)<>14 then raise exception 'Tracked batch wrong';end if;
 if(select sum(quantity) from public.stock_movements where medication_id=current_setting('test.v9.med')::uuid)<>2 then raise exception 'Tracked movements include old billed items';end if;
 if not exists(select 1 from public.procedures where id=current_setting('test.v9.tracked')::uuid and stock_deducted) then raise exception 'Tracked mode flag missing';end if;
 perform private.assert_stock_v3(current_setting('test.v9.med')::uuid);
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.v9.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v9.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare r jsonb; summary_n jsonb;failed boolean;
begin
 r:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v9.shift')));
 if r->'revenue'<>'{"cash":240,"terminal":160,"owner_card":2100,"unclassified":0,"total":2500}'::jsonb then raise exception 'Mixed mode revenue wrong: %',r->'revenue';end if;
 if(r->>'payroll_total')::numeric<>4000 or(r->>'cash_after_salary')::numeric<>-1500 then raise exception 'Mixed mode payroll/remainder wrong';end if;
 if jsonb_array_length(r->'used') is distinct from 1 or(r->'used'->0->>'quantity')::numeric is distinct from 2::numeric or(r->'used'->0->>'procedure_qty')::numeric is distinct from 2::numeric then raise exception 'True use includes payment-only billings: %',r->'used';end if;
 if jsonb_array_length(r->'untracked') is distinct from 2 or not exists(select 1 from jsonb_array_elements(r->'untracked') x where x->>'id'=current_setting('test.v9.med') and(x->>'quantity')::numeric=103 and(x->>'procedure_qty')::numeric=3 and(x->>'sale_qty')::numeric=100)
  or not exists(select 1 from jsonb_array_elements(r->'untracked') x where x->>'id'=current_setting('test.v9.zero_med') and(x->>'quantity')::numeric=5) then raise exception 'Untracked billing summary incorrect: %',r->'untracked';end if;
 if(r->>'payment_only_procedures_count')::integer is distinct from 1 or(r->>'payment_only_sales_count')::integer is distinct from 2 or not exists(select 1 from jsonb_array_elements(r->'warnings') x where x->>'type'='payment_only') then raise exception 'Payment-only report warning/count absent';end if;
 summary_n:=public.crm_finance_v5('summary',jsonb_build_object('from',(now() at time zone 'Europe/Moscow')::date,'to',(now() at time zone 'Europe/Moscow')::date,'patient_id',current_setting('test.v9.patient')));
 if(summary_n->'revenue'->>'total')::numeric is distinct from 2500::numeric or summary_n->>'payroll_scope' is distinct from 'not_applicable_to_entity_filter' then raise exception 'Cash summary lost payment-only revenue';end if;
 if(summary_n->>'payment_only_procedures_count')::integer is distinct from 1 or(summary_n->>'payment_only_sales_count')::integer is distinct from 2 then raise exception 'Finance summary omits payment-only counts';end if;
 r:=public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v9.shift')));
 perform set_config('test.v9.closed_report',r::text,true);
 if public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v9.shift')))<>r then raise exception 'Mixed mode closing replay incorrect';end if;
 perform public.crm_finance_v5('settings_save','{"payment_only":true}');
 failed:=false;begin perform public.record_treatment_v5('procedure',current_setting('test.v9.procedure_payload')::jsonb,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Payment-only accepted closed shift';end if;
 if public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v9.shift')))<>r then raise exception 'Mode change recalculated closed snapshot';end if;
end $$;
reset role;
do $$ begin
 if(select count(*) from private.crm_shift_reports where shift_id=current_setting('test.v9.shift')::uuid)<>1 then raise exception 'Duplicate closed report';end if;
 if(select quantity from public.stock where medication_id=current_setting('test.v9.med')::uuid and location='work')<>8 then raise exception 'Mode toggle retroactively deducted past billing';end if;
 if has_table_privilege('authenticated','private.crm_finance_settings','UPDATE') then raise exception 'Direct mode update exposed';end if;
 if has_function_privilege('anon','public.crm_finance_v5(text,jsonb)','EXECUTE') then raise exception 'Anonymous mode API exposed';end if;
 if has_function_privilege('authenticated','public.record_treatment_v3(text,jsonb,uuid)','EXECUTE')
  or has_function_privilege('authenticated','private.record_treatment_v3(text,jsonb,uuid)','EXECUTE') then raise exception 'Migration re-exposed unallocated legacy clinical RPC';end if;
 if(select count(*) from pg_attribute where attrelid in('public.procedures'::regclass,'public.sales'::regclass) and attname='stock_deducted' and attnotnull and atttypid='boolean'::regtype)<>2 then raise exception 'Record mode columns must be non-null booleans';end if;
 -- Lost response replay remains valid after closure and patient archival.
 update public.patients set archived=true,archived_at=now() where id=current_setting('test.v9.patient')::uuid;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.v9.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v9.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare r jsonb;
begin
 r:=public.record_treatment_v5('procedure',current_setting('test.v9.procedure_payload')::jsonb,current_setting('test.v9.procedure_request')::uuid);
 if r is distinct from current_setting('test.v9.procedure_receipt')::jsonb then raise exception 'Closed/archived replay changed receipt';end if;
 if r->'stock_deducted' is distinct from 'false'::jsonb then raise exception 'Closed/archived replay lost boolean mode';end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.crm_finance_v5('accounting_mode');raise exception 'Anonymous mode read allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
