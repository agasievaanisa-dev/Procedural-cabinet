begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create table if not exists private.crm_backup_config (
  id boolean primary key default true check(id),
  vault_secret_id uuid not null,
  created_at timestamptz not null default now()
);
create table if not exists private.crm_backup_runs (
  id uuid primary key default gen_random_uuid(),
  backup_day date not null unique,
  status text not null default 'running' check(status in ('running','completed','failed')),
  path text not null,
  files_count integer not null default 0,
  bytes_count bigint not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);
alter table private.crm_backup_config enable row level security;
alter table private.crm_backup_runs enable row level security;
revoke all on private.crm_backup_config,private.crm_backup_runs from public,anon,authenticated;
do $$ declare secret_id uuid; begin
  if not exists(select 1 from private.crm_backup_config) then
    select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'crm_backup_v5_token') into secret_id;
    insert into private.crm_backup_config(vault_secret_id) values(secret_id);
  end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit)
values('crm-backups','crm-backups',false,52428800)
on conflict(id) do update set public=false;
drop policy if exists crm_backups_owner_read on storage.objects;
create policy crm_backups_owner_read on storage.objects for select to authenticated
using(bucket_id='crm-backups' and private.is_manager());

create or replace function private.crm_backup_authorize_v5(p_token text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(p_token=(select s.decrypted_secret from vault.decrypted_secrets s
    join private.crm_backup_config c on c.vault_secret_id=s.id),false) and length(p_token)=64;
$$;
create or replace function public.crm_backup_authorize_v5(p_token text) returns boolean
language sql security invoker set search_path='' as $$select private.crm_backup_authorize_v5(p_token);$$;

create or replace function private.crm_backup_claim_v5(p_force boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.crm_backup_runs; d date:=(now() at time zone 'Europe/Moscow')::date;
begin
  insert into private.crm_backup_runs(backup_day,path) values(d,d::text)
  on conflict(backup_day) do update set status='running',started_at=now(),error=null
    where (p_force and private.crm_backup_runs.status='completed') or private.crm_backup_runs.status='failed' or
      (private.crm_backup_runs.status='running' and private.crm_backup_runs.started_at<now()-interval '10 minutes')
  returning * into r;
  if r.id is null then return null; end if;
  return to_jsonb(r);
end $$;
create or replace function public.crm_backup_claim_v5(p_force boolean default false) returns jsonb
language sql security invoker set search_path='' as $$select private.crm_backup_claim_v5(p_force);$$;

create or replace function private.crm_backup_data_v5() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t record; parts text[]:=array[]::text[]; result jsonb;
begin
  -- One SELECT gives a consistent snapshot across related clinical tables.
  for t in select table_schema,table_name from information_schema.tables
    where table_type='BASE TABLE' and (table_schema='public' or
      (table_schema='private' and table_name in ('medication_favorites','warehouse_requests','crm_audit_log','crm_templates','crm_procedure_templates','crm_finance_settings','crm_payment_allocations','crm_shift_payroll','crm_shift_reports')))
    order by table_schema,table_name loop
    parts:=array_append(parts,format('select %L::text as name, coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) as rows from %I.%I t',t.table_schema||'.'||t.table_name,t.table_schema,t.table_name));
  end loop;
  execute 'select jsonb_object_agg(name,rows) from ('||array_to_string(parts,' union all ')||') all_tables' into result;
  return jsonb_build_object('format','procedural-cabinet-backup-v5','created_at',now(),'tables',result);
end $$;
create or replace function public.crm_backup_data_v5() returns jsonb
language sql stable security invoker set search_path='' as $$select private.crm_backup_data_v5();$$;

create or replace function private.crm_backup_finish_v5(p_id uuid,p_success boolean,p_files integer,p_bytes bigint,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$begin
  update private.crm_backup_runs set status=case when p_success then 'completed' else 'failed' end,
    completed_at=now(),files_count=greatest(p_files,0),bytes_count=greatest(p_bytes,0),error=left(p_error,250)
    where id=p_id and status='running';
  return found;
end $$;
create or replace function public.crm_backup_finish_v5(p_id uuid,p_success boolean,p_files integer,p_bytes bigint,p_error text default null) returns boolean
language sql security invoker set search_path='' as $$select private.crm_backup_finish_v5(p_id,p_success,p_files,p_bytes,p_error);$$;

create or replace function private.crm_backup_status_v5() returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not private.is_manager() then raise exception 'Доступно только владельцу';end if;
 return jsonb_build_object('schedule','Ежедневно в 03:15 по Москве','retention_days',7,
   'last_run',(select to_jsonb(r) from private.crm_backup_runs r order by started_at desc limit 1),
   'last_success',(select to_jsonb(r) from private.crm_backup_runs r where status='completed' order by completed_at desc limit 1));
end $$;
create or replace function public.crm_backup_status_v5() returns jsonb
language sql stable security invoker set search_path='' as $$select private.crm_backup_status_v5();$$;

create or replace function public.crm_admin_create_staff_v5(p_actor uuid,p_auth_user uuid,p_name text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor_id uuid; new_staff public.staff;
begin
 select id into actor_id from public.staff where auth_user_id=p_actor and active and role in ('owner','admin') for share;
 if actor_id is null or nullif(trim(p_name),'') is null then raise exception 'Нет доступа';end if;
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 insert into public.staff(full_name,auth_user_id,role,active) values(trim(p_name),p_auth_user,'nurse',true) returning * into new_staff;
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,after_data)
 values(p_actor,actor_id,'staff_account_created','staff',new_staff.id::text,jsonb_build_object('account_created',true));
 return jsonb_build_object('id',new_staff.id,'full_name',new_staff.full_name,'role',new_staff.role,'active',new_staff.active);
end $$;
grant usage on schema private to service_role;
grant select,insert,update on private.crm_backup_runs to service_role;
grant insert on private.crm_audit_log to service_role;
revoke all on function private.crm_backup_authorize_v5(text),public.crm_backup_authorize_v5(text),
 private.crm_backup_claim_v5(boolean),public.crm_backup_claim_v5(boolean),private.crm_backup_data_v5(),public.crm_backup_data_v5(),
 private.crm_backup_finish_v5(uuid,boolean,integer,bigint,text),public.crm_backup_finish_v5(uuid,boolean,integer,bigint,text),
 public.crm_admin_create_staff_v5(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.crm_backup_authorize_v5(text),public.crm_backup_authorize_v5(text),
 private.crm_backup_claim_v5(boolean),public.crm_backup_claim_v5(boolean),private.crm_backup_data_v5(),public.crm_backup_data_v5(),
 private.crm_backup_finish_v5(uuid,boolean,integer,bigint,text),public.crm_backup_finish_v5(uuid,boolean,integer,bigint,text),
 public.crm_admin_create_staff_v5(uuid,uuid,text) to service_role;
revoke all on function private.crm_backup_status_v5(),public.crm_backup_status_v5() from public,anon;
grant execute on function private.crm_backup_status_v5(),public.crm_backup_status_v5() to authenticated;

create or replace function private.crm_enqueue_backup_v5(p_force boolean default false) returns bigint
language sql security definer set search_path='' as $$
 select net.http_post(
   url:='https://koepwazbabovrdnnobav.supabase.co/functions/v1/crm-backup',
   headers:=jsonb_build_object('Content-Type','application/json','x-crm-backup-token',
     (select s.decrypted_secret from vault.decrypted_secrets s join private.crm_backup_config c on c.vault_secret_id=s.id)),
   body:=jsonb_build_object('force',p_force),timeout_milliseconds:=10000);
$$;
revoke all on function private.crm_enqueue_backup_v5(boolean) from public,anon,authenticated;
create or replace function private.crm_request_backup_v5() returns bigint
language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or not private.is_manager() then raise exception 'Доступно только владельцу';end if;
 return private.crm_enqueue_backup_v5(true);
end $$;
create or replace function public.crm_request_backup_v5() returns bigint
language sql security invoker set search_path='' as $$select private.crm_request_backup_v5();$$;
revoke all on function private.crm_request_backup_v5(),public.crm_request_backup_v5() from public,anon;
grant execute on function private.crm_request_backup_v5(),public.crm_request_backup_v5() to authenticated;
select cron.schedule('crm-backup-v5','15 0 * * *','select private.crm_enqueue_backup_v5();');
commit;
