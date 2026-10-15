-- Run after v31 on an integration database with the released v29/v30 finances.
-- Every identity, setting, bill, template, receipt and stock effect rolls back.
begin;
create temporary table v31_existing_patients as select id,to_jsonb(p) original from public.patients p;
create temporary table v31_existing_medications as select id,to_jsonb(m) original from public.medications m;
create temporary table v31_existing_stock as select medication_id,location,to_jsonb(s) original from public.stock s;
create temporary table v31_existing_batches as select id,to_jsonb(b) original from public.medication_batches b;
create temporary table v31_existing_movements as select id,to_jsonb(m) original from public.stock_movements m;
create temporary table v31_existing_procedures as select id,to_jsonb(p) original from public.procedures p;
create temporary table v31_existing_sales as select id,to_jsonb(s) original from public.sales s;
create temporary table v31_existing_procedure_items as select to_jsonb(i) original from public.procedure_medications i;
create temporary table v31_existing_sale_items as select to_jsonb(i) original from public.sale_items i;
create temporary table v31_existing_allocations as select id,to_jsonb(a) original from private.crm_payment_allocations a;
create temporary table v31_existing_receipts as select id,to_jsonb(r) original from private.crm_receipts_v10 r;

create function pg_temp.v31_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v31 acceptance: %',message;end if;end $$;

do $$declare owner_u uuid:=gen_random_uuid();nurse_u uuid:=gen_random_uuid();owner_s uuid;nurse_s uuid;
 shift_n uuid;patient_n uuid;service_n uuid;reta_n uuid;moun_n uuid;amp_n uuid;vial_n uuid;pen_n uuid;tracked_n uuid;batch_n uuid;
begin
 insert into auth.users(id,email) values(owner_u,owner_u::text||'@measured-v31.example.invalid'),
  (nurse_u,nurse_u::text||'@measured-v31.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST measured owner v31','owner',true,owner_u) returning id into owner_s;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST measured nurse v31','nurse',true,nurse_u) returning id into nurse_s;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-12-31',timestamptz '2096-12-31 08:30+03',timestamptz '2096-12-31 16:00+03','open') returning id into shift_n;
 insert into public.shift_staff(shift_id,staff_id) values(shift_n,nurse_s);
 insert into public.patients(full_name) values('TEST measured synthetic patient v31') returning id into patient_n;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST measured synthetic service v31',100,0,true) returning id into service_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST measured Reta v31','мг',10,0,1500,0,0) returning id into reta_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST measured Mounjaro v31','мг',10,0,1300,0,0) returning id into moun_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST measured ampoule v31','амп.',10,0,100,0,0) returning id into amp_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST measured vial v31','фл.',5,0,200,0,0) returning id into vial_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST measured separate pen v31','шприц-ручка',1,0,60000,0,0) returning id into pen_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST measured tracked stock v31','мг',10,110,1300,0,0) returning id into tracked_n;
 insert into public.stock(medication_id,location,quantity)
  select m,l,0 from unnest(array[reta_n,moun_n,amp_n,vial_n,pen_n]) m cross join unnest(array['reserve','work']) l;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(tracked_n,10,10,10,11,current_date+365) returning id into batch_n;
 insert into public.stock(medication_id,location,quantity) values(tracked_n,'reserve',0),(tracked_n,'work',10);
 update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
 perform set_config('test.v31.owner',owner_u::text,true);perform set_config('test.v31.nurse',nurse_u::text,true);
 perform set_config('test.v31.nurse_staff',nurse_s::text,true);perform set_config('test.v31.shift',shift_n::text,true);
 perform set_config('test.v31.patient',patient_n::text,true);perform set_config('test.v31.service',service_n::text,true);
 perform set_config('test.v31.reta',reta_n::text,true);perform set_config('test.v31.moun',moun_n::text,true);
 perform set_config('test.v31.amp',amp_n::text,true);perform set_config('test.v31.vial',vial_n::text,true);
 perform set_config('test.v31.pen',pen_n::text,true);perform set_config('test.v31.tracked',tracked_n::text,true);
 perform set_config('test.v31.batch',batch_n::text,true);
 perform set_config('test.v31.medications',to_jsonb(array[reta_n,moun_n,amp_n,vial_n,pen_n,tracked_n])::text,true);
 perform set_config('request.jwt.claim.sub',owner_u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_u,'role','authenticated')::text,true);
 -- The shared helper has no stock-operation cap; clinical callers retain theirs.
 perform pg_temp.v31_assert(private.crm_valid_quantity_v31(reta_n,1000001),'Shared validator added an arbitrary quantity cap');
 perform pg_temp.v31_assert(private.crm_valid_quantity_v31(reta_n,0,true) and not private.crm_valid_quantity_v31(reta_n,0),
  'Zero must require the explicit stock-balance option');
 perform pg_temp.v31_assert(not private.crm_valid_quantity_v31(gen_random_uuid(),2.5),'Unknown medicine accepted');
 perform pg_temp.v31_assert(not has_function_privilege('authenticated','private.crm_valid_quantity_v31(uuid,numeric,boolean)','EXECUTE')
  and not has_function_privilege('anon','private.crm_valid_quantity_v31(uuid,numeric,boolean)','EXECUTE'),'Private validator is directly exposed');
end $$;

create function pg_temp.v31_item(key_n text,quantity_n numeric) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v31.'||key_n),'quantity',quantity_n))
$$;
create function pg_temp.v31_payload(kind_n text,items_n jsonb,charge_n numeric,status_n text default 'pending') returns jsonb language sql as $$
 select jsonb_build_object('shift_id',current_setting('test.v31.shift'),'nurse_id',current_setting('test.v31.nurse_staff'),
  'patient_id',case when kind_n='procedure' then current_setting('test.v31.patient') else null end,
  'service_id',case when kind_n='procedure' then current_setting('test.v31.service') else null end,
  'services',case when kind_n='procedure' then jsonb_build_array(jsonb_build_object('service_id',current_setting('test.v31.service'),'quantity',1)) else '[]'::jsonb end,
  'own_medications','[]'::jsonb,'items',items_n,'charge_total',charge_n,'paid_total',0,'payment_status',status_n,
  'payments',jsonb_build_object('cash',0),'expected_stock_deducted',false,'expected_partial_stock',true,
  'arrival_at','2096-12-31T10:00:00+03:00','notes','TEST measured acceptance v31')
$$;
create function pg_temp.v31_edit(a jsonb,items_n jsonb,charge_n numeric) returns jsonb language sql as $$
 select pg_temp.v31_payload(a->>'kind',items_n,charge_n,case when(a->>'payment_pending')::boolean then 'pending' else 'debt' end)
  ||jsonb_build_object('kind',a->>'kind','id',a->>'id','expected_version',a->'version',
   'services',a->'services','own_medications',a->'own_medications','edit_reason','TEST measured quantity correction v31')
$$;
-- Independent persisted state detects partial writes on rejection and retries.
create function pg_temp.v31_state() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'procedures',(select jsonb_agg(to_jsonb(p) order by p.id) from public.procedures p where p.shift_id=current_setting('test.v31.shift')::uuid),
  'sales',(select jsonb_agg(to_jsonb(s) order by s.id) from public.sales s where s.shift_id=current_setting('test.v31.shift')::uuid),
  'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a where a.created_by in(current_setting('test.v31.owner')::uuid,current_setting('test.v31.nurse')::uuid)),
  'receipts',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r where r.created_by in(current_setting('test.v31.owner')::uuid,current_setting('test.v31.nurse')::uuid)),
  'requests',(select jsonb_agg(to_jsonb(r) order by r.id) from private.warehouse_requests r where r.staff_user in(current_setting('test.v31.owner')::uuid,current_setting('test.v31.nurse')::uuid)),
  'partial_requests',(select jsonb_agg(to_jsonb(r) order by r.request_id) from private.crm_partial_stock_requests_v28 r where r.actor_user in(current_setting('test.v31.owner')::uuid,current_setting('test.v31.nurse')::uuid)),
  'save_requests',(select jsonb_agg(to_jsonb(r) order by r.request_id) from private.crm_save_requests_v16 r where r.actor_user in(current_setting('test.v31.owner')::uuid,current_setting('test.v31.nurse')::uuid)),
  'templates',(select jsonb_agg(to_jsonb(t) order by t.id) from private.crm_procedure_templates t where t.name like 'TEST measured template v31%'),
  'stock',(select jsonb_agg(to_jsonb(s) order by s.medication_id,s.location) from public.stock s where s.medication_id in(select value::uuid from jsonb_array_elements_text(current_setting('test.v31.medications')::jsonb))),
  'batches',(select jsonb_agg(to_jsonb(b) order by b.id) from public.medication_batches b where b.medication_id in(select value::uuid from jsonb_array_elements_text(current_setting('test.v31.medications')::jsonb))),
  'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.stock_movements m where m.medication_id in(select value::uuid from jsonb_array_elements_text(current_setting('test.v31.medications')::jsonb))),
  'returns',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_stock_returns_v10 r where r.movement_id in(select id from public.stock_movements where medication_id=current_setting('test.v31.tracked')::uuid)),
  'partial_lines',(select jsonb_agg(to_jsonb(l) order by l.kind,l.record_id,l.medication_id) from private.crm_partial_stock_lines_v28 l where l.medication_id in(select value::uuid from jsonb_array_elements_text(current_setting('test.v31.medications')::jsonb))),
  'audit',(select count(*) from private.crm_audit_log where actor_user in(current_setting('test.v31.owner')::uuid,current_setting('test.v31.nurse')::uuid)))
$$;

set local role authenticated;
select public.crm_partial_stock_v28('mode_set','{"enabled":true}',gen_random_uuid());
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v31.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v31.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare key_n text;kind_n text;q numeric;price_n numeric;charge_n numeric;p jsonb;a jsonb;line_n jsonb;req uuid;before_n jsonb;
begin
 -- Both prices and both requested quantities work in both public creation paths.
 foreach key_n in array array['reta','moun'] loop
  price_n:=case when key_n='reta' then 1500 else 1300 end;
  foreach q in array array[2.5::numeric,7.5::numeric] loop
   foreach kind_n in array array['procedure','sale'] loop
    charge_n:=price_n*q+case when kind_n='procedure' then 100 else 0 end;
    p:=pg_temp.v31_payload(kind_n,pg_temp.v31_item(key_n,q),charge_n,case when kind_n='procedure' then 'pending' else 'debt' end);
    req:=gen_random_uuid();a:=public.record_treatment_v5(kind_n,p,req);line_n:=a->'items'->0;
    perform pg_temp.v31_assert((line_n->>'quantity')::numeric=q and line_n->>'unit'='мг'
     and (line_n->>'unit_price')::numeric=price_n and (line_n->>'line_total')::numeric=price_n*q,'Measured line quantity, price or amount is wrong');
    perform pg_temp.v31_assert((a->>'list_total')::numeric=charge_n and (a->>'charge_total')::numeric=charge_n
     and (a->>'received_total')::numeric=0 and (a->>'debt_total')::numeric=charge_n,'Unpaid measured record fabricated cash or lost its balance');
    perform pg_temp.v31_assert((a->>'payment_pending')::boolean=(kind_n='procedure'),'Pending and true debt states were confused');
    perform pg_temp.v31_assert(a->>'stock_mode'='partial' and (a->'stock_summary'->>'requested_quantity')::numeric=q
     and (a->'stock_summary'->>'deducted_quantity')::numeric=0 and (a->'stock_summary'->>'pending_quantity')::numeric=q
     and line_n->>'pending_reason'='untracked','Untracked fractional quantity was not preserved for review');
    before_n:=pg_temp.v31_state();
    perform pg_temp.v31_assert(public.record_treatment_v5(kind_n,p,req)=a and pg_temp.v31_state()=before_n,'Fractional creation retry changed persisted state');
    if q=2.5 then perform set_config('test.v31.'||key_n||'_'||kind_n,a->>'id',true);end if;
   end loop;
  end loop;
 end loop;
 p:=pg_temp.v31_payload('procedure',pg_temp.v31_item('reta',2.5)||pg_temp.v31_item('amp',2),4050);
 a:=public.record_treatment_v5('procedure',p,gen_random_uuid());
 perform pg_temp.v31_assert(jsonb_array_length(a->'items')=2 and (a->>'charge_total')::numeric=4050
  and exists(select 1 from jsonb_array_elements(a->'items') x where x->>'medication_id'=current_setting('test.v31.amp')
   and (x->>'quantity')::numeric=2 and (x->>'line_total')::numeric=200),'Mixed measured medicine and whole ampoules failed');
 a:=public.record_treatment_v5('sale',pg_temp.v31_payload('sale',pg_temp.v31_item('moun',0.001),1.30,'debt'),gen_random_uuid());
 perform pg_temp.v31_assert((a->'items'->0->>'quantity')::numeric=0.001 and (a->'items'->0->>'line_total')::numeric=1.30,'Three-decimal quantity or money rounding failed');
 -- The separate pen is a whole product with its own unchanged price.
 a:=public.record_treatment_v5('sale',pg_temp.v31_payload('sale',pg_temp.v31_item('pen',1),60000,'debt'),gen_random_uuid());
 perform pg_temp.v31_assert((a->'items'->0->>'unit_price')::numeric=60000 and (a->'items'->0->>'quantity')::numeric=1,'Separate pen price or whole quantity changed');
end $$;

do $$declare p jsonb;args_n jsonb;t jsonb;a jsonb;listed_n jsonb;req uuid:=gen_random_uuid();before_n jsonb;
begin
 p:=jsonb_build_object('name','TEST measured template v31','service_id',current_setting('test.v31.service'),
  'items',pg_temp.v31_item('reta',2.5)||pg_temp.v31_item('moun',7.5)||pg_temp.v31_item('amp',1),'notes','TEST reusable quantities only');
 args_n:=jsonb_build_object('p_action','template_save','p_payload',p);
 t:=public.crm_save_recovery_v16('crm_management_v5',args_n,req)->'result';
 perform pg_temp.v31_assert(t->>'id' is not null and jsonb_array_length(t->'items')=3
  and exists(select 1 from jsonb_array_elements(t->'items') x where x->>'medication_id'=current_setting('test.v31.reta') and (x->>'quantity')::numeric=2.5)
  and exists(select 1 from jsonb_array_elements(t->'items') x where x->>'medication_id'=current_setting('test.v31.moun') and (x->>'quantity')::numeric=7.5),'Fractional template was not saved');
 before_n:=pg_temp.v31_state();
 perform pg_temp.v31_assert(public.crm_save_recovery_v16('crm_management_v5',args_n,req)->'result'=t and pg_temp.v31_state()=before_n,'Template retry duplicated persisted data');
 listed_n:=public.crm_management_v5('templates_list','{}');
 perform pg_temp.v31_assert(exists(select 1 from jsonb_array_elements(listed_n) x where x->>'id'=t->>'id' and x->'items'=t->'items'),'Saved fractional template cannot be read back');
 p:=pg_temp.v31_payload('procedure',t->'items',13700)||jsonb_build_object('service_id',t->>'service_id');
 a:=public.record_treatment_v5('procedure',p,gen_random_uuid());
 perform pg_temp.v31_assert((a->>'list_total')::numeric=13700 and (a->>'charge_total')::numeric=13700
  and exists(select 1 from jsonb_array_elements(a->'items') x where x->>'medication_id'=current_setting('test.v31.reta') and (x->>'line_total')::numeric=3750)
  and exists(select 1 from jsonb_array_elements(a->'items') x where x->>'medication_id'=current_setting('test.v31.moun') and (x->>'line_total')::numeric=9750),'Applying saved fractional template changed quantities or prices');
end $$;

do $$declare bad_n jsonb;kind_n text;p jsonb;before_n jsonb;failed_n boolean;error_n text;req uuid;
begin
 -- Fail through public APIs and assert every rejected operation is atomic.
 for bad_n in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('key','amp','quantity',2.5),jsonb_build_object('key','vial','quantity',2.5),jsonb_build_object('key','pen','quantity',2.5),
  jsonb_build_object('key','reta','quantity',0),jsonb_build_object('key','reta','quantity',-2.5),
  jsonb_build_object('key','reta','quantity','NaN'),jsonb_build_object('key','reta','quantity','Infinity'),jsonb_build_object('key','reta','quantity','-Infinity'),
  jsonb_build_object('key','reta','quantity',0.0001),jsonb_build_object('key','reta','quantity',2.5001),
  jsonb_build_object('key','reta','quantity',1000000.001))) loop
  foreach kind_n in array array['procedure','sale'] loop
   p:=pg_temp.v31_payload(kind_n,jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v31.'||(bad_n->>'key')),'quantity',bad_n->'quantity')),100,'debt');
   before_n:=pg_temp.v31_state();failed_n:=false;error_n:=null;
   begin perform public.record_treatment_v5(kind_n,p,gen_random_uuid());exception when others then failed_n:=true;error_n:=sqlerrm;end;
   perform pg_temp.v31_assert(failed_n and error_n like 'Количество препарата:%','Invalid medicine quantity reached a public bill: '||bad_n::text);
   perform pg_temp.v31_assert(pg_temp.v31_state()=before_n,'Rejected measured bill left persisted effects');
  end loop;
 end loop;
 -- Individually valid duplicate lines cannot evade the existing clinical cap.
 p:=pg_temp.v31_payload('sale',pg_temp.v31_item('reta',600000)||pg_temp.v31_item('reta',600000),1800000000,'debt');
 before_n:=pg_temp.v31_state();failed_n:=false;
 begin perform public.record_treatment_v5('sale',p,gen_random_uuid());exception when others then failed_n:=true;end;
 perform pg_temp.v31_assert(failed_n and pg_temp.v31_state()=before_n,'Merged medicine quantity evaded its clinical cap');
 p:=jsonb_build_object('name','TEST measured template v31 rejected','service_id',current_setting('test.v31.service'),'items',pg_temp.v31_item('amp',2.5));
 before_n:=pg_temp.v31_state();failed_n:=false;
 begin perform public.crm_save_recovery_v16('crm_management_v5',jsonb_build_object('p_action','template_save','p_payload',p),gen_random_uuid());
 exception when others then failed_n:=true;end;
 perform pg_temp.v31_assert(failed_n and pg_temp.v31_state()=before_n,'Fractional ampoule template was saved or left a receipt');
 -- Procedure counts and patient-owned ampoules retain their existing rules.
 p:=pg_temp.v31_payload('procedure',pg_temp.v31_item('reta',2.5),3850)||jsonb_build_object('services',jsonb_build_array(jsonb_build_object('service_id',current_setting('test.v31.service'),'quantity',1.5)));
 before_n:=pg_temp.v31_state();failed_n:=false;
 begin perform public.record_treatment_v5('procedure',p,gen_random_uuid());exception when others then failed_n:=true;end;
 perform pg_temp.v31_assert(failed_n and pg_temp.v31_state()=before_n,'Fractional service count was accepted');
 p:=pg_temp.v31_payload('procedure',pg_temp.v31_item('reta',2.5),3850)||jsonb_build_object('own_medications',jsonb_build_array(jsonb_build_object('name','TEST own ampoule v31','quantity',1.5,'unit','амп.','source','patient')));
 before_n:=pg_temp.v31_state();failed_n:=false;
 begin perform public.record_treatment_v5('procedure',p,gen_random_uuid());exception when others then failed_n:=true;end;
 perform pg_temp.v31_assert(failed_n and pg_temp.v31_state()=before_n,'Fractional patient-owned ampoule count was accepted');
end $$;

do $$declare a jsonb;begin
 a:=public.record_treatment_v5('procedure',pg_temp.v31_payload('procedure',pg_temp.v31_item('tracked',2.5),3350),gen_random_uuid());
 perform pg_temp.v31_assert((a->'stock_summary'->>'deducted_quantity')::numeric=2.5 and (a->'stock_summary'->>'pending_quantity')::numeric=0,'Tracked measured usage was not fully deducted');
 perform set_config('test.v31.tracked_procedure',a->>'id',true);
end $$;
reset role;
do $$begin
 perform pg_temp.v31_assert((select quantity from public.stock where medication_id=current_setting('test.v31.tracked')::uuid and location='work')=7.5
  and exists(select 1 from public.medication_batches where id=current_setting('test.v31.batch')::uuid and quantity_remaining=7.5 and work_quantity=7.5 and quantity_received=10 and purchase_price_per_unit=11),
  '10 mg minus 2.5 mg did not leave the exact original batch at 7.5 mg');
end $$;
set local role authenticated;
do $$declare a jsonb;p jsonb;req uuid:=gen_random_uuid();before_n jsonb;begin
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v31.tracked_procedure')));
 p:=pg_temp.v31_edit(a,pg_temp.v31_item('tracked',1.25),1725);
 a:=public.crm_clinical_v10('treatment_edit',p,req);
 perform pg_temp.v31_assert((a->'stock_summary'->>'deducted_quantity')::numeric=1.25 and (a->>'charge_total')::numeric=1725,'Fractional reduction changed bill or stock quantities');
 before_n:=pg_temp.v31_state();
 perform pg_temp.v31_assert(public.crm_clinical_v10('treatment_edit',p,req)=a and pg_temp.v31_state()=before_n,'Fractional reduction retry returned stock twice');
end $$;
reset role;
do $$begin
 perform pg_temp.v31_assert((select quantity from public.stock where medication_id=current_setting('test.v31.tracked')::uuid and location='work')=8.75
  and exists(select 1 from public.medication_batches where id=current_setting('test.v31.batch')::uuid and quantity_remaining=8.75 and work_quantity=8.75),
  'Reducing 2.5 mg to 1.25 mg did not return exactly 1.25 mg');
 perform pg_temp.v31_assert((select sum(r.quantity) from private.crm_stock_returns_v10 r join public.stock_movements m on m.id=r.movement_id
  where m.procedure_id=current_setting('test.v31.tracked_procedure')::uuid)=1.25,'Return ledger lost fractional precision');
end $$;
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v31.tracked_procedure')));
 a:=public.crm_clinical_v10('treatment_edit',pg_temp.v31_edit(a,'[]',100),gen_random_uuid());
 perform pg_temp.v31_assert(jsonb_array_length(a->'items')=0 and (a->>'received_total')::numeric=0,'Removing measured medicine changed unpaid service or retained an item');
end $$;
reset role;
do $$begin
 perform pg_temp.v31_assert((select quantity from public.stock where medication_id=current_setting('test.v31.tracked')::uuid and location='work')=10
  and exists(select 1 from public.medication_batches where id=current_setting('test.v31.batch')::uuid and quantity_remaining=10 and work_quantity=10 and quantity_received=10 and purchase_price_per_unit=11),
  'Full measured removal did not restore the original batch and cost');
 perform pg_temp.v31_assert((select sum(r.quantity) from private.crm_stock_returns_v10 r join public.stock_movements m on m.id=r.movement_id
  where m.procedure_id=current_setting('test.v31.tracked_procedure')::uuid)=2.5,'Exact fractional returns do not total the original usage');
 perform pg_temp.v31_assert(not exists(select 1 from private.crm_partial_stock_lines_v28 where kind='procedure' and record_id=current_setting('test.v31.tracked_procedure')::uuid),'Removed medicine left a partial-stock line');
end $$;

-- Changing a synthetic catalogue price affects only later bills, including when
-- an earlier fractional bill is reopened and saved again without an extra payment.
update public.medications set sale_price=9999 where id=current_setting('test.v31.reta')::uuid;
update public.medications set sale_price=8888 where id=current_setting('test.v31.moun')::uuid;
set local role authenticated;
do $$declare key_n text;kind_n text;a jsonb;p jsonb;price_n numeric;begin
 foreach key_n in array array['reta','moun'] loop
  price_n:=case when key_n='reta' then 1500 else 1300 end;
  foreach kind_n in array array['procedure','sale'] loop
   a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind',kind_n,'id',current_setting('test.v31.'||key_n||'_'||kind_n)));
   perform pg_temp.v31_assert((a->'items'->0->>'unit_price')::numeric=price_n and (a->'items'->0->>'line_total')::numeric=price_n*2.5,'Catalogue edit repriced an earlier fractional record');
   p:=pg_temp.v31_edit(a,pg_temp.v31_item(key_n,2.5),price_n*2.5+case when kind_n='procedure' then 100 else 0 end);
   a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
   perform pg_temp.v31_assert((a->'items'->0->>'unit_price')::numeric=price_n and (a->'items'->0->>'line_total')::numeric=price_n*2.5
    and (a->>'received_total')::numeric=0,'Saving an earlier measured record lost its captured price or fabricated payment');
  end loop;
 end loop;
 a:=public.record_treatment_v5('sale',pg_temp.v31_payload('sale',pg_temp.v31_item('reta',0.5),4999.50,'debt'),gen_random_uuid());
 perform pg_temp.v31_assert((a->'items'->0->>'unit_price')::numeric=9999 and (a->'items'->0->>'line_total')::numeric=4999.50,'New measured bill did not use the new catalogue price');
end $$;
reset role;

do $$begin
 perform set_config('test.v31.expected_pending',(
  select coalesce(sum(charge_total),0)::text from(
   select charge_total from public.procedures where shift_id=current_setting('test.v31.shift')::uuid and payment_pending
   union all select charge_total from public.sales where shift_id=current_setting('test.v31.shift')::uuid and payment_pending) x),true);
 perform set_config('test.v31.expected_debt',(
  select coalesce(sum(charge_total),0)::text from(
   select charge_total from public.procedures where shift_id=current_setting('test.v31.shift')::uuid and not payment_pending
   union all select charge_total from public.sales where shift_id=current_setting('test.v31.shift')::uuid and not payment_pending) x),true);
 perform pg_temp.v31_assert(not exists(select 1 from private.crm_payment_allocations where created_by=current_setting('test.v31.nurse')::uuid and cash+terminal+owner_card<>0)
  and not exists(select 1 from private.crm_receipts_v10 where created_by=current_setting('test.v31.nurse')::uuid),'Saving or editing unpaid measured quantities created real money');
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.v31.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v31.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare report_n jsonb;drawer_n jsonb;begin
 report_n:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v31.shift')));
 perform pg_temp.v31_assert((report_n->'revenue'->>'total')::numeric=0 and (report_n->'revenue'->>'cash')::numeric=0
  and (report_n->'revenue'->>'terminal')::numeric=0 and (report_n->'revenue'->>'owner_card')::numeric=0,'Unpaid measured bills were counted as shift income');
 perform pg_temp.v31_assert((report_n->>'pending_total')::numeric=current_setting('test.v31.expected_pending')::numeric
  and (report_n->>'debt_total')::numeric=current_setting('test.v31.expected_debt')::numeric,'Fractional pending bills and true debts were mixed in reports');
 drawer_n:=public.crm_cash_drawer_v30('status',jsonb_build_object('shift_id',current_setting('test.v31.shift')));
 perform pg_temp.v31_assert((drawer_n->>'received_cash')::numeric=0 and drawer_n->'balance'='null'::jsonb
  and not(drawer_n->>'opening_confirmed')::boolean,'Unpaid measured bills fabricated physical cash or an opening balance');
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v31.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v31.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;req uuid:=gen_random_uuid();p jsonb;before_n jsonb;begin
 -- Only this actual after-procedure cash collection enters shift revenue.
 p:=jsonb_build_object('kind','procedure','id',current_setting('test.v31.reta_procedure'),
  'shift_id',current_setting('test.v31.shift'),'nurse_id',current_setting('test.v31.nurse_staff'),
  'payments',jsonb_build_object('cash',100),'comment','TEST actual after-procedure cash v31');
 a:=public.crm_clinical_v10('debt_payment',p,req);
 perform pg_temp.v31_assert((a->>'received_total')::numeric=100 and (a->>'debt_total')::numeric=3750,'Actual partial cash collection lost the measured bill balance');
 before_n:=pg_temp.v31_state();
 perform pg_temp.v31_assert(public.crm_clinical_v10('debt_payment',p,req)=a and pg_temp.v31_state()=before_n,'Measured bill cash receipt replay duplicated payment');
 -- A true debt collection follows its existing separate money ledger contract.
 a:=public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','sale','id',current_setting('test.v31.reta_sale'),
  'amount',500,'paid_on','2096-12-31','purpose','TEST true debt collection v31'),gen_random_uuid());
 perform pg_temp.v31_assert((a->>'received_total')::numeric=500 and (a->>'debt_total')::numeric=3250,'Measured true debt repayment changed its bill balance');
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v31.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v31.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;drawer_n jsonb;begin
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v31.shift')));
 drawer_n:=public.crm_cash_drawer_v30('status',jsonb_build_object('shift_id',current_setting('test.v31.shift')));
 perform pg_temp.v31_assert((a->'revenue'->>'total')::numeric=100 and (a->'revenue'->>'cash')::numeric=100
  and (drawer_n->>'received_cash')::numeric=100,'True debt repayment leaked into ordinary measured-bill income or physical cash');
end $$;
reset role;

do $$begin
 perform pg_temp.v31_assert(exists(select 1 from private.crm_receipts_v10 where procedure_id=current_setting('test.v31.reta_procedure')::uuid
  and not is_debt_repayment and cash=100 and shift_id=current_setting('test.v31.shift')::uuid)
  and exists(select 1 from private.crm_receipts_v10 where sale_id=current_setting('test.v31.reta_sale')::uuid
   and is_debt_repayment and unclassified_amount=500 and shift_id is null),'Actual collections lost ordinary-versus-debt classification');
 perform pg_temp.v31_assert(not exists(select 1 from public.stock_movements where medication_id in(current_setting('test.v31.reta')::uuid,current_setting('test.v31.moun')::uuid))
  and not exists(select 1 from public.stock where medication_id in(current_setting('test.v31.reta')::uuid,current_setting('test.v31.moun')::uuid) and quantity<>0),
  'Untracked measured records or their payments invented physical stock');
 perform pg_temp.v31_assert(exists(select 1 from public.medications where id=current_setting('test.v31.pen')::uuid and sale_price=60000 and consumption_unit='шприц-ручка'),
  'Separate whole pen changed during measured operations');
 -- Verify every pre-existing row and every historical price, stock movement,
 -- bill allocation and receipt captured before the synthetic fixtures.
 perform pg_temp.v31_assert(not exists(select 1 from v31_existing_patients b left join public.patients p using(id) where to_jsonb(p) is distinct from b.original),'Existing patient changed');
 perform pg_temp.v31_assert(not exists(select 1 from v31_existing_medications b left join public.medications m using(id) where to_jsonb(m) is distinct from b.original),'Existing medication or price changed');
 perform pg_temp.v31_assert(not exists(select 1 from v31_existing_stock b left join public.stock s using(medication_id,location) where to_jsonb(s) is distinct from b.original),'Existing stock changed');
 perform pg_temp.v31_assert(not exists(select 1 from v31_existing_batches b left join public.medication_batches m using(id) where to_jsonb(m) is distinct from b.original),'Existing batch or purchase cost changed');
 perform pg_temp.v31_assert(not exists(select 1 from v31_existing_movements b left join public.stock_movements m using(id) where to_jsonb(m) is distinct from b.original),'Existing movement changed');
 perform pg_temp.v31_assert(not exists(select 1 from v31_existing_procedures b left join public.procedures p using(id) where to_jsonb(p) is distinct from b.original),'Existing procedure changed');
 perform pg_temp.v31_assert(not exists(select 1 from v31_existing_sales b left join public.sales s using(id) where to_jsonb(s) is distinct from b.original),'Existing sale changed');
 perform pg_temp.v31_assert((select coalesce(jsonb_agg(to_jsonb(i) order by to_jsonb(i)::text),'[]') from public.procedure_medications i where procedure_id in(select id from v31_existing_procedures))
  =(select coalesce(jsonb_agg(original order by original::text),'[]') from v31_existing_procedure_items),'Historical procedure item quantities or prices changed');
 perform pg_temp.v31_assert((select coalesce(jsonb_agg(to_jsonb(i) order by to_jsonb(i)::text),'[]') from public.sale_items i where sale_id in(select id from v31_existing_sales))
  =(select coalesce(jsonb_agg(original order by original::text),'[]') from v31_existing_sale_items),'Historical sale item quantities or prices changed');
 perform pg_temp.v31_assert(not exists(select 1 from v31_existing_allocations b left join private.crm_payment_allocations a using(id) where to_jsonb(a) is distinct from b.original),'Existing payment allocation changed');
 perform pg_temp.v31_assert(not exists(select 1 from v31_existing_receipts b left join private.crm_receipts_v10 r using(id) where to_jsonb(r) is distinct from b.original),'Existing receipt changed');
end $$;
rollback;
