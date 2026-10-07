-- Price editing regression for the existing warehouse_v5 save endpoint.
-- Only linked staff login metadata is read. All medication, patient, shift,
-- procedure and sale fixtures are synthetic and the transaction rolls back.
begin;
select set_config('test.price.manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null limit 1),true);
select set_config('test.price.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.price.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.price.manager'),'role','authenticated')::text,true);

do $$ declare med uuid;batch uuid;sh uuid;pt uuid;sv uuid;n uuid;p jsonb;
begin
 if nullif(current_setting('test.price.manager'),'') is null or nullif(current_setting('test.price.nurse'),'') is null then
  raise exception 'Tests require linked active owner and nurse accounts';end if;
 select id into n from public.staff where auth_user_id=current_setting('test.price.nurse')::uuid and active limit 1;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2094-08-11',now(),now()+interval '8 hours','open') returning id into sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,n);
 insert into public.patients(full_name) values('Тест изменения цен — вымышленный пациент') returning id into pt;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('Тест изменения цен — услуга',100,0,true) returning id into sv;
 insert into public.medications(name,consumption_unit,purchase_unit,units_per_package,purchase_price,sale_price,
  min_total_stock,work_threshold,lead_time_days,manufacturer_country,manufacturer,release_form,comment,generic_name,category,search_name,dosage)
  values('Тест изменения цен — ампулы','амп.','упаковка',10,100,20,2,1,3,'Тестовая страна','Тестовый производитель',
   'Ампула','Сохранить комментарий','Вымышленное МНН','Тестовая категория','Тест цены','10 мг') returning id into med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(med,30,30,10,10,current_date+100) returning id into batch;
 insert into public.stock(medication_id,location,quantity) values(med,'reserve',20),(med,'work',10);
 p:=jsonb_build_object('id',med,'name','Тест изменения цен — ампулы','unit','амп.','units_per_package',10,
  'purchase_price',150.50,'sale_price',35.75,'min_total_stock',2,'work_threshold',1,'lead_time_days',3,
  'country','Тестовая страна','manufacturer','Тестовый производитель','release_form','Ампула','comment','Сохранить комментарий',
  'generic_name','Вымышленное МНН','category','Тестовая категория','search_name','Тест цены','dosage','10 мг');
 perform set_config('test.price.med',med::text,true);perform set_config('test.price.batch',batch::text,true);
 perform set_config('test.price.shift',sh::text,true);perform set_config('test.price.patient',pt::text,true);
 perform set_config('test.price.service',sv::text,true);perform set_config('test.price.nurse_id',n::text,true);
 perform set_config('test.price.payload',p::text,true);
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.price.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.price.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare p jsonb;r jsonb;failed boolean:=false;
begin
 begin perform public.warehouse_v5('save',current_setting('test.price.payload')::jsonb,gen_random_uuid());
 exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse changed medication prices';end if;
 p:=jsonb_build_object('shift_id',current_setting('test.price.shift'),'nurse_id',current_setting('test.price.nurse_id'),
  'patient_id',current_setting('test.price.patient'),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.price.med'),'quantity',2)),
  'paid_total',40,'payments',jsonb_build_object('terminal',40));
 r:=public.record_treatment_v5('sale',p,gen_random_uuid());perform set_config('test.price.old_sale',r->>'id',true);
 p:=p||jsonb_build_object('service_id',current_setting('test.price.service'),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.price.med'),'quantity',1)),
  'paid_total',120,'payments',jsonb_build_object('terminal',120));
 r:=public.record_treatment_v5('procedure',p,gen_random_uuid());perform set_config('test.price.old_procedure',r->>'id',true);
end $$;
reset role;

-- Snapshot the counted stock and original batch before the price-only edit.
select set_config('test.price.stock_snapshot',(select jsonb_agg(to_jsonb(s) order by location)::text from public.stock s where medication_id=current_setting('test.price.med')::uuid),true);
select set_config('test.price.batch_snapshot',(select to_jsonb(b)::text from public.medication_batches b where id=current_setting('test.price.batch')::uuid),true);
select set_config('request.jwt.claim.sub',current_setting('test.price.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.price.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare p jsonb:=current_setting('test.price.payload')::jsonb;r jsonb;req uuid:=gen_random_uuid();failed boolean;field_name text;bad_value text;
begin
 r:=public.warehouse_v5('save',p,req);
 if(r->>'id')::uuid<>current_setting('test.price.med')::uuid then raise exception 'Price edit created a different medication';end if;
 if public.warehouse_v5('save',p,req)<>r then raise exception 'Price edit retry is not idempotent';end if;
 failed:=false;
 begin perform public.warehouse_v5('save',p||jsonb_build_object('sale_price',99),req);exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Same request accepted different prices';end if;
 foreach field_name in array array['purchase_price','sale_price'] loop
  foreach bad_value in array array['-1','NaN','Infinity'] loop
   failed:=false;
   begin perform public.warehouse_v5('save',p||jsonb_build_object(field_name,bad_value),gen_random_uuid());exception when raise_exception then failed:=true;end;
   if not failed then raise exception 'Invalid % accepted: %',field_name,bad_value;end if;
  end loop;
 end loop;
end $$;
reset role;

do $$ declare med uuid:=current_setting('test.price.med')::uuid;
begin
 if(select jsonb_agg(to_jsonb(s) order by location) from public.stock s where medication_id=med) is distinct from current_setting('test.price.stock_snapshot')::jsonb then
  raise exception 'Price edit changed counted stock';end if;
 if(select to_jsonb(b) from public.medication_batches b where id=current_setting('test.price.batch')::uuid) is distinct from current_setting('test.price.batch_snapshot')::jsonb then
  raise exception 'Price edit changed an existing batch';end if;
 if not exists(select 1 from public.medications where id=med and purchase_price=150.50 and sale_price=35.75 and units_per_package=10 and consumption_unit='амп.'
  and manufacturer='Тестовый производитель' and manufacturer_country='Тестовая страна' and release_form='Ампула' and comment='Сохранить комментарий'
  and generic_name='Вымышленное МНН' and category='Тестовая категория' and search_name='Тест цены' and dosage='10 мг') then raise exception 'Price/metadata save failed';end if;
 if(select count(*) from private.crm_audit_log where entity_type='medications' and entity_id=med::text and action='update')<>1 then raise exception 'Price audit duplicated or missing';end if;
 if not exists(select 1 from private.crm_audit_log where entity_type='medications' and entity_id=med::text and action='update'
  and actor_user=current_setting('test.price.manager')::uuid and actor_staff is not null
  and (before_data->>'purchase_price')::numeric=100 and (after_data->>'purchase_price')::numeric=150.50
  and (before_data->>'sale_price')::numeric=20 and (after_data->>'sale_price')::numeric=35.75) then raise exception 'Price audit actor/before/after wrong';end if;
end $$;

-- Later operations use the new price; the completed operations retain old prices.
select set_config('request.jwt.claim.sub',current_setting('test.price.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.price.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare p jsonb;r jsonb;
begin
 p:=jsonb_build_object('shift_id',current_setting('test.price.shift'),'nurse_id',current_setting('test.price.nurse_id'),
  'patient_id',current_setting('test.price.patient'),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.price.med'),'quantity',2)),
  'paid_total',71.50,'payments',jsonb_build_object('terminal',71.50));
 r:=public.record_treatment_v5('sale',p,gen_random_uuid());perform set_config('test.price.new_sale',r->>'id',true);
 p:=p||jsonb_build_object('service_id',current_setting('test.price.service'),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.price.med'),'quantity',1)),
  'paid_total',135.75,'payments',jsonb_build_object('terminal',135.75));
 r:=public.record_treatment_v5('procedure',p,gen_random_uuid());perform set_config('test.price.new_procedure',r->>'id',true);
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.price.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.price.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare r jsonb;
begin
 r:=public.warehouse_v5('receive',jsonb_build_object('id',current_setting('test.price.med'),'packages',1,'price',150.50,'expiry',current_date+200),gen_random_uuid());
 if(r->>'quantity')::numeric<>10 then raise exception 'Price edit changed package conversion';end if;
 perform set_config('test.price.new_batch',r->>'batch_id',true);
end $$;
reset role;

do $$ declare med uuid:=current_setting('test.price.med')::uuid;
begin
 perform private.assert_stock_v3(med);
 if(select purchase_price_per_unit from public.medication_batches where id=current_setting('test.price.batch')::uuid)<>10 then raise exception 'Historic batch cost changed';end if;
 if(select purchase_price_per_unit from public.medication_batches where id=current_setting('test.price.new_batch')::uuid)<>15.05 then raise exception 'New purchase price is not per package';end if;
 if(select unit_price from public.sale_items where sale_id=current_setting('test.price.old_sale')::uuid and medication_id=med)<>20
  or(select paid_total from public.sales where id=current_setting('test.price.old_sale')::uuid)<>40 then raise exception 'Historic sale repriced';end if;
 if(select unit_price from public.procedure_medications where procedure_id=current_setting('test.price.old_procedure')::uuid and medication_id=med)<>20
  or(select paid_total from public.procedures where id=current_setting('test.price.old_procedure')::uuid)<>120 then raise exception 'Historic procedure repriced';end if;
 if(select unit_price from public.sale_items where sale_id=current_setting('test.price.new_sale')::uuid and medication_id=med)<>35.75
  or(select paid_total from public.sales where id=current_setting('test.price.new_sale')::uuid)<>71.50 then raise exception 'New sale ignored unit price';end if;
 if(select unit_price from public.procedure_medications where procedure_id=current_setting('test.price.new_procedure')::uuid and medication_id=med)<>35.75
  or(select paid_total from public.procedures where id=current_setting('test.price.new_procedure')::uuid)<>135.75 then raise exception 'New procedure ignored unit price';end if;
 if(select quantity from public.stock where medication_id=med and location='work')<>4
  or(select quantity from public.stock where medication_id=med and location='reserve')<>30 then raise exception 'Stock changed beyond treatment and receipt quantities';end if;
 if has_function_privilege('anon','public.warehouse_v5(text,jsonb,uuid)','EXECUTE') or has_function_privilege('anon','private.warehouse_v5(text,jsonb,uuid)','EXECUTE') then
  raise exception 'Anonymous warehouse price access';end if;
end $$;
rollback;
