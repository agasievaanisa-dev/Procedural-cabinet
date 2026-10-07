-- CRM v5: authorized clinical management, append-only audit, private documents.
-- Apply before crm-finance-v5.sql / crm-warehouse-v5.sql / crm-backup-v5.sql.
begin;

alter table public.patients add column if not exists sex text;
alter table public.patients add column if not exists archived boolean not null default false;
alter table public.patients add column if not exists archived_at timestamptz;
alter table public.medications add column if not exists manufacturer text;
alter table public.medications add column if not exists release_form text;
alter table public.medications add column if not exists comment text;
alter table public.medication_batches add column if not exists batch_number text;
alter table public.medication_batches add column if not exists supplier text;
alter table public.procedure_services add column if not exists comment text;
alter table public.stock_movements add column if not exists actor_user uuid;
alter table public.stock_movements add column if not exists actor_staff uuid;

create table if not exists private.crm_audit_log (
 id uuid primary key default gen_random_uuid(),
 actor_user uuid,
 actor_staff uuid,
 action text not null,
 entity_type text not null,
 entity_id text,
 before_data jsonb,
 after_data jsonb,
 reason text,
 created_at timestamptz not null default now()
);
create index if not exists crm_audit_created_idx on private.crm_audit_log(created_at desc);
create index if not exists crm_audit_entity_idx on private.crm_audit_log(entity_type,entity_id,created_at desc);
alter table private.crm_audit_log enable row level security;
revoke all on private.crm_audit_log from public,anon,authenticated;

create table if not exists private.crm_procedure_templates (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name))>0),
 service_id uuid references public.procedure_services(id),
 items jsonb not null default '[]'::jsonb check (jsonb_typeof(items)='array'),
 notes text,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table private.crm_procedure_templates enable row level security;
revoke all on private.crm_procedure_templates from public,anon,authenticated;

create or replace function private.crm_audit_v5(
 p_action text,p_entity_type text,p_entity_id text,
 p_before jsonb default null,p_after jsonb default null,p_reason text default null
) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,before_data,after_data,reason)
 values(auth.uid(),(select id from public.staff where auth_user_id=auth.uid() limit 1),
 p_action,p_entity_type,p_entity_id,p_before,p_after,nullif(trim(p_reason),''));
end $$;
revoke all on function private.crm_audit_v5(text,text,text,jsonb,jsonb,text) from public,anon,authenticated;

create or replace function private.crm_change_audit_v5() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_row jsonb;new_row jsonb;reason_text text;
begin
 if tg_op<>'INSERT' then old_row:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then new_row:=to_jsonb(new);end if;
 if tg_table_name='medications' and tg_op='UPDATE' and
   old_row->'purchase_price' is not distinct from new_row->'purchase_price' and old_row->'sale_price' is not distinct from new_row->'sale_price' then
  return new;
 end if;
 reason_text:=coalesce(new_row->>'reason',new_row->>'comment',nullif(current_setting('crm.audit_reason',true),''));
 perform private.crm_audit_v5(lower(tg_op),tg_table_name,coalesce(new_row->>'id',old_row->>'id'),old_row,new_row,reason_text);
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function private.crm_change_audit_v5() from public,anon,authenticated;
drop trigger if exists crm_medications_audit_v5 on public.medications;
create trigger crm_medications_audit_v5 after insert or update of purchase_price,sale_price on public.medications
 for each row execute function private.crm_change_audit_v5();
drop trigger if exists crm_services_audit_v5 on public.procedure_services;
create trigger crm_services_audit_v5 after insert or update or delete on public.procedure_services
 for each row execute function private.crm_change_audit_v5();

create or replace function private.crm_stock_actor_v5() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.actor_user:=auth.uid();
 new.actor_staff:=(select id from public.staff where auth_user_id=auth.uid() and active limit 1);
 return new;
end $$;
revoke all on function private.crm_stock_actor_v5() from public,anon,authenticated;
drop trigger if exists crm_stock_actor_v5 on public.stock_movements;
create trigger crm_stock_actor_v5 before insert on public.stock_movements
 for each row execute function private.crm_stock_actor_v5();
drop trigger if exists crm_stock_audit_v5 on public.stock_movements;
create trigger crm_stock_audit_v5 after insert on public.stock_movements
 for each row execute function private.crm_change_audit_v5();

create or replace function private.crm_management_v5(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid;role_name text;is_manager boolean;entity_id uuid;auth_id uuid;
 before_row jsonb;result_row jsonb;item jsonb;qty numeric;item_med uuid;
 patient_row public.patients%rowtype;staff_row public.staff%rowtype;
 template_row private.crm_procedure_templates%rowtype;service_row public.procedure_services%rowtype;
 canonical_items jsonb:='[]'::jsonb;email_value text;name_value text;new_role text;
 is_active boolean;value_money numeric;relation_row record;table_rows jsonb;export_tables jsonb:='{}'::jsonb;
begin
 if auth.uid() is null then raise exception 'Войдите в программу';end if;
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active
  and role in ('owner','admin','nurse') limit 1;
 if actor is null then raise exception 'Нет доступа: сотрудник неактивен';end if;
 is_manager:=role_name in ('owner','admin');
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Некорректные данные';end if;
 if p_action in ('services_save','services_save_v5') then p_action:='service_save';end if;
 if p_action in ('templates_save','templates_save_v5') then p_action:='template_save';end if;
 if p_action not in ('patient_list','patient_save','patient_archive','templates_list','template_save',
  'services_list','service_save','staff_list','staff_save','audit_list','backup_export') then
  raise exception 'Неизвестная операция';end if;
 if p_action in ('patient_archive','template_save','service_save','staff_list','staff_save','audit_list','backup_export')
  and not is_manager then raise exception 'Доступно только владельцу';end if;
 entity_id:=nullif(p_payload->>'id','')::uuid;
 case p_action
 when 'patient_list' then
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.full_name,p.id) from public.patients p
   where not p.archived or (is_manager and coalesce((p_payload->>'include_archived')::boolean,false))),'[]'::jsonb);
 when 'patient_save' then
  if entity_id is not null and not is_manager then raise exception 'Изменять пациентов может только владелец';end if;
  if entity_id is not null then
   select * into patient_row from public.patients where id=entity_id for update;
   if not found then raise exception 'Пациент не найден';end if;
   before_row:=to_jsonb(patient_row);
  end if;
  name_value:=case when p_payload?'full_name' then nullif(trim(p_payload->>'full_name'),'') else patient_row.full_name end;
  if name_value is null then raise exception 'Укажите имя пациента';end if;
  if p_payload?'sex' and nullif(p_payload->>'sex','') is not null and
   p_payload->>'sex' not in ('female','male','other','unknown') then raise exception 'Проверьте пол пациента';end if;
  if nullif(p_payload->>'birth_date','')::date>(now() at time zone 'Europe/Moscow')::date then raise exception 'Дата рождения не может быть в будущем';end if;
  if entity_id is null then
   insert into public.patients(full_name,birth_date,sex,phone,complaints,request,prescriptions,notes)
   values(name_value,nullif(p_payload->>'birth_date','')::date,nullif(p_payload->>'sex',''),nullif(trim(p_payload->>'phone'),''),
    nullif(trim(p_payload->>'complaints'),''),nullif(trim(p_payload->>'request'),''),nullif(trim(p_payload->>'prescriptions'),''),nullif(trim(p_payload->>'notes'),''))
   returning to_jsonb(patients.*) into result_row;
  else
   update public.patients set full_name=name_value,
    birth_date=case when p_payload?'birth_date' then nullif(p_payload->>'birth_date','')::date else birth_date end,
    sex=case when p_payload?'sex' then nullif(p_payload->>'sex','') else sex end,
    phone=case when p_payload?'phone' then nullif(trim(p_payload->>'phone'),'') else phone end,
    complaints=case when p_payload?'complaints' then nullif(trim(p_payload->>'complaints'),'') else complaints end,
    request=case when p_payload?'request' then nullif(trim(p_payload->>'request'),'') else request end,
    prescriptions=case when p_payload?'prescriptions' then nullif(trim(p_payload->>'prescriptions'),'') else prescriptions end,
    notes=case when p_payload?'notes' then nullif(trim(p_payload->>'notes'),'') else notes end,updated_at=now()
   where id=entity_id returning to_jsonb(patients.*) into result_row;
  end if;
  perform private.crm_audit_v5(case when entity_id is null then 'insert' else 'update' end,'patients',result_row->>'id',before_row,result_row);
  return result_row;
 when 'patient_archive' then
  select to_jsonb(p) into before_row from public.patients p where id=entity_id for update;
  if not found then raise exception 'Пациент не найден';end if;
  is_active:=coalesce((p_payload->>'archived')::boolean,true);
  update public.patients set archived=is_active,archived_at=case when is_active then now() else null end,updated_at=now()
   where id=entity_id returning to_jsonb(patients.*) into result_row;
  perform private.crm_audit_v5(case when is_active then 'archive' else 'restore' end,'patients',entity_id::text,before_row,result_row);
  return result_row;
 when 'staff_list' then
  return coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('email',u.email) order by s.full_name,s.id)
   from public.staff s left join auth.users u on u.id=s.auth_user_id),'[]'::jsonb);
 when 'staff_save' then
  -- Serializing staff edits prevents concurrent removal of the final manager.
  perform pg_advisory_xact_lock(hashtextextended('crm-v5-staff-management',0));
  if entity_id is not null then
   select * into staff_row from public.staff where id=entity_id for update;
   if not found then raise exception 'Сотрудник не найден';end if;
   before_row:=to_jsonb(staff_row);
  end if;
  name_value:=case when p_payload?'full_name' then nullif(trim(p_payload->>'full_name'),'') else staff_row.full_name end;
  if name_value is null then raise exception 'Укажите имя сотрудника';end if;
  new_role:=coalesce(nullif(p_payload->>'role',''),staff_row.role,'nurse');
  if new_role not in ('nurse','admin','owner') then raise exception 'Некорректная роль';end if;
  is_active:=case when p_payload?'active' then coalesce((p_payload->>'active')::boolean,true) else coalesce(staff_row.active,true) end;
  auth_id:=staff_row.auth_user_id;
  email_value:=nullif(lower(trim(p_payload->>'email')),'');
  if email_value is not null then
   select id into auth_id from auth.users where lower(email)=email_value limit 1;
   if auth_id is null then raise exception 'Сначала создайте учётную запись сотрудника';end if;
  elsif p_payload?'auth_user_id' and nullif(p_payload->>'auth_user_id','') is not null then
   auth_id:=(p_payload->>'auth_user_id')::uuid;
   if not exists(select 1 from auth.users where id=auth_id) then raise exception 'Учётная запись не найдена';end if;
  end if;
  if auth_id is not null and exists(select 1 from public.staff where auth_user_id=auth_id and id is distinct from entity_id) then
   raise exception 'Учётная запись уже связана с сотрудником';end if;
  if entity_id is not null and staff_row.active and staff_row.role in ('admin','owner') and
   (not is_active or new_role='nurse') and not exists(select 1 from public.staff
    where active and role in ('admin','owner') and id<>entity_id and auth_user_id is not null) then
   raise exception 'Нельзя отключить последнего владельца';end if;
  if entity_id is null then
   insert into public.staff(full_name,role,active,auth_user_id) values(name_value,new_role,is_active,auth_id)
    returning to_jsonb(staff.*) into result_row;
  else
   update public.staff set full_name=name_value,role=new_role,active=is_active,auth_user_id=auth_id
    where id=entity_id returning to_jsonb(staff.*) into result_row;
  end if;
  perform private.crm_audit_v5(case when entity_id is null then 'insert' else 'update' end,'staff',result_row->>'id',before_row,result_row,p_payload->>'reason');
  return result_row||jsonb_build_object('email',(select email from auth.users where id=auth_id));
 when 'services_list' then
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.name,s.id) from public.procedure_services s
   where is_manager or s.active),'[]'::jsonb);
 when 'service_save' then
  if entity_id is not null then
   select * into service_row from public.procedure_services where id=entity_id for update;
   if not found then raise exception 'Услуга не найдена';end if;
  end if;
  name_value:=case when p_payload?'name' then nullif(trim(p_payload->>'name'),'') else service_row.name end;
  if name_value is null then raise exception 'Укажите название услуги';end if;
  if p_payload?'price' and not p_payload?'work_price' then p_payload:=p_payload||jsonb_build_object('work_price',p_payload->'price');end if;
  for item in select jsonb_build_object('value',value) from jsonb_each(p_payload) where key in ('work_price','consumables_price') loop
   value_money:=(item->>'value')::numeric;
   if value_money is null or value_money<0 or value_money::text in ('NaN','Infinity','-Infinity') then raise exception 'Стоимость должна быть неотрицательной';end if;
  end loop;
  if entity_id is null then
   insert into public.procedure_services(name,work_price,consumables_price,comment,active)
   values(name_value,coalesce((p_payload->>'work_price')::numeric,0),coalesce((p_payload->>'consumables_price')::numeric,0),
    nullif(trim(p_payload->>'comment'),''),coalesce((p_payload->>'active')::boolean,true))
    returning to_jsonb(procedure_services.*) into result_row;
  else
   update public.procedure_services set name=name_value,
    work_price=case when p_payload?'work_price' then (p_payload->>'work_price')::numeric else work_price end,
    consumables_price=case when p_payload?'consumables_price' then (p_payload->>'consumables_price')::numeric else consumables_price end,
    comment=case when p_payload?'comment' then nullif(trim(p_payload->>'comment'),'') else comment end,
    active=case when p_payload?'active' then coalesce((p_payload->>'active')::boolean,true) else active end
    where id=entity_id returning to_jsonb(procedure_services.*) into result_row;
  end if;
  return result_row;
 when 'templates_list' then
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.name,t.id) from private.crm_procedure_templates t
   where is_manager or t.active),'[]'::jsonb);
 when 'template_save' then
  if entity_id is not null then
   select * into template_row from private.crm_procedure_templates where id=entity_id for update;
   if not found then raise exception 'Шаблон не найден';end if;
   before_row:=to_jsonb(template_row);
  end if;
  name_value:=case when p_payload?'name' then nullif(trim(p_payload->>'name'),'') else template_row.name end;
  if name_value is null then raise exception 'Укажите название шаблона';end if;
  if not p_payload?'items' then p_payload:=p_payload||jsonb_build_object('items',coalesce(template_row.items,'[]'::jsonb));end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'Некорректный состав шаблона';end if;
  for item in select * from jsonb_array_elements(p_payload->'items') loop
   item_med:=nullif(item->>'medication_id','')::uuid;qty:=(item->>'quantity')::numeric;
   if qty is null or qty<=0 or qty<>trunc(qty) or qty::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Количество препарата должно быть целым числом больше нуля';end if;
   if not exists(select 1 from public.medications where id=item_med and active) then raise exception 'Препарат недоступен';end if;
   canonical_items:=canonical_items||jsonb_build_array(jsonb_build_object('medication_id',item_med,'quantity',qty));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('medication_id',med,'quantity',quantity) order by med),'[]'::jsonb)
   into canonical_items from (select (i->>'medication_id')::uuid med,sum((i->>'quantity')::numeric) quantity
    from jsonb_array_elements(canonical_items) i group by (i->>'medication_id')::uuid) grouped;
  auth_id:=case when p_payload?'service_id' then nullif(p_payload->>'service_id','')::uuid else template_row.service_id end;
  if auth_id is not null and not exists(select 1 from public.procedure_services where id=auth_id and active) then raise exception 'Услуга недоступна';end if;
  if entity_id is null then
   insert into private.crm_procedure_templates(name,service_id,items,notes,active)
    values(name_value,auth_id,canonical_items,nullif(trim(p_payload->>'notes'),''),coalesce((p_payload->>'active')::boolean,true))
    returning to_jsonb(crm_procedure_templates.*) into result_row;
  else
   update private.crm_procedure_templates set name=name_value,service_id=auth_id,items=canonical_items,
    notes=case when p_payload?'notes' then nullif(trim(p_payload->>'notes'),'') else notes end,
    active=case when p_payload?'active' then coalesce((p_payload->>'active')::boolean,true) else active end,updated_at=now()
    where id=entity_id returning to_jsonb(crm_procedure_templates.*) into result_row;
  end if;
  perform private.crm_audit_v5(case when entity_id is null then 'insert' else 'update' end,'procedure_templates',result_row->>'id',before_row,result_row);
  return result_row;
 when 'audit_list' then
  return coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('actor_name',s.full_name) order by a.created_at desc,a.id)
   from (select * from private.crm_audit_log order by created_at desc,id limit least(1000,greatest(1,coalesce((p_payload->>'limit')::integer,200)))) a
   left join public.staff s on s.id=a.actor_staff),'[]'::jsonb);
 when 'backup_export' then
  perform private.crm_audit_v5('export','backup',null);
  -- crm-backup-v5.sql supplies the shared one-statement consistent snapshot.
  -- All CRM v5 migrations must be installed before using backup_export.
  return private.crm_backup_data_v5()||jsonb_build_object('version','5.0','exported_at',now());
 end case;
end $$;
revoke all on function private.crm_management_v5(text,jsonb) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.crm_management_v5(text,jsonb) to authenticated;
create or replace function public.crm_management_v5(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.crm_management_v5(p_action,p_payload); $$;
revoke all on function public.crm_management_v5(text,jsonb) from public,anon;
grant execute on function public.crm_management_v5(text,jsonb) to authenticated;

-- All clinical writes flow through the role-checked API. Existing SELECT grants
-- remain for the application's session identity and clinical lookup loaders.
alter table public.patients enable row level security;
alter table public.staff enable row level security;
alter table public.procedure_services enable row level security;
alter table public.patient_files enable row level security;
revoke insert,update,delete on public.patients,public.staff,public.procedure_services,public.patient_files from public,anon,authenticated;
drop policy if exists nurse_patients_insert on public.patients;
drop policy if exists nurse_patients_update on public.patients;

create or replace function private.crm_document_access_v5(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.staff where auth_user_id=auth.uid()
  and active and role in ('nurse','admin','owner')) and exists(select 1 from public.patients
  where id::text=split_part(p_path,'/',1));
$$;
revoke all on function private.crm_document_access_v5(text) from public,anon;
grant execute on function private.crm_document_access_v5(text) to authenticated;

-- Both bucket names are supported for existing installations.
update storage.buckets set public=false,file_size_limit=15728640,
 allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp']
 where id in ('patient-documents','patient-files');
-- Restrictive policies apply even if historical permissive policies are broad.
drop policy if exists crm_documents_active_gate_v5 on storage.objects;
create policy crm_documents_active_gate_v5 on storage.objects as restrictive for all to public
 using(bucket_id not in ('patient-documents','patient-files') or private.crm_document_access_v5(name))
 with check(bucket_id not in ('patient-documents','patient-files') or private.crm_document_access_v5(name));
drop policy if exists crm_documents_read_v5 on storage.objects;
create policy crm_documents_read_v5 on storage.objects for select to authenticated
 using(bucket_id in ('patient-documents','patient-files') and private.crm_document_access_v5(name));
drop policy if exists crm_documents_upload_v5 on storage.objects;
create policy crm_documents_upload_v5 on storage.objects for insert to authenticated
 with check(bucket_id in ('patient-documents','patient-files') and private.crm_document_access_v5(name) and owner_id=auth.uid()::text);
drop policy if exists crm_documents_upload_gate_v5 on storage.objects;
create policy crm_documents_upload_gate_v5 on storage.objects as restrictive for insert to public
 with check(bucket_id not in ('patient-documents','patient-files') or
  (private.crm_document_access_v5(name) and owner_id=auth.uid()::text));
drop policy if exists crm_documents_update_gate_v5 on storage.objects;
create policy crm_documents_update_gate_v5 on storage.objects as restrictive for update to public
 using(bucket_id not in ('patient-documents','patient-files') or private.is_manager())
 with check(bucket_id not in ('patient-documents','patient-files') or private.is_manager());
drop policy if exists crm_documents_update_v5 on storage.objects;
create policy crm_documents_update_v5 on storage.objects for update to authenticated
 using(bucket_id in ('patient-documents','patient-files') and private.is_manager())
 with check(bucket_id in ('patient-documents','patient-files') and private.is_manager());

create or replace function private.crm_document_delete_v5(p_bucket text,p_name text,p_owner text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_bucket in ('patient-documents','patient-files') and private.crm_document_access_v5(p_name) and (private.is_manager() or
  (p_owner=auth.uid()::text and not exists(select 1 from public.patient_files where storage_path=p_name)
   and not exists(select 1 from public.patient_documents where storage_path=p_name)));
$$;
revoke all on function private.crm_document_delete_v5(text,text,text) from public,anon;
grant execute on function private.crm_document_delete_v5(text,text,text) to authenticated;
drop policy if exists crm_documents_delete_gate_v5 on storage.objects;
create policy crm_documents_delete_gate_v5 on storage.objects as restrictive for delete to public
 using(bucket_id not in ('patient-documents','patient-files') or private.crm_document_delete_v5(bucket_id,name,owner_id));
drop policy if exists crm_documents_delete_v5 on storage.objects;
create policy crm_documents_delete_v5 on storage.objects for delete to authenticated
 using(bucket_id in ('patient-documents','patient-files') and private.crm_document_delete_v5(bucket_id,name,owner_id));

create or replace function private.crm_register_patient_file_v5(p_patient_id uuid,p_title text,p_document_date date,
 p_storage_path text,p_original_name text,p_mime_type text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid;object_row storage.objects%rowtype;existing_id uuid;result_id uuid;size_value bigint;mime_value text;
begin
 select id into actor from public.staff where auth_user_id=auth.uid() and active and role in ('nurse','admin','owner') limit 1;
 if actor is null then raise exception 'Нет доступа';end if;
 if not private.crm_document_access_v5(p_storage_path) or split_part(p_storage_path,'/',1)<>p_patient_id::text then
  raise exception 'Пациент или путь документа некорректен';end if;
 if nullif(trim(p_title),'') is null then raise exception 'Укажите название документа';end if;
 if p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp') or p_mime_type is null then
  raise exception 'Разрешены PDF, JPG, PNG и WEBP';end if;
 perform pg_advisory_xact_lock(hashtextextended('crm-document:'||p_storage_path,0));
 -- Metadata has no bucket column: new registrations use the canonical bucket.
 select * into object_row from storage.objects where bucket_id='patient-documents' and name=p_storage_path
  limit 1 for share;
 if not found then raise exception 'Сначала загрузите файл';end if;
 if object_row.owner_id is distinct from auth.uid()::text then raise exception 'Файл загружен другим сотрудником';end if;
 mime_value:=coalesce(object_row.metadata->>'mimetype',object_row.metadata->>'contentType');
 size_value:=coalesce(nullif(object_row.metadata->>'size','')::bigint,0);
 if mime_value is distinct from p_mime_type or size_value<=0 or size_value>15728640 then raise exception 'Проверьте тип и размер загруженного файла';end if;
 select id into existing_id from public.patient_files where storage_path=p_storage_path and patient_id=p_patient_id limit 1;
 if existing_id is not null then return existing_id;end if;
 if exists(select 1 from public.patient_files where storage_path=p_storage_path) then raise exception 'Документ уже связан с другим пациентом';end if;
 insert into public.patient_files(patient_id,title,document_date,storage_path,original_name,mime_type,created_by)
 values(p_patient_id,trim(p_title),coalesce(p_document_date,(now() at time zone 'Europe/Moscow')::date),p_storage_path,nullif(p_original_name,''),p_mime_type,actor)
 returning id into result_id;
 perform private.crm_audit_v5('insert','patient_files',result_id::text,null,jsonb_build_object('patient_id',p_patient_id,'storage_path',p_storage_path));
 return result_id;
end $$;
revoke all on function private.crm_register_patient_file_v5(uuid,text,date,text,text,text) from public,anon;
grant execute on function private.crm_register_patient_file_v5(uuid,text,date,text,text,text) to authenticated;
create or replace function public.register_patient_file_v8(p_patient_id uuid,p_title text,p_document_date date,
 p_storage_path text,p_original_name text,p_mime_type text) returns uuid
language sql security invoker set search_path='' as $$
 select private.crm_register_patient_file_v5(p_patient_id,p_title,p_document_date,p_storage_path,p_original_name,p_mime_type);
$$;
revoke all on function public.register_patient_file_v8(uuid,text,date,text,text,text) from public,anon;
grant execute on function public.register_patient_file_v8(uuid,text,date,text,text,text) to authenticated;
create or replace function private.crm_patient_files_v5(p_patient_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not private.crm_document_access_v5(p_patient_id::text||'/') then raise exception 'Нет доступа';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'document_date',f.document_date,
  'storage_path',f.storage_path,'original_name',f.original_name,'mime_type',f.mime_type,'created_at',f.created_at)
  order by f.document_date desc,f.created_at desc) from public.patient_files f where patient_id=p_patient_id),'[]'::jsonb);
end $$;
revoke all on function private.crm_patient_files_v5(uuid) from public,anon;
grant execute on function private.crm_patient_files_v5(uuid) to authenticated;
create or replace function public.patient_files_v8(p_patient_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.crm_patient_files_v5(p_patient_id); $$;
revoke all on function public.patient_files_v8(uuid) from public,anon;
grant execute on function public.patient_files_v8(uuid) to authenticated;
commit;
