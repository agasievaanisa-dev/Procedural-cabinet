-- Retry-safe transport for saves whose original RPC has no request UUID.
-- Original RPCs retain their validation, permissions, audit and financial logic.
begin;
set local lock_timeout='10s';

create table private.crm_save_requests_v16 (
 request_id uuid primary key,
 actor_user uuid not null,
 p_rpc text not null,
 args jsonb not null check(jsonb_typeof(args)='object'),
 result jsonb not null,
 created_at timestamptz not null default now()
);
alter table private.crm_save_requests_v16 enable row level security;
revoke all on private.crm_save_requests_v16 from public,anon,authenticated;

create or replace function private.crm_save_recovery_v16(p_rpc text,p_args jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();actor_staff_id uuid;role_name text;action_name text;manager_only boolean:=false;
 allowed_keys text[];answer jsonb;cached private.crm_save_requests_v16%rowtype;
begin
 if actor is null then raise exception 'Войдите в программу' using errcode='42501';end if;
 select s.id,s.role into actor_staff_id,role_name from public.staff s
  where s.auth_user_id=actor and s.active and s.role in ('owner','admin','nurse') limit 1;
 if actor_staff_id is null then raise exception 'Нет доступа: сотрудник неактивен' using errcode='42501';end if;
 if p_request_id is null or p_args is null or jsonb_typeof(p_args)<>'object' then
  raise exception 'Проверьте параметры сохранения' using errcode='22023';
 end if;
 action_name:=p_args->>'p_action';
 -- An explicit whitelist keeps this privileged dispatcher from becoming a generic RPC proxy.
 case p_rpc
 when 'crm_management_v5' then
  allowed_keys:=array['p_action','p_payload'];manager_only:=true;
  if action_name is null or action_name not in ('staff_save','template_save','patient_archive') then
   raise exception 'Операция сохранения не поддерживается' using errcode='22023';end if;
 when 'crm_finance_v5' then
  allowed_keys:=array['p_action','p_payload'];
  if action_name is null or action_name not in ('settings_save','salary','close') then
   raise exception 'Операция сохранения не поддерживается' using errcode='22023';end if;
  manager_only:=action_name in ('settings_save','salary');
 when 'start_shift_v82' then
  allowed_keys:=array['p_shift_date','p_started_at','p_planned_end_at','p_nurse1','p_nurse2'];
 when 'manager_medication_details_photo_v1' then
  allowed_keys:=array['p_id','p_search_name','p_dosage','p_photo_path'];manager_only:=true;
 when 'add_patient_course_test' then
  allowed_keys:=array['p_patient_id','p_title','p_start','p_end','p_plan','p_notes'];
 when 'set_course_status_test' then
  allowed_keys:=array['p_course_id','p_status'];
 when 'quick_ui_v4' then
  allowed_keys:=array['p_action','p_payload'];
  if action_name is distinct from 'favorite' then
   raise exception 'Операция сохранения не поддерживается' using errcode='22023';end if;
 else raise exception 'Операция сохранения не поддерживается' using errcode='22023';
 end case;
 if p_args-allowed_keys<>'{}'::jsonb then
  raise exception 'Неизвестные параметры сохранения' using errcode='22023';end if;
 if manager_only and role_name not in ('owner','admin') then
  raise exception 'Доступно только администратору или владельцу' using errcode='42501';end if;
 -- Recheck current access even when returning a cached result, without repeating a write.
 if role_name='nurse' and p_rpc='crm_finance_v5' and action_name='close' and not exists(
  select 1 from public.shift_staff ss where ss.shift_id=(p_args->'p_payload'->>'shift_id')::uuid
   and ss.staff_id=actor_staff_id) then
  raise exception 'Нет доступа к смене' using errcode='42501';end if;
 if role_name='nurse' and p_rpc='start_shift_v82' and actor_staff_id is distinct from (p_args->>'p_nurse1')::uuid
  and actor_staff_id is distinct from (p_args->>'p_nurse2')::uuid then
  raise exception 'Вы должны входить в выбранную смену' using errcode='42501';end if;

 perform pg_advisory_xact_lock(hashtextextended('crm-save-v16/'||p_request_id::text,0));
 select r.* into cached from private.crm_save_requests_v16 r where r.request_id=p_request_id;
 if found then
  if cached.actor_user is distinct from actor or cached.p_rpc is distinct from p_rpc
   or cached.args is distinct from p_args then
   raise exception 'Этот запрос уже использован для другого сохранения' using errcode='22023';end if;
  -- A manager's close receipt may outlive a role change. Use current nurse
  -- visibility for its report, even though no underlying save is repeated.
  if p_rpc='crm_finance_v5' and action_name='close' and role_name='nurse' then
   return jsonb_build_object('result',private.crm_nurse_shift_report_v10(cached.result));
  end if;
  return jsonb_build_object('result',cached.result);
 end if;

 case p_rpc
 when 'crm_management_v5' then
  answer:=public.crm_management_v5(action_name,coalesce(p_args->'p_payload','{}'::jsonb));
 when 'crm_finance_v5' then
  answer:=public.crm_finance_v5(action_name,coalesce(p_args->'p_payload','{}'::jsonb));
 when 'start_shift_v82' then
  answer:=to_jsonb(public.start_shift_v82((p_args->>'p_shift_date')::date,
   (p_args->>'p_started_at')::timestamptz,(p_args->>'p_planned_end_at')::timestamptz,
   (p_args->>'p_nurse1')::uuid,(p_args->>'p_nurse2')::uuid));
 when 'manager_medication_details_photo_v1' then
  perform public.manager_medication_details_photo_v1((p_args->>'p_id')::uuid,
   p_args->>'p_search_name',p_args->>'p_dosage',p_args->>'p_photo_path');
  answer:='null'::jsonb;
 when 'add_patient_course_test' then
  answer:=to_jsonb(public.add_patient_course_test((p_args->>'p_patient_id')::uuid,
   p_args->>'p_title',(p_args->>'p_start')::date,(p_args->>'p_end')::date,
   p_args->>'p_plan',p_args->>'p_notes'));
 when 'set_course_status_test' then
  perform public.set_course_status_test((p_args->>'p_course_id')::uuid,p_args->>'p_status');
  answer:='null'::jsonb;
 when 'quick_ui_v4' then
  answer:=public.quick_ui_v4(action_name,coalesce(p_args->'p_payload','{}'::jsonb));
 end case;
 answer:=coalesce(answer,'null'::jsonb);
 insert into private.crm_save_requests_v16(request_id,actor_user,p_rpc,args,result)
 values(p_request_id,actor,p_rpc,p_args,answer);
 return jsonb_build_object('result',answer);
end $$;
revoke all on function private.crm_save_recovery_v16(text,jsonb,uuid) from public,anon,authenticated;

create or replace function public.crm_save_recovery_v16(p_rpc text,p_args jsonb,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.crm_save_recovery_v16(p_rpc,p_args,p_request_id);
$$;
revoke all on function public.crm_save_recovery_v16(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.crm_save_recovery_v16(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
