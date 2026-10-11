-- Replay-safe service-price writes: a lost response must not create duplicate services/audits.
-- Requires crm-management-v5.sql. Existing service_save clients remain supported.
begin;

create table if not exists private.crm_service_save_requests_v11 (
 request_id uuid primary key,
 actor_user uuid not null,
 service_id uuid not null,
 payload jsonb not null check (jsonb_typeof(payload)='object'),
 result jsonb not null check (jsonb_typeof(result)='object'),
 created_at timestamptz not null default now()
);
alter table private.crm_service_save_requests_v11 enable row level security;
revoke all on private.crm_service_save_requests_v11 from public,anon,authenticated;

create or replace function private.crm_service_save_v11(p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;service_id_value uuid;receipt private.crm_service_save_requests_v11%rowtype;result_row jsonb;
begin
 if auth.uid() is null then raise exception 'Войдите в программу';end if;
 -- Check current privileges before reading a receipt; revocation and demotion
 -- cannot race the write while this transaction holds the employee row lock.
 select id into actor from public.staff where auth_user_id=auth.uid() and active
  and role in ('owner','admin') limit 1 for share;
 if actor is null then raise exception 'Редактировать прайс услуг может только владелец';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Некорректные данные';end if;
 if p_request_id is null then raise exception 'Не указан номер сохранения услуги';end if;
 service_id_value:=nullif(p_payload->>'id','')::uuid;

 perform pg_advisory_xact_lock(hashtextextended('crm-service-save-v11:'||p_request_id::text,0));
 select * into receipt from private.crm_service_save_requests_v11 where request_id=p_request_id;
 if found then
  if receipt.actor_user<>auth.uid() or receipt.payload is distinct from p_payload then
   raise exception 'Номер сохранения услуги уже использован с другими данными';
  end if;
  -- Archiving a service (active=false) retains its identity/history and permits
  -- replay. A physically removed service must not be returned or recreated.
  perform 1 from public.procedure_services where id=receipt.service_id for share;
  if not found then raise exception 'Услуга не найдена';end if;
  return receipt.result;
 end if;

 if service_id_value is not null then
  perform 1 from public.procedure_services where id=service_id_value for update;
  if not found then raise exception 'Услуга не найдена';end if;
 end if;
 -- Existing field validation, partial-update semantics and the service audit
 -- trigger run once, in the same transaction as insertion of the receipt.
 result_row:=private.crm_management_v5('service_save',p_payload);
 insert into private.crm_service_save_requests_v11(request_id,actor_user,service_id,payload,result)
  values(p_request_id,auth.uid(),(result_row->>'id')::uuid,p_payload,result_row);
 return result_row;
end $$;
revoke all on function private.crm_service_save_v11(jsonb,uuid) from public,anon,authenticated;

create or replace function public.crm_service_save_v11(p_payload jsonb,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.crm_service_save_v11(p_payload,p_request_id);
$$;
revoke all on function public.crm_service_save_v11(jsonb,uuid) from public,anon;
grant execute on function public.crm_service_save_v11(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
