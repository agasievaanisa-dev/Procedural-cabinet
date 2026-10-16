-- Transaction-local fixtures only. Run after package receipts v35; every
-- identity, stock receipt, metadata correction and request is rolled back.
begin;
create function pg_temp.v35_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v35 acceptance: %',message;end if;end $$;
create function pg_temp.v35_state(med uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('medication',(select to_jsonb(m) from public.medications m where m.id=med),
  'stock',(select coalesce(jsonb_agg(to_jsonb(s) order by s.location),'[]') from public.stock s where s.medication_id=med),
  'batches',(select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]') from public.medication_batches b where b.medication_id=med),
  'movements',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.stock_movements s where s.medication_id=med),
  'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from private.warehouse_requests r where r.payload->>'id'=med::text),
  'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from private.crm_audit_log a where a.entity_id=med::text));
$$;

do $$declare owner_u uuid:=gen_random_uuid();nurse_u uuid:=gen_random_uuid();inactive_u uuid:=gen_random_uuid();
 med uuid;measured uuid;archived uuid;overflow_med uuid;batch uuid;
begin
 insert into auth.users(id,email) values(owner_u,owner_u::text||'@package-v35.example.invalid'),
  (nurse_u,nurse_u::text||'@package-v35.example.invalid'),(inactive_u,inactive_u::text||'@package-v35.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values
  ('TEST package v35 owner','owner',true,owner_u),('TEST package v35 nurse','nurse',true,nurse_u),
  ('TEST package v35 inactive owner','owner',false,inactive_u);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST package v35 ampoule','амп.',1,7,333,0,0) returning id into med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(med,14,14,4,7,current_date+365) returning id into batch;
 insert into public.stock(medication_id,location,quantity) values(med,'reserve',10),(med,'work',4);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST package v35 measured','мг',5,0,1500,0,0) returning id into measured;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold,active)
  values('TEST package v35 archived','амп.',1,0,10,0,0,false) returning id into archived;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST package v35 aggregate overflow','амп.',1,0,10,0,0) returning id into overflow_med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(overflow_med,999999999,999999999,0,0,current_date+365);
 insert into public.stock(medication_id,location,quantity) values(overflow_med,'reserve',999999999),(overflow_med,'work',0);
 perform set_config('test.v35.owner',owner_u::text,true);perform set_config('test.v35.nurse',nurse_u::text,true);
 perform set_config('test.v35.inactive',inactive_u::text,true);perform set_config('test.v35.med',med::text,true);
 perform set_config('test.v35.measured',measured::text,true);perform set_config('test.v35.archived',archived::text,true);
 perform set_config('test.v35.overflow',overflow_med::text,true);
 perform set_config('test.v35.old_batch',batch::text,true);
 perform set_config('test.v35.old_batch_data',(select to_jsonb(b)::text from public.medication_batches b where id=batch),true);
 perform set_config('request.jwt.claim.sub',owner_u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_u,'role','authenticated')::text,true);
end $$;

set local role authenticated;
do $$declare med uuid:=current_setting('test.v35.med')::uuid;req uuid:=gen_random_uuid();p jsonb;r jsonb;before_n jsonb;
 bad_payload jsonb;failed boolean;bad text;
begin
 p:=jsonb_build_object('id',med,'packages',2,'units_per_package',5,'expected_units_per_package',1,
  'price',250,'expiry',current_date+365,'batch_number','TEST-V35','supplier','TEST supplier','received_date',current_date);
 r:=public.warehouse_v5('receive',p,req);
 perform pg_temp.v35_assert((r->>'quantity')::numeric=10 and r->>'batch_id' is not null,'2 packs of 5 did not receive 10 units');
 before_n:=pg_temp.v35_state(med);
 perform pg_temp.v35_assert(public.warehouse_v5('receive',p,req)=r,'Lost-reply retry did not return original response');
 perform pg_temp.v35_assert(pg_temp.v35_state(med)=before_n,'Lost-reply retry duplicated stock, costs or audit');
 perform set_config('test.v35.payload',p::text,true);perform set_config('test.v35.request',req::text,true);
 perform set_config('test.v35.result',r::text,true);perform set_config('test.v35.new_batch',r->>'batch_id',true);
 perform pg_temp.v35_assert((before_n->'medication'->>'units_per_package')::numeric=5
  and (before_n->'medication'->>'sale_price')::numeric=333,'Package correction changed sale price or did not persist size');
 perform pg_temp.v35_assert(exists(select 1 from jsonb_array_elements(before_n->'stock') x where x->>'location'='reserve' and (x->>'quantity')::numeric=20)
  and exists(select 1 from jsonb_array_elements(before_n->'stock') x where x->>'location'='work' and (x->>'quantity')::numeric=4),
  'Existing stock was multiplied or work stock changed');
 perform pg_temp.v35_assert(exists(select 1 from jsonb_array_elements(before_n->'batches') x where x->>'id'=r->>'batch_id'
  and (x->>'purchase_price_per_unit')::numeric=50 and (x->>'quantity_received')::numeric=10
  and x->>'batch_number'='TEST-V35' and x->>'supplier'='TEST supplier'),'New batch package price divisor or metadata is wrong');

 -- Same request with changed data and stale independent requests must reject
 -- before leaving any metadata, ledger, stock, batch or audit changes.
 failed:=false;
 begin perform public.warehouse_v5('receive',p||jsonb_build_object('packages',3),req);exception when others then failed:=true;end;
 perform pg_temp.v35_assert(failed and pg_temp.v35_state(med)=before_n,'Changed-payload retry mutated stock');
 for bad_payload in select value from jsonb_array_elements(jsonb_build_array(
  p, p-'expected_units_per_package',p-'units_per_package',
  p||jsonb_build_object('units_per_package',0,'expected_units_per_package',5),
  p||jsonb_build_object('units_per_package',-1,'expected_units_per_package',5),
  p||jsonb_build_object('units_per_package',1.5,'expected_units_per_package',5),
  p||jsonb_build_object('units_per_package','NaN','expected_units_per_package',5),
  p||jsonb_build_object('units_per_package','Infinity','expected_units_per_package',5),
  p||jsonb_build_object('units_per_package',10,'expected_units_per_package',null),
  p||jsonb_build_object('units_per_package',10,'expected_units_per_package',5,'packages',0),
  p||jsonb_build_object('units_per_package',10,'expected_units_per_package',5,'packages',1.5),
  p||jsonb_build_object('units_per_package',10,'expected_units_per_package',5,'packages','NaN'),
  p||jsonb_build_object('units_per_package',999999999,'expected_units_per_package',5),
  p||jsonb_build_object('units_per_package',10,'expected_units_per_package',5,'expiry',current_date-1),
  p||jsonb_build_object('units_per_package',10,'expected_units_per_package',5,'price',-1),
  p||jsonb_build_object('units_per_package',10,'expected_units_per_package',5,'received_date',current_date+1)
 )) loop
  failed:=false;
  begin perform public.warehouse_v5('receive',bad_payload,gen_random_uuid());exception when others then failed:=true;end;
  perform pg_temp.v35_assert(failed and pg_temp.v35_state(med)=before_n,'Invalid receipt/CAS partially changed state: '||bad_payload::text);
 end loop;

 -- Opening in packs: validate the client's displayed total, but do not
 -- multiply that total again. Mismatched quantity rolls back size correction.
 p:=jsonb_build_object('id',med,'quantity',9,'packages',2,'units_per_package',10,'expected_units_per_package',5,
  'location','work','price',100,'expiry',current_date+365);
 failed:=false;
 begin perform public.warehouse_v5('opening',p,gen_random_uuid());exception when others then failed:=true;end;
 perform pg_temp.v35_assert(failed and pg_temp.v35_state(med)=before_n,'Mismatched opening changed package size or stock');
 for bad_payload in select value from jsonb_array_elements(jsonb_build_array(
  p||jsonb_build_object('packages',0),p||jsonb_build_object('packages',1.5),
  p||jsonb_build_object('packages','NaN'),p||jsonb_build_object('packages','Infinity'),
  p||jsonb_build_object('quantity',null),p||jsonb_build_object('quantity',20,'units_per_package',10,'expected_units_per_package',1)
 )) loop
  failed:=false;
  begin perform public.warehouse_v5('opening',bad_payload,gen_random_uuid());exception when others then failed:=true;end;
  perform pg_temp.v35_assert(failed and pg_temp.v35_state(med)=before_n,'Invalid pack opening partially changed state');
 end loop;
 p:=p||jsonb_build_object('quantity',10,'units_per_package',5);
 r:=public.warehouse_v5('opening',p,gen_random_uuid());
 perform pg_temp.v35_assert((r->>'quantity')::numeric=10 and r->>'location'='work','Pack opening did not add exactly 10 units');
 -- An omitted quantity is derived authoritatively from the package count.
 p:=(p-'quantity')||jsonb_build_object('packages',3,'units_per_package',2,'expected_units_per_package',5,'location','reserve');
 req:=gen_random_uuid();r:=public.warehouse_v5('opening',p,req);
 perform pg_temp.v35_assert((r->>'quantity')::numeric=6,'Opening without supplied total did not derive 3 x 2');
 before_n:=pg_temp.v35_state(med);
 perform pg_temp.v35_assert(public.warehouse_v5('opening',p,req)=r and pg_temp.v35_state(med)=before_n,'Opening exact retry was not idempotent');
 -- Individual units remain units even when correcting size in the same save.
 p:=(p-'packages')||jsonb_build_object('quantity',3,'units_per_package',10,'expected_units_per_package',2,'location','work','price',50);
 r:=public.warehouse_v5('opening',p,gen_random_uuid());
 perform pg_temp.v35_assert((r->>'quantity')::numeric=3,'Individual-unit opening was multiplied by package size');
 -- Compatibility for older clients which provide no new package metadata.
 r:=public.warehouse_v5('receive',jsonb_build_object('id',med,'packages',1,'price',100,'expiry',current_date+365),gen_random_uuid());
 perform pg_temp.v35_assert((r->>'quantity')::numeric=10,'Legacy package receipt no longer works');
 r:=public.warehouse_v5('opening',jsonb_build_object('id',current_setting('test.v35.measured'),
  'quantity',2.5,'units_per_package',10,'expected_units_per_package',5,'location','work','price',100,'expiry',current_date+365),gen_random_uuid());
 perform pg_temp.v35_assert((r->>'quantity')::numeric=2.5,'Measured units were rounded or multiplied');
 before_n:=pg_temp.v35_state(current_setting('test.v35.archived')::uuid);
 failed:=false;
 begin perform public.warehouse_v5('receive',jsonb_build_object('id',current_setting('test.v35.archived'),
  'packages',2,'units_per_package',5,'expected_units_per_package',1,'price',0,'expiry',current_date+365),gen_random_uuid());
 exception when others then failed:=true;end;
 perform pg_temp.v35_assert(failed and pg_temp.v35_state(current_setting('test.v35.archived')::uuid)=before_n,'Archived card accepted receipt');
 -- The incoming quantity can be valid while the resulting numeric(12,3)
 -- aggregate overflows. That failure must roll back the package correction,
 -- freshly inserted batch, request claim and audit as one transaction.
 before_n:=pg_temp.v35_state(current_setting('test.v35.overflow')::uuid);
 failed:=false;
 begin perform public.warehouse_v5('receive',jsonb_build_object('id',current_setting('test.v35.overflow'),
  'packages',1,'units_per_package',2,'expected_units_per_package',1,'price',10,'expiry',current_date+365),gen_random_uuid());
 exception when numeric_value_out_of_range then failed:=true;end;
 perform pg_temp.v35_assert(failed and pg_temp.v35_state(current_setting('test.v35.overflow')::uuid)=before_n,'Aggregate overflow partially saved receipt');
end $$;
reset role;

do $$declare med uuid:=current_setting('test.v35.med')::uuid;
begin
 perform private.assert_stock_v3(med);
 perform private.assert_stock_v3(current_setting('test.v35.measured')::uuid);
 perform pg_temp.v35_assert((select to_jsonb(b) from public.medication_batches b where id=current_setting('test.v35.old_batch')::uuid)
  =current_setting('test.v35.old_batch_data')::jsonb,'Historical batch quantities or cost changed');
 perform pg_temp.v35_assert((select quantity from public.stock where medication_id=med and location='reserve')=36
  and (select quantity from public.stock where medication_id=med and location='work')=17,'Final physical totals are wrong');
 perform pg_temp.v35_assert((select count(*) from private.crm_audit_log where entity_id=med::text and action='package_corrected')=3,
  'Package correction audit duplicated or missing');
 perform set_config('test.v35.final_state',pg_temp.v35_state(med)::text,true);
end $$;

-- Authorization is rechecked before cached receipts for every current actor.
select set_config('request.jwt.claim.sub',current_setting('test.v35.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v35.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare failed boolean;
begin
 failed:=false;
 begin perform public.warehouse_v5('receive',current_setting('test.v35.payload')::jsonb,current_setting('test.v35.request')::uuid);
 exception when others then failed:=true;end;
 perform pg_temp.v35_assert(failed,'Nurse could read manager receipt');
 failed:=false;
 begin perform public.warehouse_v5('receive',current_setting('test.v35.payload')::jsonb,gen_random_uuid());
 exception when others then failed:=true;end;
 perform pg_temp.v35_assert(failed,'Nurse could receive stock or change package metadata');
end $$;
reset role;
update public.staff set active=false where auth_user_id=current_setting('test.v35.owner')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.v35.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v35.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare failed boolean;
begin
 failed:=false;
 begin perform public.warehouse_v5('receive',current_setting('test.v35.payload')::jsonb,current_setting('test.v35.request')::uuid);
 exception when others then failed:=true;end;
 perform pg_temp.v35_assert(failed,'Inactive owner received cached stock receipt');
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$declare failed boolean;
begin
 failed:=false;
 begin perform public.warehouse_v5('receive',current_setting('test.v35.payload')::jsonb,current_setting('test.v35.request')::uuid);
 exception when others then failed:=true;end;
 perform pg_temp.v35_assert(failed,'Anonymous stock receipt request succeeded');
end $$;
reset role;
select pg_temp.v35_assert(pg_temp.v35_state(current_setting('test.v35.med')::uuid)=current_setting('test.v35.final_state')::jsonb,
 'Unauthorized requests changed stock, metadata, history or requests');
rollback;
