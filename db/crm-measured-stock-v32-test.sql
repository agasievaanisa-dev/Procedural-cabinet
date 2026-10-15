-- Measured owner stock lifecycle. Every user, medication and mutation below is
-- fictional and transaction-local. Run after measured quantity v31 and stock v32.
begin;

do $$declare owner_user uuid:=gen_random_uuid();nurse_user uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values
  (owner_user,'measured-stock-v32-owner-'||owner_user::text||'@example.invalid'),
  (nurse_user,'measured-stock-v32-nurse-'||nurse_user::text||'@example.invalid');
 insert into public.staff(full_name,role,auth_user_id) values
  ('TEST measured stock v32 owner','owner',owner_user),
  ('TEST measured stock v32 nurse','nurse',nurse_user);
 perform set_config('test.v32.owner',owner_user::text,true);
 perform set_config('test.v32.nurse',nurse_user::text,true);
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_user,'role','authenticated')::text,true);
end $$;

set local role authenticated;
do $$declare med uuid;amp uuid;direct_med uuid;batch uuid;direct_batch uuid;
 p jsonb;r jsonb;req uuid;failed boolean;bad text;
begin
 -- Create through the existing owner RPC; the client cannot substitute a unit
 -- in individual operations, so the medication row remains authoritative.
 r:=public.warehouse_v5('save',jsonb_build_object('name','TEST v32 measured mg — rollback',
  'unit','мг','units_per_package',10,'purchase_price',100,'sale_price',1500,
  'min_total_stock',0,'work_threshold',0,'lead_time_days',3),gen_random_uuid());
 med:=(r->>'id')::uuid;
 r:=public.warehouse_v5('save',jsonb_build_object('name','TEST v32 whole amp — rollback',
  'unit','амп.','units_per_package',10,'purchase_price',100,'sale_price',200,
  'min_total_stock',0,'work_threshold',0,'lead_time_days',3),gen_random_uuid());
 amp:=(r->>'id')::uuid;
 r:=public.warehouse_v5('save',jsonb_build_object('name','TEST v32 direct counted mg — rollback',
  'unit','мг','units_per_package',10,'purchase_price',100,'sale_price',1300,
  'min_total_stock',0,'work_threshold',0,'lead_time_days',3),gen_random_uuid());
 direct_med:=(r->>'id')::uuid;
 perform set_config('test.v32.med',med::text,true);
 perform set_config('test.v32.amp',amp::text,true);
 perform set_config('test.v32.direct_med',direct_med::text,true);

 req:=gen_random_uuid();
 p:=jsonb_build_object('id',med,'quantity',10.5,'location','reserve','price',100,'expiry',current_date+100);
 r:=public.warehouse_v5('opening',p,req);batch:=(r->>'batch_id')::uuid;
 if (r->>'quantity')::numeric is distinct from 10.5 or batch is null then raise exception 'Measured opening lost its quantity or batch';end if;
 if public.warehouse_v5('opening',p,req) is distinct from r then raise exception 'Measured opening retry changed response';end if;
 perform set_config('test.v32.batch',batch::text,true);
 r:=public.warehouse_v5('opening',jsonb_build_object('id',amp,'quantity',10,'location','reserve','price',100,'expiry',current_date+100),gen_random_uuid());
 perform set_config('test.v32.amp_batch',r->>'batch_id',true);
 r:=public.warehouse_v5('opening',jsonb_build_object('id',direct_med,'quantity',2.125,'location','work','price',100,'expiry',current_date+100),gen_random_uuid());
 direct_batch:=(r->>'batch_id')::uuid;
 perform set_config('test.v32.direct_batch',direct_batch::text,true);

 req:=gen_random_uuid();p:=jsonb_build_object('id',med,'quantity',2.5,'comment','TEST v32 move measured mg');
 r:=public.warehouse_v5('transfer',p,req);
 if (r->>'quantity')::numeric is distinct from 2.5 then raise exception 'Measured transfer quantity changed';end if;
 if public.warehouse_v5('transfer',p,req) is distinct from r then raise exception 'Measured transfer retry changed response';end if;

 req:=gen_random_uuid();p:=jsonb_build_object('id',med,'batch_id',batch,'location','work',
  'actual_quantity',2.25,'expected_quantity',2.5,'reason','TEST v32 exact counted mg');
 r:=public.crm_stock_correction_v6('inventory',p,req);
 if (r->>'before')::numeric is distinct from 2.5 or (r->>'quantity')::numeric is distinct from 2.25
  or (r->>'difference')::numeric is distinct from -0.25 then raise exception 'Measured counted correction rounded quantities';end if;
 if public.crm_stock_correction_v6('inventory',p,req) is distinct from r
  or public.warehouse_v5('inventory',p,req) is distinct from r then raise exception 'Measured counted retry duplicated mutation';end if;

 -- Total correction moves only 0.5 mg between existing locations. It must not
 -- demand an expiry for a net-zero movement or silently round either balance.
 req:=gen_random_uuid();p:=jsonb_build_object('id',med,'expected_reserve',8,'expected_work',2.25,
  'reserve',7.5,'work',2.75,'reason','TEST v32 exact total balances');
 r:=public.crm_stock_totals_v18(p,req);
 if (r->>'reserve_qty')::numeric is distinct from 7.5 or (r->>'work_qty')::numeric is distinct from 2.75
  or (r->>'total_qty')::numeric is distinct from 10.25 then raise exception 'Measured total correction lost fractions';end if;
 if public.crm_stock_totals_v18(p,req) is distinct from r then raise exception 'Measured total retry changed response';end if;
 failed:=false;
 begin perform public.crm_stock_totals_v18(p,gen_random_uuid());exception when serialization_failure then failed:=true;end;
 if not failed then raise exception 'Measured totals accepted stale expected balances';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('inventory',jsonb_build_object('id',med,'batch_id',batch,
  'location','work','actual_quantity',2.5,'expected_quantity',2.25,'reason','TEST stale correction'),gen_random_uuid());
 exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Measured inventory accepted stale expected quantity';end if;

 -- Direct v5 inventory is also reachable by older owner clients.
 p:=jsonb_build_object('id',direct_med,'batch_id',direct_batch,'location','work',
  'actual_quantity',2.375,'reason','TEST v32 direct fractional count');req:=gen_random_uuid();
 r:=public.warehouse_v5('inventory',p,req);
 if (r->>'difference')::numeric is distinct from 0.25 then raise exception 'Direct measured inventory lost its positive fraction';end if;
 if public.warehouse_v5('inventory',p,req) is distinct from r then raise exception 'Direct measured inventory retry changed response';end if;
 r:=public.warehouse_v5('inventory',p||jsonb_build_object('actual_quantity',2.001),gen_random_uuid());
 if (r->>'quantity')::numeric is distinct from 2.001 or (r->>'difference')::numeric is distinct from -0.374 then
  raise exception 'Direct measured inventory did not retain three decimals';end if;
 r:=public.crm_stock_correction_v6('inventory',jsonb_build_object('id',direct_med,'batch_id',direct_batch,
  'location','work','actual_quantity',0,'expected_quantity',2.001,'reason','TEST v32 zero counted balance'),gen_random_uuid());
 if (r->>'quantity')::numeric is distinct from 0 then raise exception 'Measured zero count rejected';end if;

 -- Valid measured stock does not make packages fractional.
 failed:=false;
 begin perform public.warehouse_v5('receive',jsonb_build_object('id',med,'packages',1.5,'price',100,'expiry',current_date+100),gen_random_uuid());
 exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Fractional package receipt accepted';end if;
 failed:=false;
 begin perform public.warehouse_v5('save',jsonb_build_object('id',med,'name','TEST invalid fractional package',
  'unit','мг','units_per_package',1.5,'purchase_price',100,'sale_price',1500,'min_total_stock',0,'work_threshold',0,'lead_time_days',3),gen_random_uuid());
 exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Fractional package size accepted';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('package',jsonb_build_object('id',med,'units_per_package',1.5,
  'expected_units_per_package',10,'reason','TEST invalid package correction'),gen_random_uuid());
 exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Fractional corrected package size accepted';end if;

 foreach bad in array array['-1','0','0.0001','2.5001','NaN','Infinity','-Infinity'] loop
  failed:=false;
  begin perform public.warehouse_v5('opening',jsonb_build_object('id',med,'quantity',bad,
   'location','reserve','price',100,'expiry',current_date+100),gen_random_uuid());
  exception when raise_exception or invalid_parameter_value then failed:=true;end;
  if not failed then raise exception 'Invalid measured opening accepted: %',bad;end if;
 end loop;
 foreach bad in array array['-1','0.0001','2.5001','NaN','Infinity','-Infinity'] loop
  failed:=false;
  begin perform public.warehouse_v5('inventory',jsonb_build_object('id',med,'batch_id',batch,'location','work',
   'actual_quantity',bad,'reason','TEST invalid measured direct count'),gen_random_uuid());
  exception when raise_exception or invalid_parameter_value then failed:=true;end;
  if not failed then raise exception 'Invalid measured direct count accepted: %',bad;end if;
  failed:=false;
  begin perform public.crm_stock_totals_v18(jsonb_build_object('id',med,'expected_reserve',7.5,'expected_work',2.75,
   'reserve',bad,'work',2.75,'expiry_date',current_date+100),gen_random_uuid());
  exception when raise_exception or invalid_parameter_value then failed:=true;end;
  if not failed then raise exception 'Invalid measured total accepted: %',bad;end if;
 end loop;

 -- Fractions stay prohibited for ordinary ampoules across all owner routes.
 failed:=false;
 begin perform public.warehouse_v5('opening',jsonb_build_object('id',amp,'quantity',0.5,'location','reserve','price',100,'expiry',current_date+100),gen_random_uuid());
 exception when raise_exception or invalid_parameter_value then failed:=true;end;
 if not failed then raise exception 'Ordinary fractional opening accepted';end if;
 failed:=false;
 begin perform public.warehouse_v5('transfer',jsonb_build_object('id',amp,'quantity',0.5),gen_random_uuid());
 exception when raise_exception or invalid_parameter_value then failed:=true;end;
 if not failed then raise exception 'Ordinary fractional transfer accepted';end if;
 failed:=false;
 begin perform public.warehouse_v5('inventory',jsonb_build_object('id',amp,'batch_id',current_setting('test.v32.amp_batch'),
  'location','reserve','actual_quantity',9.5,'reason','TEST invalid whole count'),gen_random_uuid());
 exception when raise_exception or invalid_parameter_value then failed:=true;end;
 if not failed then raise exception 'Ordinary fractional v5 inventory accepted';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('inventory',jsonb_build_object('id',amp,'batch_id',current_setting('test.v32.amp_batch'),
  'location','reserve','actual_quantity',9.5,'expected_quantity',10,'reason','TEST invalid whole correction'),gen_random_uuid());
 exception when raise_exception or invalid_parameter_value then failed:=true;end;
 if not failed then raise exception 'Ordinary fractional v6 correction accepted';end if;
 failed:=false;
 begin perform public.crm_stock_totals_v18(jsonb_build_object('id',amp,'expected_reserve',10,'expected_work',0,
  'reserve',9.5,'work',0),gen_random_uuid());exception when raise_exception or invalid_parameter_value then failed:=true;end;
 if not failed then raise exception 'Ordinary fractional total accepted';end if;
 failed:=false;
 begin perform public.crm_stock_totals_v18(jsonb_build_object('id',amp,'expected_reserve',9.5,'expected_work',0,
  'reserve',10,'work',0),gen_random_uuid());exception when raise_exception or invalid_parameter_value then failed:=true;end;
 if not failed then raise exception 'Ordinary fractional expected total accepted';end if;
 failed:=false;
 begin perform public.crm_medication_delete_v7('delete',jsonb_build_object('id',amp,'expected_reserve',9.5,
  'expected_work',0,'reason','TEST invalid ordinary delete'),gen_random_uuid());
 exception when raise_exception or invalid_parameter_value then failed:=true;end;
 if not failed then raise exception 'Ordinary fractional deletion expectation accepted';end if;
end $$;
reset role;

-- Database-only checks supplement RPC coverage without mutating real records.
do $$declare failed boolean;med uuid:=current_setting('test.v32.med')::uuid;
begin
 perform private.assert_stock_v3(med);
 perform private.assert_stock_v3(current_setting('test.v32.amp')::uuid);
 perform private.assert_stock_v3(current_setting('test.v32.direct_med')::uuid);
 if not exists(select 1 from public.stock where medication_id=med and location='reserve' and quantity=7.5)
  or not exists(select 1 from public.stock where medication_id=med and location='work' and quantity=2.75) then raise exception 'Failed owner requests altered measured balances';end if;
 if not exists(select 1 from public.medication_batches where id=current_setting('test.v32.batch')::uuid
  and quantity_received=10.5 and quantity_remaining=10.25 and work_quantity=2.75 and purchase_price_per_unit=10) then
  raise exception 'Measured batch cost, received quantity or balances changed unexpectedly';end if;
 if not exists(select 1 from public.medications where id=med and units_per_package=10 and consumption_unit='мг' and sale_price=1500) then
  raise exception 'Measured medication metadata changed';end if;
 if exists(select 1 from public.stock where medication_id=current_setting('test.v32.amp')::uuid and quantity<>case when location='reserve' then 10 else 0 end) then
  raise exception 'Rejected ordinary fractions altered whole-unit stock';end if;
 failed:=false;
 begin
  insert into private.crm_deleted_medications_v7(medication_id,previous_active,medication_snapshot,reserve_removed,work_removed,reason,deleted_by)
   values(current_setting('test.v32.amp')::uuid,true,'{}',0.5,0,'TEST guard rejects ordinary fraction',current_setting('test.v32.owner')::uuid);
 exception when invalid_parameter_value then failed:=true;end;
 if not failed then raise exception 'Tombstone trigger accepted ordinary fractional quantity';end if;
 failed:=false;
 begin
  insert into private.crm_deleted_medications_v7(medication_id,previous_active,medication_snapshot,reserve_removed,work_removed,reason,deleted_by)
   values(med,true,'{}',0.0001,0,'TEST guard rejects excess precision',current_setting('test.v32.owner')::uuid);
 exception when invalid_parameter_value then failed:=true;end;
 if not failed then raise exception 'Tombstone trigger accepted excess measured precision';end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.v32.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v32.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare failed boolean;med uuid:=current_setting('test.v32.med')::uuid;
begin
 failed:=false;
 begin perform public.warehouse_v5('opening',jsonb_build_object('id',med,'quantity',0.5,'location','work','price',100,'expiry',current_date+100),gen_random_uuid());
 exception when raise_exception or insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'Nurse added measured stock';end if;
 failed:=false;
 begin perform public.crm_stock_correction_v6('inventory',jsonb_build_object('id',med,'batch_id',current_setting('test.v32.batch'),
  'location','work','actual_quantity',2.5,'expected_quantity',2.75,'reason','TEST unauthorized nurse'),gen_random_uuid());
 exception when raise_exception or insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'Nurse corrected measured stock';end if;
 failed:=false;
 begin perform public.crm_stock_totals_v18(jsonb_build_object('id',med,'expected_reserve',7.5,'expected_work',2.75,
  'reserve',7.5,'work',2.75),gen_random_uuid());exception when raise_exception or insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'Nurse corrected measured totals';end if;
 failed:=false;
 begin perform public.crm_medication_delete_v7('preview',jsonb_build_object('id',med));exception when raise_exception or insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'Nurse previewed owner medication removal';end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v32.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v32.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare med uuid:=current_setting('test.v32.med')::uuid;p jsonb;r jsonb;req uuid;backup_value jsonb;
begin
 r:=public.crm_medication_delete_v7('preview',jsonb_build_object('id',med));
 if (r->>'reserve')::numeric is distinct from 7.5 or (r->>'work')::numeric is distinct from 2.75
  or (r->>'total')::numeric is distinct from 10.25 then raise exception 'Measured deletion preview rounded stock';end if;
 req:=gen_random_uuid();p:=jsonb_build_object('id',med,'expected_reserve',7.5,'expected_work',2.75,'reason','TEST v32 measured deletion');
 r:=public.crm_medication_delete_v7('delete',p,req);
 if not (r->>'deleted')::boolean or (r->>'reserve_removed')::numeric is distinct from 7.5
  or (r->>'work_removed')::numeric is distinct from 2.75 or (r->>'total_removed')::numeric is distinct from 10.25 then raise exception 'Measured deletion rounded removed quantities';end if;
 if public.crm_medication_delete_v7('delete',p,req) is distinct from r then raise exception 'Measured deletion retry changed response';end if;
 perform set_config('test.v32.delete_payload',p::text,true);
 perform set_config('test.v32.delete_request',req::text,true);
 perform set_config('test.v32.delete_result',r::text,true);
 if not exists(select 1 from jsonb_array_elements(public.crm_medication_delete_v7('list_deleted')) x
  where x->>'id'=med::text and (x->>'reserve_removed')::numeric=7.5 and (x->>'work_removed')::numeric=2.75) then
  raise exception 'Deleted list lost fractional balances';end if;
 backup_value:=public.crm_management_v5('backup_export');
 if not exists(select 1 from jsonb_array_elements(backup_value->'tables'->'private.crm_deleted_medications_v7') x
  where x->>'medication_id'=med::text and (x->>'reserve_removed')::numeric=7.5 and (x->>'work_removed')::numeric=2.75) then
  raise exception 'Backup lost exact fractional tombstone';end if;
end $$;
reset role;

do $$declare med uuid:=current_setting('test.v32.med')::uuid;
begin
 perform private.assert_stock_v3(med);
 if not exists(select 1 from private.crm_deleted_medications_v7 where medication_id=med and reserve_removed=7.5 and work_removed=2.75) then
  raise exception 'Fractional removal history missing';end if;
 if (select count(*) from public.stock_movements where medication_id=med and movement_type='write_off')<>2
  or (select sum(quantity) from public.stock_movements where medication_id=med and movement_type='write_off') is distinct from 10.25 then
  raise exception 'Measured removal ledger duplicated or rounded';end if;
 if exists(select 1 from public.stock where medication_id=med and quantity<>0)
  or exists(select 1 from public.medication_batches where medication_id=med and (quantity_remaining<>0 or work_quantity<>0)) then
  raise exception 'Measured deletion left physical stock';end if;
end $$;

set local role authenticated;
do $$declare med uuid:=current_setting('test.v32.med')::uuid;p jsonb;r jsonb;req uuid;
begin
 req:=gen_random_uuid();p:=jsonb_build_object('id',med,'reason','TEST v32 restore metadata only');
 r:=public.crm_medication_delete_v7('restore',p,req);
 if not (r->>'restored')::boolean or (r->>'total')::numeric is distinct from 0 then raise exception 'Measured restore recreated stock';end if;
 if public.crm_medication_delete_v7('restore',p,req) is distinct from r then raise exception 'Measured restore retry changed response';end if;
 if public.crm_medication_delete_v7('delete',current_setting('test.v32.delete_payload')::jsonb,current_setting('test.v32.delete_request')::uuid)
  is distinct from current_setting('test.v32.delete_result')::jsonb then raise exception 'Old measured deletion replay changed after restoration';end if;
end $$;
reset role;

do $$declare med uuid:=current_setting('test.v32.med')::uuid;
begin
 perform private.assert_stock_v3(med);
 if not exists(select 1 from public.medications where id=med and active and consumption_unit='мг' and units_per_package=10 and sale_price=1500) then
  raise exception 'Restored measured metadata changed';end if;
 if exists(select 1 from private.crm_deleted_medications_v7 where medication_id=med)
  or exists(select 1 from public.stock where medication_id=med and quantity<>0) then raise exception 'Restore/replay recreated removed state';end if;
 if (select sum(quantity) from public.stock_movements where medication_id=med and movement_type='write_off') is distinct from 10.25 then
  raise exception 'Restore/replay changed measured removal ledger';end if;
 if has_function_privilege('anon','public.crm_stock_totals_v18(jsonb,uuid)','EXECUTE')
  or has_function_privilege('anon','public.crm_stock_correction_v6(text,jsonb,uuid)','EXECUTE')
  or has_function_privilege('anon','public.crm_medication_delete_v7(text,jsonb,uuid)','EXECUTE')
  or has_function_privilege('authenticated','private.crm_tombstone_quantity_guard_v32()','EXECUTE')
  or has_function_privilege('authenticated','private.crm_valid_quantity_v31(uuid,numeric,boolean)','EXECUTE') then raise exception 'Private measured helpers or owner RPCs exposed';end if;
 if has_table_privilege('authenticated','private.crm_deleted_medications_v7','INSERT')
  or not (select relrowsecurity from pg_class where oid='private.crm_deleted_medications_v7'::regclass) then raise exception 'Tombstone protection weakened';end if;
end $$;
rollback;
