-- Execute after crm-price-refresh-v48.sql. Fictional fixtures only; every change
-- rolls back. No clinical identity or original patient amount is embedded here.
begin;
create function pg_temp.v48_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v48 acceptance: %',message;end if;end $$;

do $$declare owner_u uuid:=gen_random_uuid();nurse_u uuid:=gen_random_uuid();owner_s uuid;nurse_s uuid;
 sh uuid;pt uuid;sv uuid;med uuid;measured uuid;batch uuid;
begin
 insert into auth.users(id,email) values(owner_u,owner_u::text||'@price-refresh-v48.example.invalid'),(nurse_u,nurse_u::text||'@price-refresh-v48.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST price refresh owner v48','owner',true,owner_u) returning id into owner_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST price refresh nurse v48','nurse',true,nurse_u) returning id into nurse_s;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2097-12-30',timestamptz '2097-12-30 08:30+03',timestamptz '2097-12-30 16:00+03','open') returning id into sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,nurse_s);
 insert into public.patients(full_name) values('TEST price refresh fictional patient v48') returning id into pt;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('TEST price refresh service v48',100,0,true) returning id into sv;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST captured ampoule v48','амп.',10,100,1,0,0) returning id into med;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST captured measured medicine v48','мг',10,100,20,0,0) returning id into measured;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(med,100,100,100,10,current_date+365) returning id into batch;
 insert into public.stock(medication_id,location,quantity) values(med,'reserve',0),(med,'work',100),(measured,'reserve',0),(measured,'work',0);
 update private.crm_finance_settings set payment_only=false,partial_stock=false where id;
 perform set_config('test.v48.owner',owner_u::text,true);perform set_config('test.v48.nurse',nurse_u::text,true);
 perform set_config('test.v48.staff',nurse_s::text,true);perform set_config('test.v48.shift',sh::text,true);
 perform set_config('test.v48.patient',pt::text,true);perform set_config('test.v48.service',sv::text,true);
 perform set_config('test.v48.med',med::text,true);perform set_config('test.v48.measured',measured::text,true);
 perform set_config('test.v48.batch',batch::text,true);
 perform set_config('request.jwt.claim.sub',owner_u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_u,'role','authenticated')::text,true);
 perform pg_temp.v48_assert(not has_function_privilege('authenticated','private.crm_prepare_treatment_v10(text,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('anon','private.crm_prepare_treatment_v10(text,jsonb,jsonb)','EXECUTE'),'Price helper became exposed');
end $$;
create function pg_temp.v48_items(q numeric default 2,refresh_n boolean default false,expected_n numeric default null) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v48.med'),'quantity',q,'dose','TEST prescribed dose')
  ||case when refresh_n then jsonb_build_object('refresh_price',true)
   ||case when expected_n is not null then jsonb_build_object('expected_catalog_price',expected_n) else '{}'::jsonb end else '{}'::jsonb end)
$$;
create function pg_temp.v48_payload(kind_n text,charge_n numeric,paid_n numeric default 0) returns jsonb language sql as $$
 select jsonb_build_object('shift_id',current_setting('test.v48.shift'),'nurse_id',current_setting('test.v48.staff'),
  'patient_id',current_setting('test.v48.patient'),'service_id',current_setting('test.v48.service'),
  'services',case when kind_n='procedure' then jsonb_build_array(jsonb_build_object('service_id',current_setting('test.v48.service'),'quantity',1)) else '[]'::jsonb end,
  'items',pg_temp.v48_items(),'own_medications','[]'::jsonb,'charge_total',charge_n,'paid_total',paid_n,
  'payment_status',case when paid_n=charge_n then 'paid' else 'pending' end,'payments',jsonb_build_object('terminal',paid_n),
  'expected_stock_deducted',true,'expected_partial_stock',false,'arrival_at','2097-12-30T10:00:00+03:00','notes','TEST v48 refresh acceptance')
$$;
create function pg_temp.v48_edit(a jsonb,items_n jsonb,charge_n numeric,status_n text default 'pending') returns jsonb language sql as $$
 select pg_temp.v48_payload(a->>'kind',charge_n)||jsonb_build_object('kind',a->>'kind','id',a->>'id','expected_version',a->'version',
  'items',items_n,'services',a->'services','own_medications',a->'own_medications','payment_status',status_n,'edit_reason','TEST explicit price correction v48')
$$;
create function pg_temp.v48_funds_stock() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'allocations',(select jsonb_agg(to_jsonb(a) order by id) from private.crm_payment_allocations a where created_by in(current_setting('test.v48.owner')::uuid,current_setting('test.v48.nurse')::uuid)),
  'receipts',(select jsonb_agg(to_jsonb(r) order by id) from private.crm_receipts_v10 r where created_by in(current_setting('test.v48.owner')::uuid,current_setting('test.v48.nurse')::uuid)),
  'stock',(select jsonb_agg(to_jsonb(s) order by location) from public.stock s where medication_id=current_setting('test.v48.med')::uuid),
  'batches',(select jsonb_agg(to_jsonb(b) order by id) from public.medication_batches b where medication_id=current_setting('test.v48.med')::uuid),
  'movements',(select jsonb_agg(to_jsonb(m) order by id) from public.stock_movements m where medication_id=current_setting('test.v48.med')::uuid))
$$;
create function pg_temp.v48_rejected_state() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'funds_stock',pg_temp.v48_funds_stock(),
  'procedures',(select jsonb_agg(to_jsonb(p) order by id) from public.procedures p where shift_id=current_setting('test.v48.shift')::uuid),
  'sales',(select jsonb_agg(to_jsonb(s) order by id) from public.sales s where shift_id=current_setting('test.v48.shift')::uuid),
  'requests',(select jsonb_agg(to_jsonb(r) order by id) from private.warehouse_requests r where staff_user in(current_setting('test.v48.owner')::uuid,current_setting('test.v48.nurse')::uuid)),
  'partial_requests',(select jsonb_agg(to_jsonb(r) order by request_id) from private.crm_partial_stock_requests_v28 r where actor_user in(current_setting('test.v48.owner')::uuid,current_setting('test.v48.nurse')::uuid)),
  'audit',(select count(*) from private.crm_audit_log where actor_user in(current_setting('test.v48.owner')::uuid,current_setting('test.v48.nurse')::uuid)))
$$;
set local role authenticated;
do $$declare kind_n text;a jsonb;begin
 foreach kind_n in array array['procedure','sale'] loop
  a:=public.record_treatment_v5(kind_n,pg_temp.v48_payload(kind_n,2+case when kind_n='procedure' then 100 else 0 end),gen_random_uuid());
  perform set_config('test.v48.'||kind_n,a->>'id',true);
  perform pg_temp.v48_assert((a->'items'->0->>'unit_price')::numeric=1 and(a->'items'->0->>'quantity')::numeric=2,'Fixture price was not captured');
 end loop;
 a:=public.record_treatment_v5('procedure',pg_temp.v48_payload('procedure',102,102),gen_random_uuid());
 perform set_config('test.v48.paid',a->>'id',true);
end $$;
reset role;
update public.medications set sale_price=1000 where id=current_setting('test.v48.med')::uuid;
select set_config('test.v48.funds_stock',pg_temp.v48_funds_stock()::text,true);

-- Reopening and ordinary editing never silently reprice history.
set local role authenticated;
do $$declare kind_n text;a jsonb;begin
 foreach kind_n in array array['procedure','sale'] loop
  a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind',kind_n,'id',current_setting('test.v48.'||kind_n)));
  a:=public.crm_clinical_v10('treatment_edit',pg_temp.v48_edit(a,pg_temp.v48_items(),(a->>'charge_total')::numeric),gen_random_uuid());
  perform pg_temp.v48_assert((a->'items'->0->>'unit_price')::numeric=1 and(a->'items'->0->>'line_total')::numeric=2,'Unmarked saved line was repriced');
 end loop;
end $$;
reset role;

-- Explicit correction changes only reviewed price and derived bill/debt, not
-- quantity/dose, stock, past collections, payment methods or payment timestamps.
set local role authenticated;
do $$declare kind_n text;a jsonb;p jsonb;answer_n jsonb;request_n uuid;begin
 foreach kind_n in array array['procedure','sale'] loop
  a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind',kind_n,'id',current_setting('test.v48.'||kind_n)));
  p:=pg_temp.v48_edit(a,pg_temp.v48_items(2,true,1000),2000+case when kind_n='procedure' then 100 else 0 end);request_n:=gen_random_uuid();
  answer_n:=public.crm_clinical_v10('treatment_edit',p,request_n);
  perform pg_temp.v48_assert((answer_n->'items'->0->>'unit_price')::numeric=1000 and(answer_n->'items'->0->>'line_total')::numeric=2000
   and(answer_n->'items'->0->>'quantity')::numeric=2 and answer_n->'items'->0->>'dose'='TEST prescribed dose','Explicit price/dose/quantity wrong');
  perform pg_temp.v48_assert((answer_n->>'received_total')::numeric=0 and(answer_n->>'debt_total')::numeric=(answer_n->>'charge_total')::numeric,'Refresh fabricated a collection');
  perform pg_temp.v48_assert(public.crm_clinical_v10('treatment_edit',p,request_n)=answer_n,'Price refresh retry not idempotent');
 end loop;
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v48.paid')));
 a:=public.crm_clinical_v10('treatment_edit',pg_temp.v48_edit(a,pg_temp.v48_items(2,true,1000),2100,'debt'),gen_random_uuid());
 perform pg_temp.v48_assert((a->>'received_total')::numeric=102 and(a->>'debt_total')::numeric=1998,'Earlier actual collection was changed by refresh');
end $$;
reset role;
select pg_temp.v48_assert(pg_temp.v48_funds_stock()=current_setting('test.v48.funds_stock')::jsonb,'Price-only edits changed stock or recorded funds');

-- Locked authoritative price with optimistic expectation; all rejected writes
-- must leave version, bill, audit, requests, cash and inventory untouched.
select set_config('test.v48.rejected_state',pg_temp.v48_rejected_state()::text,true);
set local role authenticated;
do $$declare a jsonb;before_n jsonb;after_n jsonb;bad_n jsonb;p jsonb;failed boolean;error_n text;begin
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v48.procedure')));before_n:=a;
 foreach bad_n in array array[
  jsonb_build_object('refresh_price',true,'expected_catalog_price',999),
  jsonb_build_object('refresh_price','true'),jsonb_build_object('refresh_price',null),
  jsonb_build_object('refresh_price',true,'expected_catalog_price','1000'),
  jsonb_build_object('refresh_price',false,'expected_catalog_price',1000),
  jsonb_build_object('refresh_price',true,'expected_catalog_price',0),
  jsonb_build_object('refresh_price',true,'expected_catalog_price',1000.001),
  jsonb_build_object('refresh_price',true,'expected_catalog_price','NaN')
 ] loop
  failed:=false;p:=pg_temp.v48_edit(a,jsonb_build_array((pg_temp.v48_items()->0)||bad_n),2100);
  begin perform public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
  exception when others then failed:=true;get stacked diagnostics error_n=message_text;end;
  perform pg_temp.v48_assert(failed,'Malformed or stale price expectation accepted');
  after_n:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',a->>'id'));
  perform pg_temp.v48_assert(after_n=before_n,'Rejected refresh changed saved snapshot');
 end loop;
end $$;
reset role;
select pg_temp.v48_assert(pg_temp.v48_rejected_state()=current_setting('test.v48.rejected_state')::jsonb,'Rejected refresh changed stock, funds, requests or audit');

-- Duplicate normalization must retain explicit intent and reject conflicting
-- expectations. Explicit custom charge and historical discount remain deliberate.
do $$declare med text:=current_setting('test.v48.med');original_n jsonb;a jsonb;items_n jsonb;failed boolean;begin
 original_n:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication_id',med,'quantity',2,'unit_price',1,'dose','TEST prescribed dose')),'list_total',2,'charge_total',2);
 items_n:=pg_temp.v48_items(1,true,1000)||pg_temp.v48_items(1,false);
 a:=private.crm_prepare_treatment_v10('sale',jsonb_build_object('items',items_n),original_n);
 perform pg_temp.v48_assert(jsonb_array_length(a->'items')=1 and(a->'items'->0->>'quantity')::numeric=2
  and(a->'items'->0->>'unit_price')::numeric=1000 and(a->>'charge_total')::numeric=2000,'Duplicate aggregation lost refresh intent');
 failed:=false;
 begin perform private.crm_prepare_treatment_v10('sale',jsonb_build_object('items',pg_temp.v48_items(1,true,1000)||pg_temp.v48_items(1,true,1001)),original_n);
 exception when raise_exception then failed:=true;end;
 perform pg_temp.v48_assert(failed,'Conflicting duplicate expectations accepted');
 a:=private.crm_prepare_treatment_v10('sale',jsonb_build_object('items',pg_temp.v48_items(2,true,1000),'charge_total',777,
  'discount_reason','TEST custom price','discount_comment','TEST explicit individual amount'),original_n);
 perform pg_temp.v48_assert((a->>'charge_total')::numeric=777 and(a->>'discount_amount')::numeric=1223,'Explicit individual charge overwritten');
 a:=private.crm_prepare_treatment_v10('sale',jsonb_build_object('items',pg_temp.v48_items(2,true,1000),'discount_reason','TEST discount',
  'discount_comment','TEST preserve original absolute discount'),original_n||jsonb_build_object('charge_total',1));
 perform pg_temp.v48_assert((a->>'charge_total')::numeric=1999 and(a->>'discount_amount')::numeric=1,'Existing absolute discount overwritten');
 update public.medications set active=false where id=med::uuid;failed:=false;
 begin perform private.crm_prepare_treatment_v10('sale',jsonb_build_object('items',pg_temp.v48_items(2,true,1000)),original_n);
 exception when raise_exception then failed:=true;end;
 perform pg_temp.v48_assert(failed,'Archived medicine explicitly repriced');
 a:=private.crm_prepare_treatment_v10('sale',jsonb_build_object('items',pg_temp.v48_items()),original_n);
 perform pg_temp.v48_assert((a->'items'->0->>'unit_price')::numeric=1,'Unchanged archived historical line no longer editable');
 update public.medications set active=true,sale_price=null where id=med::uuid;failed:=false;
 begin perform private.crm_prepare_treatment_v10('sale',jsonb_build_object('items',pg_temp.v48_items(2,true,1000)),original_n);
 exception when raise_exception then failed:=true;end;
 perform pg_temp.v48_assert(failed,'Unpriced medicine explicitly repriced');
 update public.medications set sale_price=1000 where id=med::uuid;
 -- Fractional milligrams remain supported; ampoules remain whole.
 original_n:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v48.measured'),'quantity',2.5,'unit_price',1)),'list_total',2.5,'charge_total',2.5);
 a:=private.crm_prepare_treatment_v10('sale',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v48.measured'),
  'quantity',2.5,'refresh_price',true,'expected_catalog_price',20))),original_n);
 perform pg_temp.v48_assert((a->'items'->0->>'quantity')::numeric=2.5 and(a->>'list_total')::numeric=50,'Fractional milligram refresh broken');
 failed:=false;
 begin perform private.crm_prepare_treatment_v10('sale',jsonb_build_object('items',pg_temp.v48_items(1.5,true,1000)),null);
 exception when raise_exception then failed:=true;end;
 perform pg_temp.v48_assert(failed,'Fractional ampoule accepted');
 a:=private.crm_prepare_treatment_v10('sale',jsonb_build_object('items',pg_temp.v48_items(1,true,1000)),null);
 perform pg_temp.v48_assert((a->>'list_total')::numeric=1000,'New record refresh did not use authoritative price');
end $$;
select 'v48 price refresh acceptance passed; transaction rolls back' result;
rollback;
