-- Meaningful authorization + atomicity tests. Run after v5 schema; all fixtures roll back.
begin;
select set_config('test.manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null limit 1),true);
select set_config('test.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
do $$ begin
 if nullif(current_setting('test.manager'),'') is null or nullif(current_setting('test.nurse'),'') is null then
  raise exception 'Tests require linked active manager and nurse accounts';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
do $$ declare m uuid;begin
 insert into public.medications(name,consumption_unit,purchase_unit,units_per_package,purchase_price,sale_price,min_total_stock)
 values('CRM v5 rollback test medicine','ед.','упаковка',1,20,30,0) returning id into m;
 perform set_config('test.med',m::text,true);
end $$;

set local role authenticated;
do $$ declare p jsonb;s jsonb;t jsonb;rows jsonb;staff_info jsonb;begin
 p:=public.crm_management_v5('patient_save',jsonb_build_object('full_name','CRM v5 patient rollback','sex','female'));
 perform set_config('test.patient',p->>'id',true);
 if p->>'full_name'<>'CRM v5 patient rollback' or p->>'birth_date' is not null or p->>'phone' is not null then raise exception 'Optional patient fields failed';end if;
 p:=public.crm_management_v5('patient_save',jsonb_build_object('id',p->>'id','notes','Назначение'));
 if p->>'full_name'<>'CRM v5 patient rollback' or p->>'notes'<>'Назначение' then raise exception 'Partial update lost existing fields';end if;
 s:=public.crm_management_v5('service_save',jsonb_build_object('name','CRM v5 test service','work_price',100,'consumables_price',15,'comment','Тест'));
 perform set_config('test.service',s->>'id',true);
 t:=public.crm_management_v5('template_save',jsonb_build_object('name','CRM v5 test template','service_id',s->>'id',
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.med'),'quantity',1),jsonb_build_object('medication_id',current_setting('test.med'),'quantity',2))));
 if jsonb_array_length(t->'items')<>1 or t->'items'->0->>'quantity'<>'3' then raise exception 'Duplicate template items not aggregated';end if;
 perform set_config('test.template',t->>'id',true);
 begin
  perform public.crm_management_v5('template_save',jsonb_build_object('name','Invalid fractional template','items',
   jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.med'),'quantity',0.5))));
  raise exception 'Unexpected fractional template accepted';
 exception when others then if sqlerrm='Unexpected fractional template accepted' then raise;end if;end;
 rows:=public.crm_management_v5('audit_list','{}');
 if not exists(select 1 from jsonb_array_elements(rows) a where a->>'entity_type'='procedure_services' and a->>'entity_id'=s->>'id') then
  raise exception 'Service trigger audit missing';end if;
 if not exists(select 1 from jsonb_array_elements(rows) a where a->>'entity_type'='medications' and a->>'entity_id'=current_setting('test.med')) then
  raise exception 'Medicine trigger audit missing';end if;
 staff_info:=public.crm_management_v5('staff_list','{}');
 if jsonb_typeof(staff_info)<>'array' then raise exception 'Staff list malformed';end if;
 p:=public.crm_management_v5('patient_archive',jsonb_build_object('id',current_setting('test.patient'),'archived',true));
 if not (p->>'archived')::boolean or p->>'archived_at' is null then raise exception 'Archive failed';end if;
 rows:=public.crm_management_v5('patient_list','{}');
 if exists(select 1 from jsonb_array_elements(rows) a where a->>'id'=current_setting('test.patient')) then raise exception 'Archived patient returned';end if;
 rows:=public.crm_management_v5('patient_list','{"include_archived":true}');
 if not exists(select 1 from jsonb_array_elements(rows) a where a->>'id'=current_setting('test.patient')) then raise exception 'Owner cannot inspect archive';end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
do $$ declare p jsonb;rows jsonb;action_name text;begin
 p:=public.crm_management_v5('patient_save','{"full_name":"Nurse can create only"}');
 if (p->>'archived')::boolean then raise exception 'Nurse patient created archived';end if;
 rows:=public.crm_management_v5('templates_list','{}');
 if not exists(select 1 from jsonb_array_elements(rows) a where a->>'id'=current_setting('test.template')) then raise exception 'Nurse cannot read template';end if;
 rows:=public.crm_management_v5('patient_list','{"include_archived":true}');
 if exists(select 1 from jsonb_array_elements(rows) a where a->>'id'=current_setting('test.patient')) then raise exception 'Nurse exposed archived patient';end if;
 foreach action_name in array array['patient_archive','staff_list','staff_save','template_save','service_save','audit_list','backup_export'] loop
  begin
   perform public.crm_management_v5(action_name,jsonb_build_object('id',current_setting('test.patient'),'full_name','forbidden'));
   raise exception 'Unexpected nurse authorization';
  exception when others then if sqlerrm='Unexpected nurse authorization' then raise;end if;end;
 end loop;
 begin
  perform public.crm_management_v5('patient_save',jsonb_build_object('id',p->>'id','notes','Forbidden edit'));
  raise exception 'Unexpected nurse edit';
 exception when others then if sqlerrm='Unexpected nurse edit' then raise;end if;end;
 if has_table_privilege('authenticated','public.patients','INSERT') or has_table_privilege('authenticated','public.patients','UPDATE') then
  raise exception 'Direct patient writes still granted';end if;
 if has_table_privilege('authenticated','private.crm_audit_log','SELECT') then raise exception 'Audit table exposed';end if;
 if has_table_privilege('authenticated','private.crm_procedure_templates','UPDATE') then raise exception 'Template writes exposed';end if;
end $$;

reset role;
-- Existing Storage metadata is verified server-side; a forged path is rejected.
select set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
do $$ declare p uuid;name_value text;doc_id uuid;again_id uuid;begin
 p:=(public.crm_management_v5('patient_save','{"full_name":"Storage rollback patient"}')->>'id')::uuid;
 name_value:=p::text||'/crm-v5-test.pdf';
 insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('patient-documents',name_value,current_setting('test.nurse'),'{"mimetype":"application/pdf","size":100}');
 if not private.crm_document_delete_v5('patient-documents',name_value,current_setting('test.nurse')) then raise exception 'Orphan cleanup denied';end if;
 doc_id:=public.register_patient_file_v8(p,'Test PDF',null,name_value,'test.pdf','application/pdf');
 again_id:=public.register_patient_file_v8(p,'Retry same PDF',null,name_value,'test.pdf','application/pdf');
 if doc_id<>again_id then raise exception 'Registration retry duplicated document';end if;
 if private.crm_document_delete_v5('patient-documents',name_value,current_setting('test.nurse')) then raise exception 'Nurse can delete registered document';end if;
 begin
  perform public.register_patient_file_v8(p,'Nonexisting',null,p::text||'/absent.pdf','absent.pdf','application/pdf');
  raise exception 'Unexpected unuploaded document accepted';
 exception when others then if sqlerrm='Unexpected unuploaded document accepted' then raise;end if;end;
 begin
  perform public.register_patient_file_v8(p,'Wrong MIME',null,name_value,'test.jpg','image/jpeg');
  raise exception 'Unexpected MIME mismatch accepted';
 exception when others then if sqlerrm='Unexpected MIME mismatch accepted' then raise;end if;end;
 perform set_config('test.document_path',name_value,true);
end $$;
update public.staff set active=false where auth_user_id=current_setting('test.nurse')::uuid;
set local role authenticated;
do $$ begin
 if private.crm_document_access_v5(current_setting('test.document_path')) then raise exception 'Inactive employee document access';end if;
 if exists(select 1 from storage.objects where bucket_id='patient-documents' and name=current_setting('test.document_path')) then
  raise exception 'Inactive employee storage access';end if;
 begin
  perform public.crm_management_v5('patient_list','{}');
  raise exception 'Unexpected inactive employee API access';
 exception when others then if sqlerrm='Unexpected inactive employee API access' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 if private.crm_document_access_v5(current_setting('test.document_path')) then raise exception 'Anonymous document access';end if;
 begin
  perform public.crm_management_v5('patient_list','{}');
  raise exception 'Unexpected anonymous API access';
 exception when others then if sqlerrm='Unexpected anonymous API access' then raise;end if;end;
end $$;
select 'crm-management-v5 authorization, clinical metadata and document tests passed' as result;
rollback;
