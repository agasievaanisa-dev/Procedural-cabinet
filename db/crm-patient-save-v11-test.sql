-- Real role/receipt/audit checks for lost patient-save responses. All fixtures roll back.
begin;
select set_config('test.save.manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null limit 1),true);
select set_config('test.save.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
do $$begin
 if nullif(current_setting('test.save.manager'),'') is null or nullif(current_setting('test.save.nurse'),'') is null then
  raise exception 'Tests require active linked manager and nurse accounts';
 end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.save.manager'),true);
set local role authenticated;
do $$declare payload jsonb;answer jsonb;request_id uuid:=gen_random_uuid();edit_payload jsonb;edit_request uuid:=gen_random_uuid();begin
 payload:=jsonb_build_object('full_name','Patient save v11 manager rollback','phone',' 123 ','complaints','Сохранить жалобы','request','Запрос','prescriptions','Назначения','notes','Заметки');
 answer:=public.crm_patient_save_v11(payload,request_id);
 if answer->>'id' is null or answer->>'full_name'<>payload->>'full_name' or answer->>'phone'<>'123'
  or answer->>'birth_date' is not null or answer->>'complaints'<>'Сохранить жалобы' then raise exception 'Create lost optional-field semantics';end if;
 if answer is distinct from public.crm_patient_save_v11(payload,request_id) then raise exception 'Create replay result changed';end if;
 perform set_config('test.save.patient',answer->>'id',true);
 perform set_config('test.save.create_request',request_id::text,true);
 perform set_config('test.save.create_payload',payload::text,true);
 perform set_config('test.save.create_result',answer::text,true);
 begin
  perform public.crm_patient_save_v11(payload||jsonb_build_object('notes','Changed request'),request_id);
  raise exception 'Changed payload reused a create receipt';
 exception when others then
  if sqlerrm<>'Номер сохранения пациента уже использован с другими данными' then raise;end if;
 end;
 edit_payload:=jsonb_build_object('id',answer->>'id','notes','Обновлённая заметка');
 answer:=public.crm_patient_save_v11(edit_payload,edit_request);
 if answer->>'full_name'<>payload->>'full_name' or answer->>'notes'<>'Обновлённая заметка' or answer->>'phone'<>'123' then
  raise exception 'Partial edit changed untouched patient fields';end if;
 if answer is distinct from public.crm_patient_save_v11(edit_payload,edit_request) then raise exception 'Edit replay result changed';end if;
 perform set_config('test.save.edit_request',edit_request::text,true);
 perform set_config('test.save.edit_payload',edit_payload::text,true);
 perform set_config('test.save.edit_result',answer::text,true);
 -- A retry of an older successful create returns its own receipt and does not
 -- overwrite a later edit already made to the same card.
 if current_setting('test.save.create_result')::jsonb is distinct from public.crm_patient_save_v11(payload,request_id) then
  raise exception 'Create receipt changed after a later edit';end if;
 begin
  perform public.crm_patient_save_v11(payload,null);
  raise exception 'Missing request UUID accepted';
 exception when others then if sqlerrm<>'Не указан номер сохранения пациента' then raise;end if;end;
 begin
  perform public.crm_patient_save_v11(null,gen_random_uuid());
  raise exception 'Null payload accepted';
 exception when others then if sqlerrm<>'Некорректные данные' then raise;end if;end;
 begin
  perform public.crm_patient_save_v11('[]',gen_random_uuid());
  raise exception 'Array payload accepted';
 exception when others then if sqlerrm<>'Некорректные данные' then raise;end if;end;
 begin
  perform public.crm_patient_save_v11('{"full_name":"  "}',gen_random_uuid());
  raise exception 'Empty name accepted';
 exception when others then if sqlerrm<>'Укажите имя пациента' then raise;end if;end;
 -- Old already-open clients still have their original endpoint.
 answer:=public.crm_management_v5('patient_save','{"full_name":"Patient save v11 legacy rollback"}');
 perform set_config('test.save.legacy_patient',answer->>'id',true);
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.save.nurse'),true);
do $$declare payload jsonb:='{"full_name":"Patient save v11 nurse rollback","notes":"Nurse create"}';answer jsonb;request_id uuid:=gen_random_uuid();begin
 begin
  perform public.crm_patient_save_v11(current_setting('test.save.create_payload')::jsonb,current_setting('test.save.create_request')::uuid);
  raise exception 'Other actor obtained a manager create receipt';
 exception when others then if sqlerrm<>'Номер сохранения пациента уже использован с другими данными' then raise;end if;end;
 begin
  perform public.crm_patient_save_v11(current_setting('test.save.edit_payload')::jsonb,gen_random_uuid());
  raise exception 'Nurse edited a patient';
 exception when others then if sqlerrm<>'Изменять пациентов может только владелец' then raise;end if;end;
 answer:=public.crm_patient_save_v11(payload,request_id);
 if answer->>'full_name'<>payload->>'full_name' or (answer->>'archived')::boolean then raise exception 'Nurse could not create an active patient';end if;
 if answer is distinct from public.crm_patient_save_v11(payload,request_id) then raise exception 'Nurse create replay changed';end if;
 perform set_config('test.save.nurse_patient',answer->>'id',true);
 perform set_config('test.save.nurse_request',request_id::text,true);
 perform set_config('test.save.nurse_payload',payload::text,true);
 perform set_config('test.save.nurse_result',answer::text,true);
 if has_table_privilege('authenticated','private.crm_patient_save_requests_v11','SELECT')
  or has_table_privilege('authenticated','private.crm_patient_save_requests_v11','INSERT')
  or has_table_privilege('authenticated','private.crm_patient_save_requests_v11','UPDATE')
  or has_table_privilege('authenticated','private.crm_patient_save_requests_v11','DELETE') then raise exception 'Patient receipts have direct authenticated access';end if;
 if has_function_privilege('anon','public.crm_patient_save_v11(jsonb,uuid)','EXECUTE')
  or has_function_privilege('authenticated','private.crm_patient_save_v11(jsonb,uuid)','EXECUTE') then raise exception 'Patient save private/anonymous privileges exposed';end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.save.manager'),true);
do $$begin
 begin
  perform public.crm_patient_save_v11(current_setting('test.save.nurse_payload')::jsonb,current_setting('test.save.nurse_request')::uuid);
  raise exception 'Manager obtained another actor receipt';
 exception when others then if sqlerrm<>'Номер сохранения пациента уже использован с другими данными' then raise;end if;end;
end $$;
reset role;
do $$declare patient_id uuid:=current_setting('test.save.patient')::uuid;begin
 if (select count(*) from public.patients where full_name='Patient save v11 manager rollback')<>1
  or (select count(*) from public.patients where full_name='Patient save v11 nurse rollback')<>1 then raise exception 'Retry created duplicate patients';end if;
 if (select count(*) from private.crm_patient_save_requests_v11 where request_id in
  (current_setting('test.save.create_request')::uuid,current_setting('test.save.edit_request')::uuid,current_setting('test.save.nurse_request')::uuid))<>3 then
  raise exception 'Save receipt cardinality incorrect';end if;
 if (select count(*) from private.crm_audit_log where entity_type='patients' and entity_id=patient_id::text and action='insert')<>1
  or (select count(*) from private.crm_audit_log where entity_type='patients' and entity_id=patient_id::text and action='update')<>1
  or (select count(*) from private.crm_audit_log where entity_type='patients' and entity_id=current_setting('test.save.nurse_patient') and action='insert')<>1 then
  raise exception 'Retry duplicated patient audit';end if;
 if (select notes from public.patients where id=patient_id)<>'Обновлённая заметка' then raise exception 'Create replay reverted a later edit';end if;
 if not (select relrowsecurity from pg_class where oid='private.crm_patient_save_requests_v11'::regclass) then raise exception 'Patient receipt RLS disabled';end if;
 perform set_config('test.save.manager_role',(select role from public.staff where auth_user_id=current_setting('test.save.manager')::uuid),true);
end $$;

-- Revocation must be checked before returning any cached result.
update public.staff set active=false where auth_user_id=current_setting('test.save.nurse')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.save.nurse'),true);
set local role authenticated;
do $$begin
 begin
  perform public.crm_patient_save_v11(current_setting('test.save.nurse_payload')::jsonb,current_setting('test.save.nurse_request')::uuid);
  raise exception 'Inactive nurse received a cached patient result';
 exception when others then if sqlerrm<>'Нет доступа: сотрудник неактивен' then raise;end if;end;
end $$;
reset role;
update public.staff set role='nurse' where auth_user_id=current_setting('test.save.manager')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.save.manager'),true);
set local role authenticated;
do $$begin
 begin
  perform public.crm_patient_save_v11(current_setting('test.save.edit_payload')::jsonb,current_setting('test.save.edit_request')::uuid);
  raise exception 'Demoted manager replayed a patient edit';
 exception when others then if sqlerrm<>'Изменять пациентов может только владелец' then raise;end if;end;
end $$;
reset role;
update public.staff set role=current_setting('test.save.manager_role') where auth_user_id=current_setting('test.save.manager')::uuid;

-- Deletion after a successful save invalidates both create and edit replay.
select set_config('request.jwt.claim.sub',current_setting('test.save.manager'),true);
select public.crm_patient_delete_v10(jsonb_build_object('id',current_setting('test.save.patient'),'request_id',gen_random_uuid(),
 'expected_updated_at',(select updated_at from public.patients where id=current_setting('test.save.patient')::uuid)));
set local role authenticated;
do $$begin
 begin
  perform public.crm_patient_save_v11(current_setting('test.save.create_payload')::jsonb,current_setting('test.save.create_request')::uuid);
  raise exception 'Deleted patient returned from create receipt';
 exception when others then if sqlerrm<>'Удалённый пациент недоступен для изменения' then raise;end if;end;
 begin
  perform public.crm_patient_save_v11(current_setting('test.save.edit_payload')::jsonb,current_setting('test.save.edit_request')::uuid);
  raise exception 'Deleted patient returned from edit receipt';
 exception when others then if sqlerrm<>'Удалённый пациент недоступен для изменения' then raise;end if;end;
 begin
  perform public.crm_patient_save_v11(current_setting('test.save.edit_payload')::jsonb,gen_random_uuid());
  raise exception 'Deleted patient saved with a fresh UUID';
 exception when others then if sqlerrm<>'Удалённый пациент недоступен для изменения' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 begin
  perform public.crm_patient_save_v11(current_setting('test.save.nurse_payload')::jsonb,current_setting('test.save.nurse_request')::uuid);
  raise exception 'Anonymous request received a receipt';
 exception when others then if sqlerrm<>'Войдите в программу' then raise;end if;end;
end $$;
reset role;
do $$begin
 if (select deleted_at from public.patients where id=current_setting('test.save.patient')::uuid) is null then raise exception 'Save replay resurrected a patient';end if;
 if (select count(*) from private.crm_audit_log where entity_type='patients' and entity_id=current_setting('test.save.patient') and action='update')<>1 then raise exception 'Rejected request changed patient audit';end if;
end $$;
select 'patient save v11: replay, one card/audit, role revocation, private receipts, deleted-patient guards and legacy compatibility passed' as result;
rollback;
