-- Owner-only removal from active patient workflows; clinical/financial history remains intact.
begin;
alter table public.patients add column if not exists deleted_at timestamptz;
alter table public.patients add column if not exists deleted_by uuid;
create table if not exists private.crm_patient_delete_requests_v10 (
 request_id uuid primary key, actor_user uuid not null, patient_id uuid not null,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table private.crm_patient_delete_requests_v10 enable row level security;
revoke all on private.crm_patient_delete_requests_v10 from public,anon,authenticated;

create or replace function private.crm_patient_delete_v10(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; role_name text; patient_id_value uuid; request_id_value uuid;
 patient_row public.patients%rowtype; receipt private.crm_patient_delete_requests_v10%rowtype;
 before_row jsonb; result_row jsonb; expected_at timestamptz;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('owner','admin') then raise exception 'Удалять пациента может только владелец';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Некорректные данные';end if;
 patient_id_value:=nullif(p_payload->>'id','')::uuid; request_id_value:=nullif(p_payload->>'request_id','')::uuid;
 expected_at:=nullif(p_payload->>'expected_updated_at','')::timestamptz;
 if patient_id_value is null or request_id_value is null or expected_at is null then raise exception 'Обновите карточку пациента перед удалением';end if;
 perform pg_advisory_xact_lock(hashtextextended('crm-patient-delete-v10:'||request_id_value::text,0));
 select * into receipt from private.crm_patient_delete_requests_v10 where request_id=request_id_value;
 if found then
  if receipt.actor_user<>auth.uid() or receipt.payload is distinct from p_payload then raise exception 'Запрос удаления уже использован с другими данными';end if;
  return receipt.result;
 end if;
 select * into patient_row from public.patients where id=patient_id_value for update;
 if not found then raise exception 'Пациент не найден';end if;
 if patient_row.deleted_at is null then
  if patient_row.updated_at is distinct from expected_at then raise exception 'Карточка пациента изменилась. Обновите её перед удалением';end if;
  before_row:=to_jsonb(patient_row);
  update public.patients set deleted_at=clock_timestamp(),deleted_by=auth.uid(),archived=true,
   archived_at=coalesce(archived_at,clock_timestamp()),updated_at=clock_timestamp()
   where id=patient_id_value returning * into patient_row;
  perform private.crm_audit_v5('delete','patients',patient_id_value::text,before_row,to_jsonb(patient_row),'Удаление из списка с сохранением истории и документов');
 end if;
 result_row:=jsonb_build_object('id',patient_row.id,'deleted_at',patient_row.deleted_at,'deleted_by',patient_row.deleted_by,'request_id',request_id_value);
 insert into private.crm_patient_delete_requests_v10(request_id,actor_user,patient_id,payload,result)
  values(request_id_value,auth.uid(),patient_id_value,p_payload,result_row);
 return result_row;
end $$;
revoke all on function private.crm_patient_delete_v10(jsonb) from public,anon,authenticated;
create or replace function public.crm_patient_delete_v10(p_payload jsonb)
returns jsonb language sql security definer set search_path='' as $$ select private.crm_patient_delete_v10(p_payload); $$;
revoke all on function public.crm_patient_delete_v10(jsonb) from public,anon;
grant execute on function public.crm_patient_delete_v10(jsonb) to authenticated;

-- Preserve all current management actions and their role checks; retired cards cannot be edited/restored.
do $$ declare definition text; marker text;begin
 definition:=pg_get_functiondef('private.crm_management_v5(text,jsonb)'::regprocedure);
 marker:=$old$where not p.archived or (is_manager and coalesce((p_payload->>'include_archived')::boolean,false))$old$;
 if position(marker in definition)>0 then
  definition:=replace(definition,marker,$new$where p.deleted_at is null and (not p.archived or (is_manager and coalesce((p_payload->>'include_archived')::boolean,false)))$new$);
 elsif position('where p.deleted_at is null' in definition)=0 then raise exception 'Unexpected management patient list definition';end if;
 marker:=$old$entity_id:=nullif(p_payload->>'id','')::uuid;$old$;
 if position('Удалённый пациент недоступен для изменения' in definition)=0 then
  if position(marker in definition)=0 then raise exception 'Unexpected management entity guard';end if;
  definition:=replace(definition,marker,marker||$new$
 if p_action in ('patient_save','patient_archive') and entity_id is not null and exists(select 1 from public.patients where id=entity_id and deleted_at is not null) then raise exception 'Удалённый пациент недоступен для изменения';end if;$new$);
 end if;
 definition:=replace(definition,'from public.patients where id=entity_id for update','from public.patients where id=entity_id and deleted_at is null for update');
 definition:=replace(definition,'from public.patients p where id=entity_id for update','from public.patients p where id=entity_id and p.deleted_at is null for update');
 execute definition;
end $$;

-- History and stored files remain available to the owner for audit, never to a nurse by guessed ID.
create or replace function private.crm_document_access_v5(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.staff where auth_user_id=auth.uid()
  and active and role in ('nurse','admin','owner')) and exists(select 1 from public.patients
  where id::text=split_part(p_path,'/',1) and (deleted_at is null or private.is_manager()));
$$;
revoke all on function private.crm_document_access_v5(text) from public,anon;
grant execute on function private.crm_document_access_v5(text) to authenticated;
do $$ declare definition text;begin
 definition:=pg_get_functiondef('private.crm_patient_history_v5(uuid)'::regprocedure);
 definition:=replace(definition,'from public.patients where id=p_patient)','from public.patients where id=p_patient and (deleted_at is null or role_name in (''owner'',''admin'')))');
 if position('deleted_at is null' in definition)=0 then raise exception 'Unexpected patient history definition';end if;
 execute definition;
 definition:=pg_get_functiondef('public.patient_courses_test(uuid)'::regprocedure);
 if position('Удалённый пациент недоступен' in definition)=0 then
  definition:=replace(definition,'select coalesce(jsonb_agg',$guard$if not exists(select 1 from public.patients where id=p_patient_id and (deleted_at is null or private.is_manager())) then raise exception 'Удалённый пациент недоступен';end if;
 select coalesce(jsonb_agg$guard$);
 end if;
 execute definition;
 definition:=pg_get_functiondef('private.quick_ui_v4(text,jsonb)'::regprocedure);
 if position('Удалённый пациент недоступен' in definition)=0 then
  definition:=replace(definition,$marker$elsif p_action='last_procedure' then$marker$,$marker$elsif p_action='last_procedure' then
  if not exists(select 1 from public.patients where id=(p_payload->>'patient_id')::uuid and (deleted_at is null or role_name in ('owner','admin'))) then raise exception 'Удалённый пациент недоступен';end if;$marker$);
 end if;
 execute definition;
end $$;

-- An active nurse's direct SELECT also hides removed cards. Definer finance reports retain names.
drop policy if exists crm_patients_deleted_read_v10 on public.patients;
create policy crm_patients_deleted_read_v10 on public.patients as restrictive for select to authenticated
 using(deleted_at is null or private.is_manager());

-- Database guard protects legacy RPC paths and serializes patient removal with new clinical writes.
create or replace function private.crm_active_patient_guard_v10() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.patient_id is not null then
  perform 1 from public.patients where id=new.patient_id and deleted_at is null for share;
  if not found then raise exception 'Пациент удалён или не найден. Выберите действующую карточку';end if;
 end if;
 return new;
end $$;
revoke all on function private.crm_active_patient_guard_v10() from public,anon,authenticated;
do $$ declare relation_name text;begin
 foreach relation_name in array array['procedures','sales','patient_courses','patient_treatment_courses','patient_documents','patient_files'] loop
  if to_regclass('public.'||relation_name) is not null then
   execute format('drop trigger if exists crm_active_patient_guard_v10 on public.%I',relation_name);
   execute format('create trigger crm_active_patient_guard_v10 before insert or update of patient_id on public.%I for each row execute function private.crm_active_patient_guard_v10()',relation_name);
  end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
