-- Lost-response replay, live authorization and existing price validation. All fixtures roll back.
begin;
select set_config('test.service.manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null limit 1),true);
select set_config('test.service.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
do $$begin
 if nullif(current_setting('test.service.manager'),'') is null or nullif(current_setting('test.service.nurse'),'') is null then
  raise exception 'Tests require active linked manager and nurse accounts';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.service.manager'),true);
set local role authenticated;
do $$declare payload jsonb;answer jsonb;request_id uuid:=gen_random_uuid();edit_payload jsonb;edit_request uuid:=gen_random_uuid();archive_request uuid:=gen_random_uuid();invalid_payload jsonb;begin
 payload:=jsonb_build_object('name','Service save v11 owner rollback','work_price',120.50,'consumables_price',30.25,'comment','Сохранить комментарий','active',true);
 answer:=public.crm_service_save_v11(payload,request_id);
 if answer->>'id' is null or answer->>'name'<>payload->>'name' or (answer->>'work_price')::numeric<>120.50
  or (answer->>'consumables_price')::numeric<>30.25 or answer->>'comment'<>'Сохранить комментарий' or not (answer->>'active')::boolean then
  raise exception 'Service creation lost price/metadata';end if;
 if answer is distinct from public.crm_service_save_v11(payload,request_id) then raise exception 'Service create replay changed';end if;
 perform set_config('test.service.id',answer->>'id',true);
 perform set_config('test.service.create_request',request_id::text,true);
 perform set_config('test.service.create_payload',payload::text,true);
 perform set_config('test.service.create_result',answer::text,true);
 begin
  perform public.crm_service_save_v11(payload||jsonb_build_object('work_price',999),request_id);
  raise exception 'Changed price reused service receipt';
 exception when others then if sqlerrm<>'Номер сохранения услуги уже использован с другими данными' then raise;end if;end;
 edit_payload:=jsonb_build_object('id',answer->>'id','work_price',200,'comment','Изменённый комментарий');
 answer:=public.crm_service_save_v11(edit_payload,edit_request);
 if answer->>'name'<>payload->>'name' or (answer->>'work_price')::numeric<>200
  or (answer->>'consumables_price')::numeric<>30.25 or answer->>'comment'<>'Изменённый комментарий' then
  raise exception 'Service partial edit changed untouched fields';end if;
 if answer is distinct from public.crm_service_save_v11(edit_payload,edit_request) then raise exception 'Service edit replay changed';end if;
 perform set_config('test.service.edit_request',edit_request::text,true);
 perform set_config('test.service.edit_payload',edit_payload::text,true);
 if current_setting('test.service.create_result')::jsonb is distinct from public.crm_service_save_v11(payload,request_id) then
  raise exception 'Older create receipt changed after an edit';end if;
 -- An archived service is a valid retained service, including replay of the
 -- earlier create and the archive operation itself.
 answer:=public.crm_service_save_v11(jsonb_build_object('id',current_setting('test.service.id'),'active',false),archive_request);
 if (answer->>'active')::boolean then raise exception 'Service archive failed';end if;
 if answer is distinct from public.crm_service_save_v11(jsonb_build_object('id',current_setting('test.service.id'),'active',false),archive_request) then
  raise exception 'Archived service replay changed';end if;
 if current_setting('test.service.create_result')::jsonb is distinct from public.crm_service_save_v11(payload,request_id) then
  raise exception 'Archive incorrectly invalidated service identity';end if;
 perform set_config('test.service.archive_request',archive_request::text,true);
 begin
  perform public.crm_service_save_v11(payload,null);
  raise exception 'Missing service request UUID accepted';
 exception when others then if sqlerrm<>'Не указан номер сохранения услуги' then raise;end if;end;
 begin
  perform public.crm_service_save_v11(null,gen_random_uuid());
  raise exception 'Null service payload accepted';
 exception when others then if sqlerrm<>'Некорректные данные' then raise;end if;end;
 begin
  perform public.crm_service_save_v11('[]',gen_random_uuid());
  raise exception 'Array service payload accepted';
 exception when others then if sqlerrm<>'Некорректные данные' then raise;end if;end;
 begin
  perform public.crm_service_save_v11('{"name":"  "}',gen_random_uuid());
  raise exception 'Empty service name accepted';
 exception when others then if sqlerrm<>'Укажите название услуги' then raise;end if;end;
 for invalid_payload in select value from jsonb_array_elements('[{"work_price":-1},{"consumables_price":-1},{"work_price":null},{"work_price":"NaN"},{"consumables_price":"Infinity"},{"work_price":"-Infinity"}]'::jsonb) loop
  begin
   perform public.crm_service_save_v11(jsonb_build_object('name','Invalid service rollback')||invalid_payload,gen_random_uuid());
   raise exception 'Invalid service price accepted';
  exception when others then if sqlerrm<>'Стоимость должна быть неотрицательной' then raise;end if;end;
 end loop;
 begin
  perform public.crm_service_save_v11(jsonb_build_object('id',gen_random_uuid(),'work_price',1),gen_random_uuid());
  raise exception 'Missing service edited';
 exception when others then if sqlerrm<>'Услуга не найдена' then raise;end if;end;
 -- Preserve both legacy endpoint support and its price alias.
 answer:=public.crm_management_v5('service_save','{"name":"Service save v11 legacy rollback","price":75}');
 if (answer->>'work_price')::numeric<>75 then raise exception 'Legacy service price alias failed';end if;
 perform set_config('test.service.legacy_id',answer->>'id',true);
 answer:=public.crm_service_save_v11('{"name":"Service save v11 removable rollback","price":0}',gen_random_uuid());
 perform set_config('test.service.delete_id',answer->>'id',true);
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.service.nurse'),true);
do $$begin
 begin
  perform public.crm_service_save_v11('{"name":"Forbidden nurse service","work_price":1}',gen_random_uuid());
  raise exception 'Nurse created service';
 exception when others then if sqlerrm<>'Редактировать прайс услуг может только владелец' then raise;end if;end;
 begin
  perform public.crm_service_save_v11(current_setting('test.service.edit_payload')::jsonb,gen_random_uuid());
  raise exception 'Nurse edited service';
 exception when others then if sqlerrm<>'Редактировать прайс услуг может только владелец' then raise;end if;end;
 begin
  perform public.crm_service_save_v11(current_setting('test.service.create_payload')::jsonb,current_setting('test.service.create_request')::uuid);
  raise exception 'Nurse received cached service';
 exception when others then if sqlerrm<>'Редактировать прайс услуг может только владелец' then raise;end if;end;
 if has_table_privilege('authenticated','private.crm_service_save_requests_v11','SELECT')
  or has_table_privilege('authenticated','private.crm_service_save_requests_v11','INSERT')
  or has_table_privilege('authenticated','private.crm_service_save_requests_v11','UPDATE')
  or has_table_privilege('authenticated','private.crm_service_save_requests_v11','DELETE') then raise exception 'Service receipts have direct authenticated access';end if;
 if has_function_privilege('anon','public.crm_service_save_v11(jsonb,uuid)','EXECUTE')
  or has_function_privilege('authenticated','private.crm_service_save_v11(jsonb,uuid)','EXECUTE') then raise exception 'Private or anonymous service save privilege exposed';end if;
end $$;
reset role;
-- Temporarily promote the linked nurse inside this rollback transaction to
-- exercise another authorized actor; no fixture auth.users account is needed.
update public.staff set role='admin' where auth_user_id=current_setting('test.service.nurse')::uuid;
set local role authenticated;
do $$declare answer jsonb;payload jsonb:='{"name":"Service save v11 admin rollback","work_price":0,"consumables_price":0}';request_id uuid:=gen_random_uuid();begin
 begin
  perform public.crm_service_save_v11(current_setting('test.service.create_payload')::jsonb,current_setting('test.service.create_request')::uuid);
  raise exception 'Another manager obtained service receipt';
 exception when others then if sqlerrm<>'Номер сохранения услуги уже использован с другими данными' then raise;end if;end;
 answer:=public.crm_service_save_v11(payload,request_id);
 if answer->>'id' is null or answer is distinct from public.crm_service_save_v11(payload,request_id) then raise exception 'Admin service create/replay failed';end if;
 perform set_config('test.service.admin_id',answer->>'id',true);
 perform set_config('test.service.admin_request',request_id::text,true);
 perform set_config('test.service.admin_payload',payload::text,true);
end $$;
reset role;
update public.staff set role='nurse' where auth_user_id=current_setting('test.service.nurse')::uuid;
set local role authenticated;
do $$begin
 begin
  perform public.crm_service_save_v11(current_setting('test.service.admin_payload')::jsonb,current_setting('test.service.admin_request')::uuid);
  raise exception 'Demoted admin received a service receipt';
 exception when others then if sqlerrm<>'Редактировать прайс услуг может только владелец' then raise;end if;end;
end $$;
reset role;
update public.staff set active=false where auth_user_id=current_setting('test.service.manager')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.service.manager'),true);
set local role authenticated;
do $$begin
 begin
  perform public.crm_service_save_v11(current_setting('test.service.create_payload')::jsonb,current_setting('test.service.create_request')::uuid);
  raise exception 'Inactive owner received a service receipt';
 exception when others then if sqlerrm<>'Редактировать прайс услуг может только владелец' then raise;end if;end;
end $$;
reset role;
update public.staff set active=true where auth_user_id=current_setting('test.service.manager')::uuid;
do $$declare service_id_value uuid:=current_setting('test.service.id')::uuid;begin
 if (select count(*) from public.procedure_services where name='Service save v11 owner rollback')<>1 then raise exception 'Service retry created duplicate rows';end if;
 if (select work_price from public.procedure_services where id=service_id_value)<>200
  or (select consumables_price from public.procedure_services where id=service_id_value)<>30.25
  or (select active from public.procedure_services where id=service_id_value) then raise exception 'Replay overwrote later service edit/archive';end if;
 if (select count(*) from private.crm_audit_log where entity_type='procedure_services' and entity_id=service_id_value::text and action='insert')<>1
  or (select count(*) from private.crm_audit_log where entity_type='procedure_services' and entity_id=service_id_value::text and action='update')<>2 then
  raise exception 'Replay duplicated service trigger audit';end if;
 if (select count(*) from private.crm_service_save_requests_v11 where request_id in
  (current_setting('test.service.create_request')::uuid,current_setting('test.service.edit_request')::uuid,current_setting('test.service.archive_request')::uuid,current_setting('test.service.admin_request')::uuid))<>4 then
  raise exception 'Service receipt cardinality incorrect';end if;
 if exists(select 1 from public.procedure_services where name='Invalid service rollback') then raise exception 'Invalid service survived validation rollback';end if;
 if not (select relrowsecurity from pg_class where oid='private.crm_service_save_requests_v11'::regclass) then raise exception 'Service receipt RLS disabled';end if;
 perform set_config('test.service.delete_request',(select request_id::text from private.crm_service_save_requests_v11 where service_id=current_setting('test.service.delete_id')::uuid),true);
end $$;
-- The removable service has no clinical references; physical deletion must
-- invalidate its old create receipt without recreating the row.
delete from public.procedure_services where id=current_setting('test.service.delete_id')::uuid;
set local role authenticated;
do $$begin
 begin
  perform public.crm_service_save_v11('{"name":"Service save v11 removable rollback","price":0}',current_setting('test.service.delete_request')::uuid);
  raise exception 'Physically deleted service returned from receipt';
 exception when others then if sqlerrm<>'Услуга не найдена' then raise;end if;end;
 begin
  perform public.crm_service_save_v11(jsonb_build_object('id',current_setting('test.service.delete_id'),'work_price',1),gen_random_uuid());
  raise exception 'Physically deleted service edited';
 exception when others then if sqlerrm<>'Услуга не найдена' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 begin
  perform public.crm_service_save_v11(current_setting('test.service.create_payload')::jsonb,current_setting('test.service.create_request')::uuid);
  raise exception 'Anonymous request received service receipt';
 exception when others then if sqlerrm<>'Войдите в программу' then raise;end if;end;
end $$;
reset role;
do $$begin
 if exists(select 1 from public.procedure_services where id=current_setting('test.service.delete_id')::uuid) then raise exception 'Replay recreated removed service';end if;
end $$;
select 'service save v11: one row/audit, create/edit/archive replay, price validation, role revocation, private receipts, deleted guards and legacy compatibility passed' as result;
rollback;
