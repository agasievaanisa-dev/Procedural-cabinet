-- Run after crm-stock-correction-v6.sql. All fixtures and changes roll back.
-- Existing staff login metadata is used; existing patients / stock are untouched.
begin;
select set_config('test.v6.manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null limit 1),true);
select set_config('test.v6.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.v6.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v6.manager'),'role','authenticated')::text,true);

do $$ declare med uuid;batch uuid;sh uuid;pt uuid;n uuid;expired_med uuid;expired_batch uuid;
begin
 if nullif(current_setting('test.v6.manager'),'') is null or nullif(current_setting('test.v6.nurse'),'') is null then
  raise exception 'Tests require linked active owner and nurse accounts';
 end if;
 select id into n from public.staff where auth_user_id=current_setting('test.v6.nurse')::uuid and active limit 1;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2092-06-18',now(),now()+interval '8 hours','open') returning id into sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,n);
 insert into public.patients(full_name) values('Тест корректировки v6 — вымышленный пациент') returning id into pt;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('Тест корректировки v6 — ампулы','амп.',100,1000,20,1,1) returning id into med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(med,30,30,10,10,current_date+100) returning id into batch;
 insert into public.stock(medication_id,location,quantity) values(med,'reserve',20),(med,'work',10);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price)
  values('Тест корректировки v6 — просроченные флаконы','фл.',1,5,10) returning id into expired_med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(expired_med,3,3,0,5,current_date-1) returning id into expired_batch;
 insert into public.stock(medication_id,location,quantity) values(expired_med,'reserve',3),(expired_med,'work',0);
 perform set_config('test.v6.med',med::text,true);perform set_config('test.v6.batch',batch::text,true);
 perform set_config('test.v6.shift',sh::text,true);perform set_config('test.v6.patient',pt::text,true);
 perform set_config('test.v6.nurse_id',n::text,true);perform set_config('test.v6.expired_med',expired_med::text,true);
 perform set_config('test.v6.expired_batch',expired_batch::text,true);
end $$;

-- Sell first, so the later correction really exercises existing clinical history.
select set_config('request.jwt.claim.sub',current_setting('test.v6.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v6.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare r jsonb;p jsonb;failed boolean;
begin
 p:=jsonb_build_object('shift_id',current_setting('test.v6.shift'),'nurse_id',current_setting('test.v6.nurse_id'),
  'patient_id',current_setting('test.v6.patient'),'paid_total',40,
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v6.med'),'quantity',2)),
  'payments',jsonb_build_object('terminal',40));
 r:=public.record_treatment_v5('sale',p,gen_random_uuid());
 perform set_config('test.v6.sale',r->>'id',true);
 failed:=false;
 begin perform public.crm_stock_correction_v6('package',jsonb_build_object('id',current_setting('test.v6.med'),
  'units_per_package',10,'expected_units_per_package',100,'reason','Медсестре запрещено'),gen_random_uuid());
 exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse changed package size';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('inventory',jsonb_build_object('id',current_setting('test.v6.med'),
  'batch_id',current_setting('test.v6.batch'),'location','work','actual_quantity',6,'expected_quantity',8,'reason','Медсестре запрещено'),gen_random_uuid());
 exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse corrected stock';end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v6.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v6.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare med uuid:=current_setting('test.v6.med')::uuid;batch uuid:=current_setting('test.v6.batch')::uuid;
 p jsonb;r jsonb;req uuid;failed boolean;bad_value text;
begin
 req:=gen_random_uuid();
 p:=jsonb_build_object('id',med,'units_per_package',10,'expected_units_per_package',100,'reason','Опечатка в количестве ампул в упаковке');
 r:=public.crm_stock_correction_v6('package',p,req);
 if(r->>'before')::numeric<>100 or(r->>'units_per_package')::numeric<>10 then raise exception 'Package correction wrong';end if;
 -- Expected size is now stale, but a retry must return the original response.
 if public.crm_stock_correction_v6('package',p,req)<>r then raise exception 'Package retry not idempotent';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('package',p||jsonb_build_object('units_per_package',5),req);
 exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Same request accepted a changed package payload';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('package',p,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Stale package size accepted';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('package',p-'reason'||jsonb_build_object('expected_units_per_package',10),gen_random_uuid());
 exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Package reason not required';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('package',p-'expected_units_per_package',gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Package expected value not required';end if;
 foreach bad_value in array array['0','-1','0.5','NaN','Infinity'] loop
  failed:=false;
  begin perform public.crm_stock_correction_v6('package',p||jsonb_build_object('units_per_package',bad_value,'expected_units_per_package',10),gen_random_uuid());
  exception when raise_exception then failed:=true;end;
  if not failed then raise exception 'Invalid package value accepted: %',bad_value;end if;
 end loop;
 -- Sale left 8 working ampoules. A counted correction removes exactly 2.
 req:=gen_random_uuid();
 p:=jsonb_build_object('id',med,'batch_id',batch,'location','work','actual_quantity',6,'expected_quantity',8,'reason','Перепутаны цифры при первоначальном вводе');
 r:=public.crm_stock_correction_v6('inventory',p,req);
 if(r->>'difference')::numeric<>-2 or(r->>'quantity')::numeric<>6 then raise exception 'Working correction wrong';end if;
 if public.crm_stock_correction_v6('inventory',p,req)<>r then raise exception 'Inventory retry not idempotent';end if;
 -- Shared v5 accounting replay also returns the saved result without mutations.
 if public.warehouse_v5('inventory',p,req)<>r then raise exception 'Delegated replay not compatible';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('inventory',p||jsonb_build_object('actual_quantity',5),req);exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Same request accepted changed stock payload';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('inventory',p,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Stale stock correction accepted';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('inventory',p-'reason'||jsonb_build_object('expected_quantity',6),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Stock reason not required';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('inventory',p-'expected_quantity',gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Stock expected value not required';end if;
 foreach bad_value in array array['-1','0.5','NaN','Infinity'] loop
  failed:=false;
  begin perform public.crm_stock_correction_v6('inventory',p||jsonb_build_object('actual_quantity',bad_value,'expected_quantity',6),gen_random_uuid());
  exception when raise_exception then failed:=true;end;
  if not failed then raise exception 'Invalid stock value accepted: %',bad_value;end if;
 end loop;
 -- A no-op still has a stable request response, but no inventory movement.
 r:=public.crm_stock_correction_v6('inventory',p||jsonb_build_object('actual_quantity',6,'expected_quantity',6),gen_random_uuid());
 if(r->>'difference')::numeric<>0 then raise exception 'No-op correction wrong';end if;
 r:=public.crm_stock_correction_v6('inventory',jsonb_build_object('id',med,'batch_id',batch,'location','reserve',
  'actual_quantity',23,'expected_quantity',20,'reason','При пересчёте найдены ещё 3 ампулы'),gen_random_uuid());
 if(r->>'difference')::numeric<>3 then raise exception 'Positive stock correction wrong';end if;
 -- New deliveries use the corrected package size, not the old size of 100.
 r:=public.warehouse_v5('receive',jsonb_build_object('id',med,'packages',1,'price',250,'expiry',current_date+200),gen_random_uuid());
 if(r->>'quantity')::numeric<>10 then raise exception 'Receipt ignored corrected package size';end if;
 perform set_config('test.v6.new_batch',r->>'batch_id',true);
 failed:=false;
 begin perform public.crm_stock_correction_v6('inventory',jsonb_build_object('id',current_setting('test.v6.expired_med'),
  'batch_id',current_setting('test.v6.expired_batch'),'location','reserve','actual_quantity',4,'expected_quantity',3,'reason','Просроченное нельзя увеличить'),gen_random_uuid());
 exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Expired stock increase accepted';end if;
 -- Removing expired stock is allowed; zero remains a valid counted balance.
 r:=public.crm_stock_correction_v6('inventory',jsonb_build_object('id',current_setting('test.v6.expired_med'),
  'batch_id',current_setting('test.v6.expired_batch'),'location','reserve','actual_quantity',0,'expected_quantity',3,'reason','Просроченные флаконы удалены'),gen_random_uuid());
 if(r->>'quantity')::numeric<>0 then raise exception 'Zero stock correction not accepted';end if;
end $$;
reset role;

do $$ declare med uuid:=current_setting('test.v6.med')::uuid;batch uuid:=current_setting('test.v6.batch')::uuid;
begin
 perform private.assert_stock_v3(med);
 perform private.assert_stock_v3(current_setting('test.v6.expired_med')::uuid);
 if(select units_per_package from public.medications where id=med)<>10 then raise exception 'Package size not saved';end if;
 if(select consumption_unit from public.medications where id=med)<>'амп.' then raise exception 'Consumption unit changed';end if;
 if(select sale_price from public.medications where id=med)<>20 then raise exception 'Retail price changed';end if;
 if(select purchase_price_per_unit from public.medication_batches where id=batch)<>10 then raise exception 'Historic batch cost changed';end if;
 if(select purchase_price_per_unit from public.medication_batches where id=current_setting('test.v6.new_batch')::uuid)<>25 then raise exception 'New batch cost wrong';end if;
 if(select quantity_received from public.medication_batches where id=batch)<>33 then raise exception 'Correction received quantity wrong';end if;
 if(select quantity_remaining from public.medication_batches where id=batch)<>29 then raise exception 'Corrected batch quantity wrong';end if;
 if(select work_quantity from public.medication_batches where id=batch)<>6 then raise exception 'Corrected batch work quantity wrong';end if;
 if(select quantity from public.stock where medication_id=med and location='work')<>6
  or(select quantity from public.stock where medication_id=med and location='reserve')<>33 then raise exception 'Corrected aggregate stock wrong';end if;
 if(select count(*) from public.stock_movements where medication_id=med and movement_type='correction')<>2 then raise exception 'Repeated correction duplicated movement';end if;
 if(select count(*) from private.crm_audit_log where entity_type='medications' and entity_id=med::text and action='package_corrected')<>1 then raise exception 'Package audit duplicated/missing';end if;
 if not exists(select 1 from private.crm_audit_log where entity_type='medications' and entity_id=med::text and action='package_corrected'
  and actor_user=current_setting('test.v6.manager')::uuid and actor_staff is not null and reason='Опечатка в количестве ампул в упаковке'
  and (before_data->>'units_per_package')::numeric=100 and (after_data->>'units_per_package')::numeric=10) then raise exception 'Package actor/reason audit wrong';end if;
 if(select quantity from public.sale_items where sale_id=current_setting('test.v6.sale')::uuid and medication_id=med)<>2 then raise exception 'Historic sold quantity changed';end if;
 if(select unit_price from public.sale_items where sale_id=current_setting('test.v6.sale')::uuid and medication_id=med)<>20 then raise exception 'Historic sold price changed';end if;
 if(select paid_total from public.sales where id=current_setting('test.v6.sale')::uuid)<>40 then raise exception 'Historic receipt changed';end if;
 if(select sum(quantity) from public.stock_movements where sale_id=current_setting('test.v6.sale')::uuid and medication_id=med)<>2 then raise exception 'Historic sold movement changed';end if;
 if has_function_privilege('anon','public.crm_stock_correction_v6(text,jsonb,uuid)','EXECUTE')
  or has_function_privilege('anon','private.crm_stock_correction_v6(text,jsonb,uuid)','EXECUTE') then raise exception 'Anonymous correction access';end if;
end $$;
rollback;
