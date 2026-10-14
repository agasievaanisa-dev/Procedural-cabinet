-- Existing archive API contract used by the v26 warehouse controls.
-- All fixtures and receipts are synthetic and rolled back, including on failure.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select set_config('test.archive_manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null limit 1),true);
select set_config('test.archive_nurse',coalesce((select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),gen_random_uuid()::text),true);
select set_config('request.jwt.claim.sub',current_setting('test.archive_manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.archive_manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare med uuid; batch uuid; r jsonb;
begin
 r:=public.warehouse_v5('save',jsonb_build_object('name','Синтетический тест архива v26 '||gen_random_uuid()::text,
  'unit','амп.','units_per_package',10,'purchase_price',1000,'sale_price',145.25,
  'min_total_stock',0,'work_threshold',0,'lead_time_days',3,
  'manufacturer','Тестовый производитель','release_form','Ампулы','comment','Только проверка с откатом'),gen_random_uuid());
 med:=(r->>'id')::uuid;
 r:=public.warehouse_v5('receive',jsonb_build_object('id',med,'packages',1,'price',1000,
  'expiry','2099-12-31','batch_number','ARCHIVE-V26-ROLLBACK','supplier','Синтетический поставщик'),gen_random_uuid());
 batch:=(r->>'batch_id')::uuid;
 if med is null or batch is null then raise exception 'Synthetic fixture was not saved';end if;
 perform public.warehouse_v5('inventory',jsonb_build_object('id',med,'batch_id',batch,'location','reserve',
  'actual_quantity',0,'reason','Синтетическая партия израсходована до проверки архива'),gen_random_uuid());
 perform set_config('test.archive_med',med::text,true);
 perform set_config('test.archive_batch',batch::text,true);
end $$;
reset role;
do $$
declare med uuid:=current_setting('test.archive_med')::uuid; snapshot jsonb;
begin
 select jsonb_build_object('card',(select to_jsonb(m)-'active' from public.medications m where id=med),
  'batches',(select jsonb_agg(to_jsonb(b) order by id) from public.medication_batches b where medication_id=med),
  'stock',(select jsonb_agg(to_jsonb(s) order by id) from public.stock s where medication_id=med),
  'movements',(select jsonb_agg(to_jsonb(s) order by id) from public.stock_movements s where medication_id=med)) into snapshot;
 perform set_config('test.archive_snapshot',snapshot::text,true);
end $$;
set local role authenticated;
do $$
declare med uuid:=current_setting('test.archive_med')::uuid; archive_request uuid:=gen_random_uuid();
 restore_request uuid:=gen_random_uuid(); r jsonb; denied boolean;
begin
 r:=public.warehouse_v5('archive',jsonb_build_object('id',med),archive_request);
 if r is distinct from jsonb_build_object('active',false) then raise exception 'Archive response contract changed';end if;
 if public.warehouse_v5('archive',jsonb_build_object('id',med),archive_request) is distinct from r then raise exception 'Archive retry changed';end if;
 if exists(select 1 from jsonb_array_elements(public.work_catalog_v2()) v where v->>'id'=med::text) then
  raise exception 'Archived medicine remains in the clinical catalogue';end if;
 r:=public.warehouse_v5('restore',jsonb_build_object('id',med),restore_request);
 if r is distinct from jsonb_build_object('active',true) then raise exception 'Restore response contract changed';end if;
 if public.warehouse_v5('restore',jsonb_build_object('id',med),restore_request) is distinct from r then raise exception 'Restore retry changed';end if;
 if not exists(select 1 from jsonb_array_elements(public.work_catalog_v2()) v where v->>'id'=med::text) then
  raise exception 'Restored medicine is absent from the clinical catalogue';end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.archive_nurse'),true);
 denied:=false;
 begin perform public.warehouse_v5('archive',jsonb_build_object('id',med),gen_random_uuid());
 exception when raise_exception or insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Nurse archived an owner-only medicine';end if;
 -- A cached successful receipt also requires current database membership.
 denied:=false;
 begin perform public.warehouse_v5('archive',jsonb_build_object('id',med),archive_request);
 exception when raise_exception or insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Cached receipt bypassed current role';end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.archive_manager'),true);
end $$;
reset role;
do $$
declare med uuid:=current_setting('test.archive_med')::uuid; snapshot jsonb;
begin
 select jsonb_build_object('card',(select to_jsonb(m)-'active' from public.medications m where id=med),
  'batches',(select jsonb_agg(to_jsonb(b) order by id) from public.medication_batches b where medication_id=med),
  'stock',(select jsonb_agg(to_jsonb(s) order by id) from public.stock s where medication_id=med),
  'movements',(select jsonb_agg(to_jsonb(s) order by id) from public.stock_movements s where medication_id=med)) into snapshot;
 if snapshot is distinct from current_setting('test.archive_snapshot')::jsonb then
  raise exception 'Archive/restore rewrote a price, lot, stock or historical movement';end if;
 if not (select active from public.medications where id=med) then raise exception 'Medicine was not restored';end if;
 perform private.assert_stock_v3(med);
end $$;
-- Prepare a nonzero working balance through the real warehouse API.
set local role authenticated;
do $$
declare med uuid:=current_setting('test.archive_med')::uuid; denied boolean;
begin
 perform public.warehouse_v5('receive',jsonb_build_object('id',med,'packages',1,'price',1000,'expiry','2099-12-31'),gen_random_uuid());
 perform public.warehouse_v5('transfer',jsonb_build_object('id',med,'quantity',10),gen_random_uuid());
 denied:=false;
 begin perform public.warehouse_v5('archive',jsonb_build_object('id',med),gen_random_uuid());
 exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Nonzero working stock was archived';end if;
end $$;
reset role;
do $$
declare med uuid:=current_setting('test.archive_med')::uuid;
begin
 if not (select active from public.medications where id=med) or
  (select quantity from public.stock where medication_id=med and location='work')<>10 then
  raise exception 'Rejected archive changed actual stock or activity';end if;
 perform private.assert_stock_v3(med);
end $$;
select true as archive_contract_and_history_verified;
rollback;
