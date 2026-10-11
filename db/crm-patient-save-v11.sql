-- Replay-safe patient saves: a lost response can be retried without creating another card.
-- Requires crm-management-v5.sql and crm-patient-delete-v10.sql. Legacy clients remain supported.
begin;

create table if not exists private.crm_patient_save_requests_v11 (
 request_id uuid primary key,
 actor_user uuid not null,
 patient_id uuid not null,
 payload jsonb not null check (jsonb_typeof(payload)='object'),
 result jsonb not null check (jsonb_typeof(result)='object'),
 created_at timestamptz not null default now()
);
alter table private.crm_patient_save_requests_v11 enable row level security;
revoke all on private.crm_patient_save_requests_v11 from public,anon,authenticated;

create or replace function private.crm_patient_save_v11(p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid;role_name text;patient_id_value uuid;patient_deleted_at timestamptz;
 receipt private.crm_patient_save_requests_v11%rowtype;result_row jsonb;
begin
 if auth.uid() is null then raise exception 'Войдите в программу';end if;
 -- Authorization is checked even on a replay. Hold the employee row so concurrent
 -- deactivation or demotion cannot take effect between this check and the save.
 select id,role into actor,role_name from public.staff
  where auth_user_id=auth.uid() and active and role in ('owner','admin','nurse') limit 1 for share;
 if actor is null then raise exception 'Нет доступа: сотрудник неактивен';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Некорректные данные';end if;
 if p_request_id is null then raise exception 'Не указан номер сохранения пациента';end if;
 patient_id_value:=nullif(p_payload->>'id','')::uuid;
 if patient_id_value is not null and role_name not in ('owner','admin') then
  raise exception 'Изменять пациентов может только владелец';
 end if;

 -- Serialize requests across connections, including concurrent retries before
 -- the first transaction has committed its receipt.
 perform pg_advisory_xact_lock(hashtextextended('crm-patient-save-v11:'||p_request_id::text,0));
 select * into receipt from private.crm_patient_save_requests_v11 where request_id=p_request_id;
 if found then
  if receipt.actor_user<>auth.uid() or receipt.payload is distinct from p_payload then
   raise exception 'Номер сохранения пациента уже использован с другими данными';
  end if;
  -- A cached, previously successful create/edit must never return a retired card
  -- as an active result. The lock also serializes this check with patient deletion.
  select deleted_at into patient_deleted_at from public.patients where id=receipt.patient_id for share;
  if not found or patient_deleted_at is not null then raise exception 'Удалённый пациент недоступен для изменения';end if;
  return receipt.result;
 end if;

 if patient_id_value is not null then
  select deleted_at into patient_deleted_at from public.patients where id=patient_id_value for update;
  if not found then raise exception 'Пациент не найден';end if;
  if patient_deleted_at is not null then raise exception 'Удалённый пациент недоступен для изменения';end if;
 end if;
 -- Delegate field validation, optional-field semantics, role enforcement, and
 -- the single audit entry to the current management implementation.
 result_row:=private.crm_management_v5('patient_save',p_payload);
 insert into private.crm_patient_save_requests_v11(request_id,actor_user,patient_id,payload,result)
  values(p_request_id,auth.uid(),(result_row->>'id')::uuid,p_payload,result_row);
 return result_row;
end $$;
revoke all on function private.crm_patient_save_v11(jsonb,uuid) from public,anon,authenticated;

create or replace function public.crm_patient_save_v11(p_payload jsonb,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.crm_patient_save_v11(p_payload,p_request_id);
$$;
revoke all on function public.crm_patient_save_v11(jsonb,uuid) from public,anon;
grant execute on function public.crm_patient_save_v11(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
