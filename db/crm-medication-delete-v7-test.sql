-- Synthetic fixtures only. Existing staff login metadata is used to test the
-- actual role boundary; all fixtures, requests, balances and audit roll back.
begin;
select set_config('test.v7.manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null limit 1),true);
select set_config('test.v7.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.v7.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v7.manager'),'role','authenticated')::text,true);

do $$ declare med uuid;batch uuid;sh uuid;pt uuid;sv uuid;n uuid;empty_med uuid;archive_med uuid;
begin
 if nullif(current_setting('test.v7.manager'),'') is null or nullif(current_setting('test.v7.nurse'),'') is null then
  raise exception 'Tests require linked active owner and nurse accounts';end if;
 select id into n from public.staff where auth_user_id=current_setting('test.v7.nurse')::uuid and active limit 1;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2095-09-12',now(),now()+interval '8 hours','open') returning id into sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,n);
 insert into public.patients(full_name) values('Тест удаления v7 — вымышленный пациент') returning id into pt;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('Тест удаления v7 — услуга',100,0,true) returning id into sv;
 insert into public.medications(name,consumption_unit,purchase_unit,units_per_package,purchase_price,sale_price,manufacturer,comment)
  values('Тест удаления v7 — флаконы','фл.','упаковка',10,100,20,'Вымышленный производитель','Сохранить карточку и историю') returning id into med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(med,14,14,6,10,current_date+100) returning id into batch;
 -- Deleting a card also removes expired and undated stock, which cannot be
 -- used by the clinical FEFO path but must not remain in aggregate balances.
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(med,5,5,2,7,current_date-1),(med,2,2,0,8,null);
 insert into public.stock(medication_id,location,quantity) values(med,'reserve',13),(med,'work',8);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price)
  values('Тест удаления v7 — пустая карточка','фл.',1,0,0) returning id into empty_med;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,active)
  values('Тест удаления v7 — обычный архив','фл.',1,0,0,false) returning id into archive_med;
 perform set_config('test.v7.med',med::text,true);perform set_config('test.v7.batch',batch::text,true);
 perform set_config('test.v7.shift',sh::text,true);perform set_config('test.v7.patient',pt::text,true);
 perform set_config('test.v7.service',sv::text,true);perform set_config('test.v7.nurse_id',n::text,true);
 perform set_config('test.v7.empty',empty_med::text,true);perform set_config('test.v7.archive',archive_med::text,true);
end $$;

-- Keep genuine procedure and sale references to the synthetic medication.
select set_config('request.jwt.claim.sub',current_setting('test.v7.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v7.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare p jsonb;r jsonb;action_name text;failed boolean;
begin
 p:=jsonb_build_object('shift_id',current_setting('test.v7.shift'),'nurse_id',current_setting('test.v7.nurse_id'),
  'patient_id',current_setting('test.v7.patient'),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v7.med'),'quantity',2)),
  'paid_total',40,'payments',jsonb_build_object('terminal',40));
 r:=public.record_treatment_v5('sale',p,gen_random_uuid());perform set_config('test.v7.sale',r->>'id',true);
 p:=p||jsonb_build_object('service_id',current_setting('test.v7.service'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v7.med'),'quantity',1)),
  'paid_total',120,'payments',jsonb_build_object('terminal',120));
 r:=public.record_treatment_v5('procedure',p,gen_random_uuid());perform set_config('test.v7.procedure',r->>'id',true);
 foreach action_name in array array['preview','delete','list_deleted','restore'] loop
  failed:=false;
  begin perform public.crm_medication_delete_v7(action_name,jsonb_build_object('id',current_setting('test.v7.med'),
   'expected_reserve',13,'expected_work',5,'reason','Медсестре запрещено'),gen_random_uuid());
  exception when raise_exception then failed:=true;end;
  if not failed then raise exception 'Nurse allowed action %',action_name;end if;
 end loop;
end $$;
reset role;
select set_config('test.v7.batches_before',(select jsonb_agg(to_jsonb(b) order by b.id)::text from public.medication_batches b where medication_id=current_setting('test.v7.med')::uuid),true);
select set_config('test.v7.sales_before',(select to_jsonb(s)::text from public.sales s where id=current_setting('test.v7.sale')::uuid),true);
select set_config('test.v7.procedure_before',(select to_jsonb(p)::text from public.procedures p where id=current_setting('test.v7.procedure')::uuid),true);

select set_config('request.jwt.claim.sub',current_setting('test.v7.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v7.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare med uuid:=current_setting('test.v7.med')::uuid;p jsonb;r jsonb;req uuid;failed boolean;bad_value text;action_name text;
begin
 r:=public.crm_medication_delete_v7('preview',jsonb_build_object('id',med));
 if(r->>'reserve')::numeric<>13 or(r->>'work')::numeric<>5 or(r->>'total')::numeric<>18
  or(r->>'expected_reserve')::numeric<>13 or(r->>'expected_work')::numeric<>5
  or(r->>'restore_stock')::numeric<>0 or not(r->>'history_preserved')::boolean then raise exception 'Preview incorrect';end if;
 p:=jsonb_build_object('id',med,'expected_reserve',13,'expected_work',5,'reason','Лишняя карточка после ошибки ввода');
 failed:=false;
 begin perform public.crm_medication_delete_v7('delete',p||jsonb_build_object('expected_reserve',12),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Stale reserve balance accepted';end if;
 failed:=false;
 begin perform public.crm_medication_delete_v7('delete',p||jsonb_build_object('expected_work',4),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Stale work balance accepted';end if;
 foreach bad_value in array array['-1','0.5','NaN','Infinity'] loop
  failed:=false;
  begin perform public.crm_medication_delete_v7('delete',p||jsonb_build_object('expected_work',bad_value),gen_random_uuid());exception when raise_exception then failed:=true;end;
  if not failed then raise exception 'Invalid expected balance accepted: %',bad_value;end if;
 end loop;
 foreach action_name in array array['expected_reserve','expected_work','reason'] loop
  failed:=false;
  begin perform public.crm_medication_delete_v7('delete',p-action_name,gen_random_uuid());exception when raise_exception then failed:=true;end;
  if not failed then raise exception 'Required field not enforced: %',action_name;end if;
 end loop;
 failed:=false;
 begin perform public.crm_medication_delete_v7('delete',p||jsonb_build_object('reason',repeat('x',1001)),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Overlong reason accepted';end if;
 failed:=false;
 begin perform public.crm_medication_delete_v7('delete',p,null);exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Delete missing request id accepted';end if;
 req:=gen_random_uuid();r:=public.crm_medication_delete_v7('delete',p,req);
 if not(r->>'deleted')::boolean or(r->>'active')::boolean or(r->>'total_removed')::numeric<>18
  or(r->>'reserve')::numeric<>0 or(r->>'work')::numeric<>0 then raise exception 'Delete result incorrect';end if;
 perform set_config('test.v7.delete_payload',p::text,true);perform set_config('test.v7.delete_request',req::text,true);
 perform set_config('test.v7.delete_result',r::text,true);
 if public.crm_medication_delete_v7('delete',p,req)<>r then raise exception 'Delete retry not idempotent';end if;
 failed:=false;
 begin perform public.crm_medication_delete_v7('delete',p||jsonb_build_object('reason','Другой запрос'),req);exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Request id reused with changed payload';end if;
 failed:=false;
 begin perform public.crm_medication_delete_v7('restore',p,req);exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Request id reused for other action';end if;
 failed:=false;
 begin perform public.crm_medication_delete_v7('delete',p,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Deleted twice with different request ids';end if;
 if exists(select 1 from jsonb_array_elements(public.warehouse_v5('list','{}')) x where x->>'id'=med::text) then raise exception 'Deleted card appears in owner warehouse';end if;
 if exists(select 1 from jsonb_array_elements(public.work_catalog_v2()) x where x->>'id'=med::text) then raise exception 'Deleted card appears in working catalogue';end if;
 r:=public.crm_medication_delete_v7('list_deleted');
 if not exists(select 1 from jsonb_array_elements(r) x where x->>'id'=med::text and(x->>'total_removed')::numeric=18 and(x->>'restore_stock')::numeric=0) then
  raise exception 'Deleted list omitted card or removed quantities';end if;
 -- A stale old application is unable to bypass the new deleted-card guard.
 failed:=false;
 begin perform public.warehouse_v5('restore',jsonb_build_object('id',med),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Legacy restore resurrected deleted card';end if;
 failed:=false;
 begin perform public.warehouse_v5('save',jsonb_build_object('id',med,'name','Старая вкладка попыталась изменить карточку',
  'unit','фл.','units_per_package',10,'purchase_price',100,'sale_price',20,'min_total_stock',0,'work_threshold',0,'lead_time_days',3),gen_random_uuid());
 exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Legacy save changed deleted card';end if;
 failed:=false;
 begin perform public.warehouse_v5('receive',jsonb_build_object('id',med,'packages',1,'price',100,'expiry',current_date+100),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Delivery to deleted medication accepted';end if;
 failed:=false;
 begin perform public.warehouse_v5('opening',jsonb_build_object('id',med,'quantity',1,'price',100,'expiry',current_date+100,'location','reserve'),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Opening stock on deleted medication accepted';end if;
 failed:=false;
 begin perform public.crm_management_v5('template_save',jsonb_build_object('name','Удалённый препарат в новом шаблоне','service_id',current_setting('test.v7.service'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',med,'quantity',1))));exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Deleted medication allowed in new template';end if;
 r:=public.crm_management_v5('backup_export');
 if not exists(select 1 from jsonb_array_elements(r->'tables'->'private.crm_deleted_medications_v7') x
   where x->>'medication_id'=med::text and(x->>'reserve_removed')::numeric=13 and(x->>'work_removed')::numeric=5) then
  raise exception 'Owner backup omits deleted medication state';end if;
end $$;
reset role;

do $$ declare med uuid:=current_setting('test.v7.med')::uuid;before_batch jsonb;
begin
 perform private.assert_stock_v3(med);
 if(select active from public.medications where id=med) then raise exception 'Card still active after delete';end if;
 if not exists(select 1 from public.medications where id=med and name='Тест удаления v7 — флаконы'
  and manufacturer='Вымышленный производитель' and comment='Сохранить карточку и историю' and sale_price=20 and purchase_price=100) then raise exception 'Metadata lost';end if;
 if exists(select 1 from public.stock where medication_id=med and quantity<>0)
  or exists(select 1 from public.medication_batches where medication_id=med and(quantity_remaining<>0 or work_quantity<>0)) then raise exception 'Deleted medication retains stock';end if;
 for before_batch in select value from jsonb_array_elements(current_setting('test.v7.batches_before')::jsonb) loop
  if(select to_jsonb(b)-'quantity_remaining'-'work_quantity' from public.medication_batches b where id=(before_batch->>'id')::uuid)
   is distinct from before_batch-'quantity_remaining'-'work_quantity' then raise exception 'Historic batch metadata/cost/received quantity changed';end if;
 end loop;
 if(select count(*) from public.stock_movements where medication_id=med and movement_type='write_off')<>5
  or(select sum(quantity) from public.stock_movements where medication_id=med and movement_type='write_off')<>18 then raise exception 'Delete ledger duplicated or wrong';end if;
 if exists(select 1 from public.stock_movements where medication_id=med and movement_type='write_off'
  and(actor_user is distinct from current_setting('test.v7.manager')::uuid or actor_staff is null or position('Лишняя карточка после ошибки ввода' in comment)=0)) then raise exception 'Write-off actor/reason missing';end if;
 if(select count(*) from private.crm_audit_log where entity_id=med::text and action='medication_deleted')<>1 then raise exception 'Delete audit duplicated or absent';end if;
 if not exists(select 1 from private.crm_deleted_medications_v7 where medication_id=med and previous_active
  and reserve_removed=13 and work_removed=5 and deleted_by=current_setting('test.v7.manager')::uuid and deleted_staff is not null) then raise exception 'Tombstone invalid';end if;
 if(select to_jsonb(s) from public.sales s where id=current_setting('test.v7.sale')::uuid) is distinct from current_setting('test.v7.sales_before')::jsonb then raise exception 'Historic sale changed';end if;
 if(select to_jsonb(p) from public.procedures p where id=current_setting('test.v7.procedure')::uuid) is distinct from current_setting('test.v7.procedure_before')::jsonb then raise exception 'Historic procedure changed';end if;
 if not exists(select 1 from public.sale_items where sale_id=current_setting('test.v7.sale')::uuid and medication_id=med and quantity=2 and unit_price=20)
  or not exists(select 1 from public.procedure_medications where procedure_id=current_setting('test.v7.procedure')::uuid and medication_id=med and quantity=1 and unit_price=20) then raise exception 'Clinical medication references changed';end if;
end $$;

-- Clinical writes still reject the removed card, even with the old id.
select set_config('request.jwt.claim.sub',current_setting('test.v7.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v7.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare p jsonb;failed boolean:=false;
begin
 p:=jsonb_build_object('shift_id',current_setting('test.v7.shift'),'nurse_id',current_setting('test.v7.nurse_id'),
  'patient_id',current_setting('test.v7.patient'),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v7.med'),'quantity',1)),
  'paid_total',20,'payments',jsonb_build_object('terminal',20));
 begin perform public.record_treatment_v5('sale',p,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Clinical sale allowed deleted medication';end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v7.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v7.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare med uuid:=current_setting('test.v7.med')::uuid;p jsonb;r jsonb;req uuid;other_med uuid;action_name text;
begin
 p:=jsonb_build_object('id',med,'reason','Карточку удалили по ошибке');req:=gen_random_uuid();
 r:=public.crm_medication_delete_v7('restore',p,req);
 if not(r->>'restored')::boolean or not(r->>'active')::boolean or(r->>'total')::numeric<>0 then raise exception 'Restoration incorrect';end if;
 if public.crm_medication_delete_v7('restore',p,req)<>r then raise exception 'Restore retry not idempotent';end if;
 if public.crm_medication_delete_v7('delete',current_setting('test.v7.delete_payload')::jsonb,current_setting('test.v7.delete_request')::uuid)
  <>current_setting('test.v7.delete_result')::jsonb then raise exception 'Old committed delete replay changed after restoration';end if;
 if not exists(select 1 from jsonb_array_elements(public.warehouse_v5('list','{}')) x where x->>'id'=med::text and(x->>'active')::boolean) then raise exception 'Restored card missing from catalogue';end if;
 if exists(select 1 from jsonb_array_elements(public.crm_medication_delete_v7('list_deleted')) x where x->>'id'=med::text) then raise exception 'Restored card remains deleted';end if;
 -- Zero-stock deletion creates no stock movements; ordinary archive status is
 -- also preserved when restoring an archived card rather than activating it.
 foreach action_name in array array['test.v7.empty','test.v7.archive'] loop
  other_med:=current_setting(action_name)::uuid;
  r:=public.crm_medication_delete_v7('delete',jsonb_build_object('id',other_med,'expected_reserve',0,'expected_work',0,'reason','Лишняя пустая карточка'),gen_random_uuid());
  if(r->>'total_removed')::numeric<>0 then raise exception 'Zero stock deletion incorrect';end if;
  r:=public.crm_medication_delete_v7('restore',jsonb_build_object('id',other_med,'reason','Вернуть карточку'),gen_random_uuid());
  if(r->>'active')::boolean is distinct from(action_name='test.v7.empty') then raise exception 'Previous archive status not restored';end if;
 end loop;
end $$;
reset role;

-- A session without a linked identity cannot use even read-only preview/list.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
do $$ declare failed boolean:=false;
begin
 begin perform public.crm_medication_delete_v7('list_deleted');exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Unauthenticated linked-role session allowed';end if;
end $$;
reset role;

do $$ declare med uuid:=current_setting('test.v7.med')::uuid;
begin
 perform private.assert_stock_v3(med);
 if not(select active from public.medications where id=med) then raise exception 'Replayed old delete changed restored card';end if;
 if exists(select 1 from public.stock where medication_id=med and quantity<>0)
  or exists(select 1 from public.medication_batches where medication_id=med and(quantity_remaining<>0 or work_quantity<>0)) then raise exception 'Restore recreated removed stock';end if;
 if(select count(*) from public.stock_movements where medication_id=med and movement_type='write_off')<>5 then raise exception 'Restore or retry duplicated ledger';end if;
 if(select count(*) from private.crm_audit_log where entity_id=med::text and action='medication_deleted')<>1
  or(select count(*) from private.crm_audit_log where entity_id=med::text and action='medication_restored')<>1 then raise exception 'Audit duplicated across restore/retries';end if;
 if exists(select 1 from public.stock_movements where medication_id in(current_setting('test.v7.empty')::uuid,current_setting('test.v7.archive')::uuid)) then raise exception 'Zero-stock delete invented movement';end if;
 if has_function_privilege('anon','public.crm_medication_delete_v7(text,jsonb,uuid)','EXECUTE')
  or has_function_privilege('anon','private.crm_medication_delete_v7(text,jsonb,uuid)','EXECUTE') then raise exception 'Anonymous API access';end if;
 if has_table_privilege('authenticated','private.crm_deleted_medications_v7','SELECT')
  or has_table_privilege('authenticated','private.crm_deleted_medications_v7','INSERT')
  or has_table_privilege('authenticated','private.crm_deleted_medications_v7','UPDATE')
  or has_table_privilege('authenticated','private.crm_deleted_medications_v7','DELETE') then raise exception 'Tombstone table exposed';end if;
 if not(select relrowsecurity from pg_class where oid='private.crm_deleted_medications_v7'::regclass) then raise exception 'Tombstone RLS not enabled';end if;
end $$;
rollback;
