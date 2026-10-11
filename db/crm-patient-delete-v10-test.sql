-- Real authorization/atomicity fixtures; requires v10 clinical + deletion migrations. Always rolls back.
begin;
select set_config('test.manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null limit 1),true);
select set_config('test.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
do $$
#variable_conflict use_variable
declare patient_id uuid;shift_id uuid;procedure_id uuid;sale_id uuid;staff_id uuid;request_id uuid;begin
 if nullif(current_setting('test.manager'),'') is null or nullif(current_setting('test.nurse'),'') is null then raise exception 'Tests need active linked owner and nurse';end if;
 select id into staff_id from public.staff where auth_user_id=current_setting('test.nurse')::uuid;
 insert into public.patients(full_name) values('Patient deletion rollback fixture') returning id into patient_id;
 insert into public.shifts(shift_date,started_at,status) values(current_date,now(),'open') returning id into shift_id;
 insert into public.shift_staff(shift_id,staff_id) values(shift_id,staff_id);
 insert into public.procedures(patient_id,shift_id,nurse_id,procedure_type,list_total,charge_total,paid_total)
  values(patient_id,shift_id,staff_id,'Внутримышечный укол',100,100,100) returning id into procedure_id;
 insert into public.sales(patient_id,shift_id,nurse_id,list_total,charge_total,paid_total)
  values(patient_id,shift_id,staff_id,200,200,200) returning id into sale_id;
 insert into public.patient_files(patient_id,title,storage_path,original_name,mime_type,created_by)
  values(patient_id,'Сохранённый документ',patient_id::text||'/rollback.pdf','rollback.pdf','application/pdf',staff_id);
 insert into public.patient_treatment_courses(patient_id,title) values(patient_id,'Сохранённый курс');
 insert into private.warehouse_requests(id,action,payload,result,staff_user)
  values(gen_random_uuid(),'patient-delete-rollback','{}','{}',current_setting('test.manager')::uuid) returning id into request_id;
 insert into private.crm_payment_allocations(id,kind,procedure_id,cash,terminal,owner_card,cash_received,change_amount,created_by)
  values(request_id,'procedure',procedure_id,100,0,0,100,0,current_setting('test.manager')::uuid);
 perform set_config('test.patient',patient_id::text,true);perform set_config('test.shift',shift_id::text,true);
 perform set_config('test.updated_at',(select updated_at::text from public.patients where id=patient_id),true);
 perform set_config('test.request',gen_random_uuid()::text,true);
 perform set_config('test.snapshot',jsonb_build_object(
  'procedures',(select jsonb_agg(to_jsonb(p)) from public.procedures p where p.patient_id=patient_id),
  'sales',(select jsonb_agg(to_jsonb(s)) from public.sales s where s.patient_id=patient_id),
  'documents',(select jsonb_agg(to_jsonb(f)) from public.patient_files f where f.patient_id=patient_id),
  'courses',(select jsonb_agg(to_jsonb(c)) from public.patient_treatment_courses c where c.patient_id=patient_id),
  'allocations',(select jsonb_agg(to_jsonb(a)) from private.crm_payment_allocations a where a.procedure_id=procedure_id)
 )::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
do $$begin
 begin
  perform public.crm_patient_delete_v10(jsonb_build_object('id',current_setting('test.patient'),'request_id',current_setting('test.request'),'expected_updated_at',current_setting('test.updated_at')));
  raise exception 'Nurse deletion bypass';
 exception when others then if sqlerrm='Nurse deletion bypass' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
do $$
#variable_conflict use_variable
declare payload jsonb;answer jsonb;rows jsonb;begin
 payload:=jsonb_build_object('id',current_setting('test.patient'),'request_id',current_setting('test.request'),'expected_updated_at',current_setting('test.updated_at'));
 begin
  perform public.crm_patient_delete_v10(payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_updated_at','2000-01-01T00:00:00Z'));
  raise exception 'Stale deletion accepted';
 exception when others then if sqlerrm='Stale deletion accepted' then raise;end if;end;
 answer:=public.crm_patient_delete_v10(payload);
 if answer->>'deleted_at' is null then raise exception 'Deletion not recorded';end if;
 if answer is distinct from public.crm_patient_delete_v10(payload) then raise exception 'Replay result changed';end if;
 begin
  perform public.crm_patient_delete_v10(payload||jsonb_build_object('id',gen_random_uuid()));
  raise exception 'Request ID reused for other patient';
 exception when others then if sqlerrm='Request ID reused for other patient' then raise;end if;end;
 rows:=public.crm_management_v5('patient_list','{"include_archived":true}');
 if exists(select 1 from jsonb_array_elements(rows) x where x->>'id'=current_setting('test.patient')) then raise exception 'Deleted patient exposed in owner active/archive list';end if;
 rows:=public.patient_history_v8(current_setting('test.patient')::uuid);
 if jsonb_array_length(rows->'procedures')<>1 or jsonb_array_length(rows->'sales')<>1 then raise exception 'Owner lost audit history';end if;
 if jsonb_array_length(public.patient_files_v8(current_setting('test.patient')::uuid))<>1 then raise exception 'Owner lost retained documents';end if;
 begin
  perform public.crm_management_v5('patient_archive',jsonb_build_object('id',current_setting('test.patient'),'archived',false));
  raise exception 'Archived RPC restored deleted patient';
 exception when others then if sqlerrm='Archived RPC restored deleted patient' then raise;end if;end;
 begin
  perform public.crm_management_v5('patient_save',jsonb_build_object('id',current_setting('test.patient'),'notes','forbidden'));
  raise exception 'Deleted patient edit accepted';
 exception when others then if sqlerrm='Deleted patient edit accepted' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
do $$
#variable_conflict use_variable
declare rows jsonb;begin
 rows:=public.crm_management_v5('patient_list','{"include_archived":true}');
 if exists(select 1 from jsonb_array_elements(rows) x where x->>'id'=current_setting('test.patient')) then raise exception 'Nurse active list exposed deleted patient';end if;
 if exists(select 1 from public.patients where id=current_setting('test.patient')::uuid) then raise exception 'Direct SELECT exposes deleted patient';end if;
 begin perform public.patient_history_v8(current_setting('test.patient')::uuid);raise exception 'Nurse guessed deleted history';
 exception when others then if sqlerrm='Nurse guessed deleted history' then raise;end if;end;
 begin perform public.patient_files_v8(current_setting('test.patient')::uuid);raise exception 'Nurse guessed deleted documents';
 exception when others then if sqlerrm='Nurse guessed deleted documents' then raise;end if;end;
 if private.crm_document_access_v5(current_setting('test.patient')||'/rollback.pdf') then raise exception 'Deleted nurse Storage access';end if;
 if has_table_privilege('authenticated','private.crm_patient_delete_requests_v10','SELECT') then raise exception 'Deletion receipts publicly exposed';end if;
 if has_function_privilege('anon','public.crm_patient_delete_v10(jsonb)','EXECUTE') then raise exception 'Anonymous deletion function exposed';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
do $$
#variable_conflict use_variable
declare snapshot jsonb;patient_id uuid:=current_setting('test.patient')::uuid;procedure_id uuid;begin
 select id into procedure_id from public.procedures where public.procedures.patient_id=patient_id;
 snapshot:=jsonb_build_object(
  'procedures',(select jsonb_agg(to_jsonb(p)) from public.procedures p where p.patient_id=patient_id),
  'sales',(select jsonb_agg(to_jsonb(s)) from public.sales s where s.patient_id=patient_id),
  'documents',(select jsonb_agg(to_jsonb(f)) from public.patient_files f where f.patient_id=patient_id),
  'courses',(select jsonb_agg(to_jsonb(c)) from public.patient_treatment_courses c where c.patient_id=patient_id),
  'allocations',(select jsonb_agg(to_jsonb(a)) from private.crm_payment_allocations a where a.procedure_id=procedure_id));
 if snapshot is distinct from current_setting('test.snapshot')::jsonb then raise exception 'Deletion modified clinical rows or receipts';end if;
 if (select count(*) from private.crm_audit_log where action='delete' and entity_type='patients' and entity_id=patient_id::text)<>1 then raise exception 'Deletion audit duplicated or missing';end if;
 if (select count(*) from private.crm_patient_delete_requests_v10 where request_id=current_setting('test.request')::uuid)<>1 then raise exception 'Request not idempotent';end if;
 begin
  insert into public.procedures(patient_id,shift_id,nurse_id,procedure_type,charge_total)
   values(patient_id,current_setting('test.shift')::uuid,(select id from public.staff where auth_user_id=current_setting('test.nurse')::uuid),'forbidden',0);
  raise exception 'Legacy INSERT bypassed deleted guard';
 exception when others then if sqlerrm='Legacy INSERT bypassed deleted guard' then raise;end if;end;
 begin insert into public.patient_treatment_courses(patient_id,title) values(patient_id,'forbidden');raise exception 'Course bypassed deleted guard';
 exception when others then if sqlerrm='Course bypassed deleted guard' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 begin perform public.crm_patient_delete_v10(jsonb_build_object('id',current_setting('test.patient'),'request_id',gen_random_uuid(),'expected_updated_at',current_setting('test.updated_at')));raise exception 'Unauthenticated deletion accepted';
 exception when others then if sqlerrm='Unauthenticated deletion accepted' then raise;end if;end;
end $$;
select 'patient deletion v10: owner-only, replay, stale edit, nurse/private access and historical receipts preserved' as result;
rollback;
