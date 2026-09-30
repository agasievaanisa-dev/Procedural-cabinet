begin;
select set_config('test.manager',(select auth_user_id::text from public.staff where active and role in ('admin','owner') limit 1),true);
select set_config('test.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
-- Fixtures exist only until ROLLBACK.
do $$ declare s uuid; p uuid; sv uuid; n uuid;
begin
 select id into n from public.staff where auth_user_id=current_setting('test.nurse')::uuid;
 insert into public.shifts(status) values('open') returning id into s;
 insert into public.shift_staff(shift_id,staff_id) values(s,n);
 insert into public.patients(full_name) values('Тест учёта — вымышленный пациент') returning id into p;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('Тест учёта',100,50,true) returning id into sv;
 perform set_config('test.shift',s::text,true);perform set_config('test.patient',p::text,true);perform set_config('test.service',sv::text,true);perform set_config('test.nurse_id',n::text,true);
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
set local role authenticated;
do $$ declare med uuid; req uuid:=gen_random_uuid(); p jsonb; r jsonb;
begin
 med:=(public.warehouse_v2('save','{"name":"Lifecycle fixture","units_per_package":100,"purchase_price":1000,"sale_price":20,"min_total_stock":0,"work_threshold":0,"lead_time_days":3,"unit":"амп."}',gen_random_uuid())->>'id')::uuid;
 perform set_config('test.med',med::text,true);
 p:=jsonb_build_object('id',med,'packages',2,'price',1000,'expiry',current_date+100);
 perform public.warehouse_v2('receive',p,req);perform public.warehouse_v2('receive',p,req);
 perform public.warehouse_v2('opening',jsonb_build_object('id',med,'quantity',75,'price',1000,'expiry',current_date+200,'location','reserve'),gen_random_uuid());
 perform public.warehouse_v2('opening',jsonb_build_object('id',med,'quantity',13,'price',1000,'expiry',current_date+300,'location','work'),gen_random_uuid());
 p:=jsonb_build_object('id',med,'quantity',20);req:=gen_random_uuid();
 perform public.warehouse_v2('transfer',p,req);perform public.warehouse_v2('transfer',p,req);
 select x into r from jsonb_array_elements(public.warehouse_v2('list')) x where x->>'id'=med::text;
 if (r->>'reserve_qty')::numeric<>255 or (r->>'work_qty')::numeric<>33 then raise exception 'Receipt/transfer/retry totals wrong: %',r;end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
do $$ declare med uuid:=current_setting('test.med')::uuid; p jsonb; req uuid:=gen_random_uuid(); r jsonb; sale_r jsonb; failed boolean;
begin
 p:=jsonb_build_object('shift_id',current_setting('test.shift'),'nurse_id',current_setting('test.nurse_id'),'patient_id',current_setting('test.patient'),'service_id',current_setting('test.service'),'paid_total',190,'items',jsonb_build_array(jsonb_build_object('medication_id',med,'quantity',1),jsonb_build_object('medication_id',med,'quantity',1)));
 r:=public.record_treatment_v3('procedure',p,req);
 if public.record_treatment_v3('procedure',p,req)<>r then raise exception 'Procedure retry differs';end if;
 perform set_config('test.procedure',r->>'id',true);
 p:=p||jsonb_build_object('paid_total',50,'discount_reason','Акция','items',jsonb_build_array(jsonb_build_object('medication_id',med,'quantity',3)));
 req:=gen_random_uuid();sale_r:=public.record_treatment_v3('sale',p,req);
 if public.record_treatment_v3('sale',p,req)<>sale_r then raise exception 'Sale retry differs';end if;
 perform set_config('test.sale',sale_r->>'id',true);
 failed:=false;
 begin perform public.record_treatment_v3('sale',p||jsonb_build_object('paid_total',0,'items',jsonb_build_array(jsonb_build_object('medication_id',med,'quantity',100))),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Overdraw allowed';end if;
 failed:=false;
 begin perform public.record_treatment_v3('sale',p||jsonb_build_object('paid_total',0,'items',jsonb_build_array(jsonb_build_object('medication_id',med,'quantity',0.5))),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Fractional ampoule allowed';end if;
 failed:=false;
 begin perform public.warehouse_v2('list');exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse gained warehouse access';end if;
 if (select (x->>'work_qty')::numeric from jsonb_array_elements(public.work_catalog_v2()) x where x->>'id'=med::text)<>28 then raise exception 'Work catalog wrong';end if;
end $$;

do $$ declare r jsonb; t jsonb; med uuid:=current_setting('test.med')::uuid;
begin
 t:=public.quick_ui_v4('last_procedure',jsonb_build_object('patient_id',current_setting('test.patient')));
 if t->>'service_id'<>current_setting('test.service') or (t->'items'->0->>'quantity')::numeric<>2 then raise exception 'Repeat template wrong: %',t;end if;
 r:=public.quick_ui_v4('report',jsonb_build_object('shift_id',current_setting('test.shift')));
 if (r->'used'->0->>'quantity')::numeric<>5 or (r->>'cash_total')::numeric<>240 then raise exception 'V4 report wrong: %',r;end if;
 perform public.quick_ui_v4('favorite',jsonb_build_object('id',med,'selected',true));
 perform public.quick_ui_v4('favorite',jsonb_build_object('id',med,'selected',true));
 r:=public.quick_ui_v4('context');
 if (select count(*) from jsonb_array_elements_text(r->'favorites') f where f=med::text)<>1 then raise exception 'Favorite not idempotent';end if;
 if exists(select 1 from public.stock where medication_id=med) then raise exception 'Nurse read reserve stock';end if;
 if exists(select 1 from public.medication_batches where medication_id=med) then raise exception 'Nurse read reserve batches';end if;
 begin if exists(select 1 from public.medications where id=med) then raise exception 'Nurse read purchase prices';end if;exception when insufficient_privilege then null;end;
 if exists(select 1 from jsonb_array_elements(public.work_catalog_v2()) m where m ? 'purchase_price' or m ? 'reserve_qty') then raise exception 'Work catalog leaks reserve';end if;
end $$;

reset role;
do $$ declare med uuid:=current_setting('test.med')::uuid; batch uuid;
begin
 perform private.assert_stock_v3(med);
 if (select sum(quantity_remaining) from public.medication_batches where medication_id=med)<>283 then raise exception 'Total after procedure and sale wrong';end if;
 if (select sum(quantity) from public.procedure_medications where procedure_id=current_setting('test.procedure')::uuid)<>2 then raise exception 'Repeated medication rows wrong';end if;
 if (select count(*) from public.procedures where shift_id=current_setting('test.shift')::uuid)<>1 or (select count(*) from public.sales where shift_id=current_setting('test.shift')::uuid)<>1 then raise exception 'Duplicate clinical record';end if;
 if (select sum(quantity) from public.stock_movements where procedure_id=current_setting('test.procedure')::uuid)<>2 then raise exception 'Procedure history wrong';end if;
 if exists(select 1 from public.stock_movements where medication_id=med and batch_id is null) then raise exception 'Movement without batch';end if;
 select id into batch from public.medication_batches where medication_id=med and expiry_date=current_date+100;
 if (select work_quantity from public.medication_batches where id=batch)<>15 then raise exception 'FEFO consumed wrong batch';end if;
 update public.medication_batches set expiry_date=current_date-1 where id=batch;
 perform set_config('test.expired',batch::text,true);
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
set local role authenticated;
do $$ declare med uuid:=current_setting('test.med')::uuid; p jsonb; failed boolean; r jsonb;
begin
 -- 180 expired units in reserve cannot be transferred; only the later 75 may move.
 failed:=false;
 begin perform public.warehouse_v2('transfer',jsonb_build_object('id',med,'quantity',76),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Expired reserve transferred';end if;
 perform public.warehouse_v2('return',jsonb_build_object('id',med,'quantity',5),gen_random_uuid());
 p:=jsonb_build_object('id',med,'quantity',10,'batch_id',current_setting('test.expired'),'location','work','comment','Истёк срок — тест');
 perform public.warehouse_v2('writeoff',p,gen_random_uuid());
 select x into r from jsonb_array_elements(public.warehouse_v2('list')) x where x->>'id'=med::text;
 if (r->>'reserve_qty')::numeric<>260 or (r->>'work_qty')::numeric<>13 or (r->>'work_available')::numeric<>13 then raise exception 'Return/writeoff wrong: %',r;end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
do $$ declare p jsonb; failed boolean; r jsonb;
begin
 p:=jsonb_build_object('shift_id',current_setting('test.shift'),'nurse_id',current_setting('test.nurse_id'),'paid_total',0,'discount_reason','Акция','items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.med'),'quantity',14)));
 failed:=false;
 begin perform public.record_treatment_v3('sale',p,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Expired work consumed';end if;
 r:=public.shift_report_detailed_test(current_setting('test.shift')::uuid);
 if (r->>'cash_total')::numeric<>240 then raise exception 'Cash report wrong: %',r;end if;
 perform public.close_shift_v8(current_setting('test.shift')::uuid);
 failed:=false;
 begin perform public.record_treatment_v3('sale',p,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Closed shift accepted';end if;
end $$;
reset role;
do $$ begin perform private.assert_stock_v3(current_setting('test.med')::uuid);end $$;
set local role anon;
do $$ begin
 begin perform public.record_treatment_v3('sale','{}',gen_random_uuid());raise exception 'Anonymous allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
set local role authenticated;
do $$ declare r jsonb;begin
 r:=public.quick_ui_v4('context');
 if exists(select 1 from jsonb_array_elements_text(r->'favorites') f where f=current_setting('test.med')) then raise exception 'Another users favorites leaked';end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.quick_ui_v4('context');raise exception 'Anon access';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
