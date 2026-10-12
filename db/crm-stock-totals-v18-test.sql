-- Run after crm-stock-totals-v18.sql. Synthetic medicine / patient fixtures only.
-- Staff and auth users are fictional too; every write rolls back.
begin;
do $$declare med uuid;empty_med uuid;early_batch uuid;late_batch uuid;expired_batch uuid;shift_id_value uuid;patient_id_value uuid;nurse_id_value uuid;
 owner_user uuid:=gen_random_uuid();admin_user uuid:=gen_random_uuid();nurse_user uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(owner_user,'stock-v18-owner-'||owner_user::text||'@example.invalid'),
  (admin_user,'stock-v18-admin-'||admin_user::text||'@example.invalid'),
  (nurse_user,'stock-v18-nurse-'||nurse_user::text||'@example.invalid');
 insert into public.staff(full_name,role,auth_user_id) values('TEST v18 owner','owner',owner_user),('TEST v18 administrator','admin',admin_user);
 insert into public.staff(full_name,role,auth_user_id) values('TEST v18 nurse','nurse',nurse_user) returning id into nurse_id_value;
 perform set_config('test.v18.manager',owner_user::text,true);perform set_config('test.v18.admin',admin_user::text,true);
 perform set_config('test.v18.nurse',nurse_user::text,true);
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_user,'role','authenticated')::text,true);
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2097-08-18',now(),now()+interval '8 hours','open') returning id into shift_id_value;
 insert into public.shift_staff(shift_id,staff_id) values(shift_id_value,nurse_id_value);
 insert into public.patients(full_name) values('TEST v18 fictional stock patient — rollback only') returning id into patient_id_value;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST v18 physical balances','амп.',10,100,40,2,1) returning id into med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date,received_date)
  values(med,12,12,4,5,current_date+50,current_date-20) returning id into early_batch;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date,received_date)
  values(med,20,20,8,8,current_date+100,current_date-10) returning id into late_batch;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date,received_date)
  values(med,3,3,1,3,current_date-1,current_date-30) returning id into expired_batch;
 insert into public.stock(medication_id,location,quantity) values(med,'reserve',22),(med,'work',13);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price)
  values('TEST v18 empty stock','фл.',50,500,200) returning id into empty_med;
 -- One real synthetic sale captures an older batch's cost before correction.
 update private.crm_finance_settings set payment_only=false where id;
 perform set_config('test.v18.med',med::text,true);perform set_config('test.v18.empty_med',empty_med::text,true);
 perform set_config('test.v18.early_batch',early_batch::text,true);perform set_config('test.v18.late_batch',late_batch::text,true);
 perform set_config('test.v18.expired_batch',expired_batch::text,true);perform set_config('test.v18.shift',shift_id_value::text,true);
 perform set_config('test.v18.patient',patient_id_value::text,true);perform set_config('test.v18.nurse_id',nurse_id_value::text,true);
end $$;
set local role authenticated;
do $$declare r jsonb;
begin
 r:=public.record_treatment_v5('sale',jsonb_build_object('shift_id',current_setting('test.v18.shift'),
  'patient_id',current_setting('test.v18.patient'),'nurse_id',current_setting('test.v18.nurse_id'),
  'paid_total',80,'charge_total',80,'payment_status','paid','expected_stock_deducted',true,
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v18.med'),'quantity',2)),
  'payments',jsonb_build_object('terminal',80)),gen_random_uuid());
 perform set_config('test.v18.sale',r->>'id',true);
end $$;
reset role;
do $$declare history_value jsonb;cost_value numeric;
begin
 select jsonb_build_object('sale',to_jsonb(s),
  'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.sale_items i where i.sale_id=s.id),
  'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.stock_movements m where m.sale_id=s.id))
  into history_value from public.sales s where s.id=current_setting('test.v18.sale')::uuid;
 select sum(m.quantity*b.purchase_price_per_unit) into cost_value from public.stock_movements m
  join public.medication_batches b on b.id=m.batch_id where m.sale_id=current_setting('test.v18.sale')::uuid;
 if cost_value is distinct from 10::numeric then raise exception 'Synthetic sale did not capture FEFO cost';end if;
 perform set_config('test.v18.history',history_value::text,true);perform set_config('test.v18.sale_cost',cost_value::text,true);
end $$;

set local role authenticated;
do $$declare med uuid:=current_setting('test.v18.med')::uuid;p jsonb;r jsonb;request_value uuid:=gen_random_uuid();bad_value text;bad_request uuid;
begin
 -- Reduce both locations, including expired stock, without requiring an expiry.
 p:=jsonb_build_object('id',med,'expected_reserve',22,'expected_work',11,'reserve',18,'work',7,
  'expiry_date',null,'reason','TEST counted both locations');
 r:=public.crm_stock_totals_v18(p,request_value);
 if (r->>'reserve_qty')::numeric is distinct from 18::numeric or (r->>'work_qty')::numeric is distinct from 7::numeric
  or (r->>'total_qty')::numeric is distinct from 25::numeric or r->>'name' is distinct from 'TEST v18 physical balances' then
  raise exception 'Two-location decrease or snapshot incorrect: %',r;end if;
 if public.crm_stock_totals_v18(p,request_value) is distinct from r then raise exception 'Replay differs';end if;
 perform set_config('test.v18.replay_request',request_value::text,true);perform set_config('test.v18.replay_payload',p::text,true);
 perform set_config('test.v18.replay_result',r::text,true);
 begin
  perform public.crm_stock_totals_v18(p||jsonb_build_object('work',6),request_value);
  raise exception 'Changed payload unexpectedly accepted';
 exception when sqlstate '22023' then null;end;
 bad_request:=gen_random_uuid();
 begin
  perform public.crm_stock_totals_v18(p,bad_request);raise exception 'Stale CAS unexpectedly accepted';
 exception when sqlstate '40001' then null;end;
 perform set_config('test.v18.stale_request',bad_request::text,true);
 -- Validate every field before changing either location. An impossible February
 -- date must not leave behind the otherwise valid return of working stock.
 p:=jsonb_build_object('id',med,'expected_reserve',18,'expected_work',7,'reserve',24,'work',3,'expiry_date','2030-02-30');
 bad_request:=gen_random_uuid();
 begin
  perform public.crm_stock_totals_v18(p,bad_request);raise exception 'Impossible expiry unexpectedly accepted';
 exception when sqlstate '22023' then null;end;
 perform set_config('test.v18.invalid_date_request',bad_request::text,true);
 -- This price fits the API's numeric input but exceeds the batch cost column.
 -- The first paired return succeeds before opening fails; the entire outer
 -- function must roll it back, including child requests and movements.
 bad_request:=gen_random_uuid();
 begin
  perform public.crm_stock_totals_v18(p||jsonb_build_object('expiry_date',current_date+200,'purchase_price',1e100),bad_request);
  raise exception 'Overflowing opening unexpectedly accepted';
 exception when numeric_value_out_of_range then null;end;
 perform set_config('test.v18.atomic_request',bad_request::text,true);
 foreach bad_value in array array['','2027-13-01','2030-02-29','30.02.2030','yesterday'] loop
  begin
   perform public.crm_stock_totals_v18(p||jsonb_build_object('expiry_date',bad_value),gen_random_uuid());
   raise exception 'Bad expiry unexpectedly accepted: %',bad_value;
  exception when sqlstate '22023' then null;end;
 end loop;
 begin
  perform public.crm_stock_totals_v18(p||jsonb_build_object('expiry_date',current_date-1),gen_random_uuid());
  raise exception 'Past expiry unexpectedly accepted';
 exception when sqlstate '22023' then null;end;
 foreach bad_value in array array['-1','0.5','NaN','Infinity','not a number'] loop
  begin
   perform public.crm_stock_totals_v18(p||jsonb_build_object('reserve',bad_value,'expiry_date',current_date+200),gen_random_uuid());
   raise exception 'Invalid quantity unexpectedly accepted: %',bad_value;
  exception when sqlstate '22023' then null;end;
 end loop;
 begin
  perform public.crm_stock_totals_v18(p-'expected_work',gen_random_uuid());raise exception 'Missing expected count unexpectedly accepted';
 exception when sqlstate '22023' then null;end;
 begin
  perform public.crm_stock_totals_v18(p||jsonb_build_object('extra',1),gen_random_uuid());raise exception 'Unknown payload key unexpectedly accepted';
 exception when sqlstate '22023' then null;end;
 -- Both increases create two dated batches, defaulting to current package cost.
 p:=jsonb_build_object('id',med,'expected_reserve',18,'expected_work',7,'reserve',20,'work',10,'expiry_date',current_date+200);
 r:=public.crm_stock_totals_v18(p,gen_random_uuid());
 if (r->>'reserve_qty')::numeric is distinct from 20::numeric or (r->>'work_qty')::numeric is distinct from 10::numeric
  or (r->>'total_qty')::numeric is distinct from 30::numeric then raise exception 'Two-location increase incorrect';end if;
 -- Explicit purchase price is a package price for the new batch only.
 p:=jsonb_build_object('id',med,'expected_reserve',20,'expected_work',10,'reserve',23,'work',10,
  'expiry_date',current_date+220,'purchase_price',250,'reason','TEST package price for new units');
 r:=public.crm_stock_totals_v18(p,gen_random_uuid());
 if (r->>'reserve_qty')::numeric is distinct from 23::numeric then raise exception 'One-location increase incorrect';end if;
 -- One-location decrease and a no-op never require a date or mandatory comment.
 p:=jsonb_build_object('id',med,'expected_reserve',23,'expected_work',10,'reserve',23,'work',8);
 r:=public.crm_stock_totals_v18(p,gen_random_uuid());
 if (r->>'work_qty')::numeric is distinct from 8::numeric then raise exception 'One-location decrease incorrect';end if;
 p:=jsonb_build_object('id',med,'expected_reserve',23,'expected_work',8,'reserve',23,'work',8);
 request_value:=gen_random_uuid();r:=public.crm_stock_totals_v18(p,request_value);
 if public.crm_stock_totals_v18(p,request_value) is distinct from r then raise exception 'No-op retry differs';end if;
 perform set_config('test.v18.noop_request',request_value::text,true);
 -- An old response remains a historical operation receipt, never a second write.
 if public.crm_stock_totals_v18(current_setting('test.v18.replay_payload')::jsonb,current_setting('test.v18.replay_request')::uuid)
  is distinct from current_setting('test.v18.replay_result')::jsonb then raise exception 'Old receipt changed';end if;
 -- Empty-card opening handles stock rows that did not previously exist.
 p:=jsonb_build_object('id',current_setting('test.v18.empty_med'),'expected_reserve',0,'expected_work',0,
  'reserve',37,'work',0,'expiry_date',current_date+250);
 r:=public.crm_stock_totals_v18(p,gen_random_uuid());
 if (r->>'reserve_qty')::numeric is distinct from 37::numeric or (r->>'work_qty')::numeric is distinct from 0::numeric then
  raise exception 'Empty-card opening incorrect';end if;
 -- A pure transfer and return need no expiry and keep the same original batch.
 p:=jsonb_build_object('id',current_setting('test.v18.empty_med'),'expected_reserve',37,'expected_work',0,'reserve',32,'work',5);
 r:=public.crm_stock_totals_v18(p,gen_random_uuid());
 if (r->>'reserve_qty')::numeric is distinct from 32::numeric or (r->>'work_qty')::numeric is distinct from 5::numeric then
  raise exception 'Pure transfer target incorrect';end if;
 p:=jsonb_build_object('id',current_setting('test.v18.empty_med'),'expected_reserve',32,'expected_work',5,'reserve',37,'work',0);
 r:=public.crm_stock_totals_v18(p,gen_random_uuid());
 if (r->>'reserve_qty')::numeric is distinct from 37::numeric or (r->>'work_qty')::numeric is distinct from 0::numeric then
  raise exception 'Pure return target incorrect';end if;
 -- Transfer three original units and open two extra units, preserving original
 -- cost/expiry while giving the net increase its explicitly supplied cost/date.
 p:=jsonb_build_object('id',current_setting('test.v18.empty_med'),'expected_reserve',37,'expected_work',0,
  'reserve',34,'work',5,'expiry_date',current_date+300,'purchase_price',750);
 r:=public.crm_stock_totals_v18(p,gen_random_uuid());
 if (r->>'reserve_qty')::numeric is distinct from 34::numeric or (r->>'work_qty')::numeric is distinct from 5::numeric
  or (r->>'total_qty')::numeric is distinct from 39::numeric then raise exception 'Combined transfer and net increase incorrect';end if;
end $$;
reset role;

do $$declare med uuid:=current_setting('test.v18.med')::uuid;history_value jsonb;cost_value numeric;
begin
 perform private.assert_stock_v3(med);perform private.assert_stock_v3(current_setting('test.v18.empty_med')::uuid);
 if (select quantity from public.stock where medication_id=med and location='reserve') is distinct from 23::numeric
  or (select quantity from public.stock where medication_id=med and location='work') is distinct from 8::numeric then raise exception 'Failed validation or replay changed stock';end if;
 if (select count(*) from private.crm_audit_log a where a.entity_id=med::text and a.action='stock_totals_corrected')<>4 then
  raise exception 'Aggregate audit missing, duplicated on replay, or emitted for no-op';end if;
 if not exists(select 1 from private.crm_audit_log a where a.entity_id=med::text and a.action='stock_totals_corrected'
  and a.actor_user=current_setting('test.v18.manager')::uuid and a.actor_staff is not null
  and a.reason='TEST counted both locations' and (a.before_data->>'reserve_qty')::numeric=22
  and (a.before_data->>'work_qty')::numeric=11 and (a.after_data->>'reserve_qty')::numeric=18
  and (a.after_data->>'work_qty')::numeric=7 and a.after_data->>'request_id'=current_setting('test.v18.replay_request')) then
  raise exception 'Aggregate audit has incorrect actor, reason or before/after';end if;
 if exists(select 1 from private.warehouse_requests where id in(current_setting('test.v18.stale_request')::uuid,
  current_setting('test.v18.invalid_date_request')::uuid,current_setting('test.v18.atomic_request')::uuid)) then raise exception 'Failed correction left a request';end if;
 if exists(select 1 from public.stock_movements where medication_id=med and movement_type='work_to_reserve') then
  raise exception 'Failed second-location opening left the earlier return';end if;
 if (select quantity_remaining from public.medication_batches where id=current_setting('test.v18.expired_batch')::uuid)<>0 then raise exception 'Expired batch was not reduced first';end if;
 if (select quantity_remaining from public.medication_batches where id=current_setting('test.v18.early_batch')::uuid)<>6
  or (select work_quantity from public.medication_batches where id=current_setting('test.v18.early_batch')::uuid)<>0 then
  raise exception 'Earlier batch correction did not preserve reserve/work accounting';end if;
 if (select purchase_price_per_unit from public.medication_batches where id=current_setting('test.v18.early_batch')::uuid)<>5
  or (select purchase_price_per_unit from public.medication_batches where id=current_setting('test.v18.late_batch')::uuid)<>8
  or (select purchase_price_per_unit from public.medication_batches where id=current_setting('test.v18.expired_batch')::uuid)<>3 then raise exception 'Old batch cost changed';end if;
 if (select quantity_received from public.medication_batches where id=current_setting('test.v18.early_batch')::uuid)<>12
  or (select quantity_received from public.medication_batches where id=current_setting('test.v18.late_batch')::uuid)<>20 then raise exception 'Received quantities were rewritten';end if;
 if (select count(*) from public.medication_batches where medication_id=med and expiry_date=current_date+200
  and purchase_price_per_unit=10)<>2 then raise exception 'Default cost or both increased locations incorrect';end if;
 if not exists(select 1 from public.medication_batches where medication_id=med and expiry_date=current_date+220
  and purchase_price_per_unit=25 and quantity_received=3) then raise exception 'Explicit new package cost incorrect';end if;
 if (select purchase_price from public.medications where id=med)<>100 or (select sale_price from public.medications where id=med)<>40
  or (select units_per_package from public.medications where id=med)<>10 then raise exception 'Card price or package size changed';end if;
 select jsonb_build_object('sale',to_jsonb(s),
  'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.sale_items i where i.sale_id=s.id),
  'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.stock_movements m where m.sale_id=s.id))
  into history_value from public.sales s where s.id=current_setting('test.v18.sale')::uuid;
 select sum(m.quantity*b.purchase_price_per_unit) into cost_value from public.stock_movements m
  join public.medication_batches b on b.id=m.batch_id where m.sale_id=current_setting('test.v18.sale')::uuid;
 if history_value is distinct from current_setting('test.v18.history')::jsonb
  or cost_value is distinct from current_setting('test.v18.sale_cost')::numeric then raise exception 'Captured clinical history, receipt or P&L cost changed';end if;
 if (select count(*) from public.medication_batches where medication_id=current_setting('test.v18.empty_med')::uuid)<>2 then
  raise exception 'Pure movements created a new batch';end if;
 if not exists(select 1 from public.medication_batches where medication_id=current_setting('test.v18.empty_med')::uuid
  and quantity_received=37 and quantity_remaining=37 and work_quantity=3 and purchase_price_per_unit=10 and expiry_date=current_date+250) then
  raise exception 'Transfer/return changed original quantity, cost or expiry';end if;
 if not exists(select 1 from public.medication_batches where medication_id=current_setting('test.v18.empty_med')::uuid
  and quantity_received=2 and quantity_remaining=2 and work_quantity=2 and purchase_price_per_unit=15 and expiry_date=current_date+300) then
  raise exception 'Combined movement opened incorrect net increase';end if;
 if (select count(*) from public.stock_movements where medication_id=current_setting('test.v18.empty_med')::uuid and movement_type='reserve_to_work')<>2
  or (select count(*) from public.stock_movements where medication_id=current_setting('test.v18.empty_med')::uuid and movement_type='work_to_reserve')<>1 then
  raise exception 'Paired movements did not use existing validated warehouse paths';end if;
 if has_function_privilege('anon','public.crm_stock_totals_v18(jsonb,uuid)','EXECUTE')
  or has_function_privilege('anon','private.crm_stock_totals_v18(jsonb,uuid)','EXECUTE') then raise exception 'Anonymous correction privilege';end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.v18.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v18.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$begin
 begin
  perform public.crm_stock_totals_v18(current_setting('test.v18.replay_payload')::jsonb,current_setting('test.v18.replay_request')::uuid);
  raise exception 'Nurse received a manager receipt';
 exception when insufficient_privilege then null;end;
 begin
  perform public.crm_stock_totals_v18(jsonb_build_object('id',current_setting('test.v18.med'),
   'expected_reserve',23,'expected_work',8,'reserve',0,'work',0),gen_random_uuid());
  raise exception 'Nurse changed stock';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v18.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v18.manager'),'role','authenticated')::text,true);
-- Only the fictional owner's account is changed for these replay permission
-- checks. A saved receipt does not retain authorization after access changes.
update public.staff set active=false where auth_user_id=current_setting('test.v18.manager')::uuid;
set local role authenticated;
do $$begin
 begin
  perform public.crm_stock_totals_v18(current_setting('test.v18.replay_payload')::jsonb,current_setting('test.v18.replay_request')::uuid);
  raise exception 'Inactive manager received a cached receipt';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.staff set active=true,role='nurse' where auth_user_id=current_setting('test.v18.manager')::uuid;
set local role authenticated;
do $$begin
 begin
  perform public.crm_stock_totals_v18(current_setting('test.v18.replay_payload')::jsonb,current_setting('test.v18.replay_request')::uuid);
  raise exception 'Demoted manager received a cached receipt';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.staff set role='owner' where auth_user_id=current_setting('test.v18.manager')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.v18.admin'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v18.admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare r jsonb;
begin
 r:=public.crm_stock_totals_v18(jsonb_build_object('id',current_setting('test.v18.med'),
  'expected_reserve',23,'expected_work',8,'reserve',23,'work',8),gen_random_uuid());
 if (r->>'total_qty')::numeric is distinct from 31::numeric then raise exception 'Active administrator cannot save stock';end if;
 begin
  perform public.crm_stock_totals_v18(current_setting('test.v18.replay_payload')::jsonb,current_setting('test.v18.replay_request')::uuid);
  raise exception 'Different administrator received owner receipt';
 exception when sqlstate '22023' then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v18.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v18.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare r jsonb;
begin
 if public.crm_stock_totals_v18(current_setting('test.v18.replay_payload')::jsonb,current_setting('test.v18.replay_request')::uuid)
  is distinct from current_setting('test.v18.replay_result')::jsonb then raise exception 'Restored owner replay differs';end if;
 r:=public.crm_stock_totals_v18(jsonb_build_object('id',current_setting('test.v18.med'),
  'expected_reserve',23,'expected_work',8,'reserve',0,'work',0),gen_random_uuid());
 if (r->>'total_qty')::numeric is distinct from 0::numeric then raise exception 'Zero total target failed';end if;
end $$;
reset role;
do $$begin
 perform private.assert_stock_v3(current_setting('test.v18.med')::uuid);
 if exists(select 1 from public.medication_batches where medication_id=current_setting('test.v18.med')::uuid
  and (quantity_remaining<>0 or work_quantity<>0)) then raise exception 'Zero correction did not empty all batches';end if;
end $$;
rollback;
