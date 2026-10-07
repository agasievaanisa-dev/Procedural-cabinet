-- CRM v5: authorized clinical management, append-only audit, private documents.
-- Apply before crm-finance-v5.sql / crm-warehouse-v5.sql / crm-backup-v5.sql.

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

-- CRM ТЗ 3.0: atomic payment allocation, fixed shift payroll and closed reports.
-- Apply after crm-management-v5.sql. Old receipts stay unclassified: no backfill guesses.

create table if not exists private.crm_finance_settings (
 id boolean primary key default true check (id),
 float_amount numeric(14,2) not null default 50000 check (float_amount>=0),
 time_zone text not null default 'Europe/Moscow',
 updated_by uuid, updated_at timestamptz not null default now()
);
insert into private.crm_finance_settings(id) values(true) on conflict do nothing;
create table if not exists private.crm_payment_allocations (
 id uuid primary key references private.warehouse_requests(id),
 kind text not null check(kind in ('procedure','sale')),
 procedure_id uuid unique references public.procedures(id),
 sale_id uuid unique references public.sales(id),
 cash numeric(14,2) not null check(cash>=0),
 terminal numeric(14,2) not null check(terminal>=0),
 owner_card numeric(14,2) not null check(owner_card>=0),
 cash_received numeric(14,2) not null check(cash_received>=cash),
 change_amount numeric(14,2) not null check(change_amount=cash_received-cash),
 created_by uuid not null, created_at timestamptz not null default now(),
 check((kind='procedure' and procedure_id is not null and sale_id is null)
    or (kind='sale' and sale_id is not null and procedure_id is null))
);
create table if not exists private.crm_shift_payroll (
 shift_id uuid not null references public.shifts(id),
 staff_id uuid not null references public.staff(id),
 amount numeric(14,2) not null default 2000 check(amount>=0),
 reason text, updated_by uuid, updated_at timestamptz not null default now(),
 primary key(shift_id,staff_id)
);
create table if not exists private.crm_shift_reports (
 shift_id uuid primary key references public.shifts(id),
 report jsonb not null, closed_by uuid, closed_at timestamptz not null default now()
);
alter table private.crm_finance_settings enable row level security;
alter table private.crm_payment_allocations enable row level security;
alter table private.crm_shift_payroll enable row level security;
alter table private.crm_shift_reports enable row level security;
revoke all on private.crm_finance_settings,private.crm_payment_allocations,private.crm_shift_payroll,private.crm_shift_reports from public,anon,authenticated;

alter table public.shifts add column if not exists daily_slot smallint check(daily_slot in (1,2));
-- Preserve legacy days containing more than two shifts without inventing slot assignments.
with ranked as (
 select id,row_number() over(partition by shift_date order by started_at,id) slot,
 count(*) over(partition by shift_date) cnt from public.shifts
)
update public.shifts s set daily_slot=r.slot from ranked r where s.id=r.id and r.cnt<=2 and s.daily_slot is null;
create unique index if not exists shifts_daily_slot_v5 on public.shifts(shift_date,daily_slot) where daily_slot is not null;
create index if not exists procedures_visit_finance_v5 on public.procedures(visit_at);
create index if not exists sales_sold_finance_v5 on public.sales(sold_at);
create index if not exists procedures_shift_finance_v5 on public.procedures(shift_id);
create index if not exists sales_shift_finance_v5 on public.sales(shift_id);
create index if not exists shift_staff_shift_finance_v5 on public.shift_staff(shift_id);

create or replace function private.crm_shift_slot_v5()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.shift_date is null then raise exception 'Укажите дату смены';end if;
 perform pg_advisory_xact_lock(513005,(new.shift_date-date '2000-01-01')::integer);
 if (select count(*) from public.shifts where shift_date=new.shift_date)>=2 then raise exception 'В этот день уже созданы две смены';end if;
 select x into new.daily_slot from generate_series(1,2) x
 where not exists(select 1 from public.shifts where shift_date=new.shift_date and daily_slot=x) order by x limit 1;
 return new;
end $$;
drop trigger if exists crm_shift_slot_v5 on public.shifts;
create trigger crm_shift_slot_v5 before insert on public.shifts for each row execute function private.crm_shift_slot_v5();

create or replace function private.crm_shift_payroll_default_v5()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.shifts where id=new.shift_id and status='open' for update;
 if not found then raise exception 'Сотрудников можно выбирать только в открытой смене';end if;
 if not exists(select 1 from public.staff where id=new.staff_id and active and role='nurse') then raise exception 'Выберите действующую медсестру';end if;
 if(select count(*) from public.shift_staff where shift_id=new.shift_id)>2 then raise exception 'В смене работают две медсестры';end if;
 if(select count(*) from public.shift_staff where shift_id=new.shift_id and staff_id=new.staff_id)>1 then raise exception 'Медсестра уже входит в смену';end if;
 insert into private.crm_shift_payroll(shift_id,staff_id) values(new.shift_id,new.staff_id) on conflict do nothing;
 return new;
end $$;
drop trigger if exists crm_shift_payroll_default_v5 on public.shift_staff;
create trigger crm_shift_payroll_default_v5 after insert on public.shift_staff for each row execute function private.crm_shift_payroll_default_v5();
-- Existing wages are deliberately not backfilled. Historical payroll stays unknown
-- until the owner records a justified retrospective amount.

create or replace function private.crm_redact_finance_v5(p_value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare answer jsonb; v jsonb; k text; cleaned jsonb;
begin
 if jsonb_typeof(p_value)='object' then
  if p_value->>'scope'='reserve' then return null;end if;
  answer:='{}';
  for k,v in select key,value from jsonb_each(p_value) loop
   if k=any(array['revenue','payroll_total','payroll_closed','payroll_open','payroll_unknown','payroll_complete','cash_after_salary','float_amount','amount','reason','list_total','discount_amount','discount_percent','discount_reason','discount_comment','paid_total','paid','discount','procedures_total','sales_total','cash_total','total','unit_price','line_total','purchase_price','reserve','min_total_stock']) then continue;end if;
   answer:=answer||jsonb_build_object(k,private.crm_redact_finance_v5(v));
  end loop;
  return answer;
 elsif jsonb_typeof(p_value)='array' then
  answer:='[]';
  for v in select value from jsonb_array_elements(p_value) loop
   cleaned:=private.crm_redact_finance_v5(v);
   if cleaned is not null then answer:=answer||jsonb_build_array(cleaned);end if;
  end loop;
  return answer;
 end if;
 return p_value;
end $$;

create or replace function private.record_treatment_v5(p_kind text,p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; role_name text; sh uuid; item record; req private.warehouse_requests%rowtype;
 pay jsonb:=p_payload->'payments'; cash_n numeric; terminal_n numeric; card_n numeric; received_n numeric;
 answer jsonb; result_id uuid; paid_n numeric; list_n numeric; reserve_n boolean:=coalesce((p_payload->>'reserve_sale')::boolean,false);
 available_n numeric; missing_n numeric; saved private.crm_payment_allocations%rowtype;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if p_kind is null or p_kind not in ('procedure','sale') or p_request_id is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Проверьте операцию';end if;
 if jsonb_typeof(pay) is distinct from 'object' then raise exception 'Укажите способы оплаты';end if;
 if exists(select 1 from jsonb_object_keys(pay) k where k not in ('cash','terminal','owner_card','cash_received')) then raise exception 'Неизвестный способ оплаты';end if;
 cash_n:=coalesce((pay->>'cash')::numeric,0);terminal_n:=coalesce((pay->>'terminal')::numeric,0);card_n:=coalesce((pay->>'owner_card')::numeric,0);
 received_n:=coalesce((pay->>'cash_received')::numeric,cash_n);
 if exists(select 1 from unnest(array[cash_n,terminal_n,card_n,received_n]) n where n<0 or n<>round(n,2) or n::text in ('NaN','Infinity','-Infinity') or n>999999999999.99) then raise exception 'Суммы оплаты должны быть неотрицательными, с точностью до копейки';end if;
 if received_n<cash_n or (cash_n=0 and received_n<>0) then raise exception 'Проверьте полученные наличные';end if;
 if reserve_n and (role_name='nurse' or p_kind<>'sale') then raise exception 'Продажа из запаса доступна только владельцу';end if;
 -- The v3 request row protects the entire v5 payload, including the payment allocation.
 insert into private.warehouse_requests(id,staff_user,action,payload) values(p_request_id,auth.uid(),'clinical_'||p_kind,p_payload) on conflict do nothing;
 select * into req from private.warehouse_requests where id=p_request_id for update;
 if req.staff_user<>auth.uid() or req.action<>'clinical_'||p_kind or req.payload<>p_payload then raise exception 'Номер операции уже использован';end if;
 select * into saved from private.crm_payment_allocations where id=p_request_id;
 if found then
  return jsonb_build_object('id',coalesce(saved.procedure_id,saved.sale_id),'paid_total',saved.cash+saved.terminal+saved.owner_card,
   'payments',jsonb_build_object('cash',saved.cash,'terminal',saved.terminal,'owner_card',saved.owner_card,'cash_received',saved.cash_received,'change',saved.change_amount));
 end if;
 if req.result is not null then raise exception 'Эта операция была сохранена без распределения оплаты. Создайте новую операцию';end if;
 sh:=(p_payload->>'shift_id')::uuid;
 perform 1 from public.shifts where id=sh and status='open' for update;
 if not found then raise exception 'Смена закрыта или не выбрана';end if;
 if role_name='nurse' and not exists(select 1 from public.shift_staff where shift_id=sh and staff_id=actor) then raise exception 'Нет доступа к этой смене';end if;
 if nullif(p_payload->>'patient_id','') is not null then
  perform 1 from public.patients where id=(p_payload->>'patient_id')::uuid and not archived for share;
  if not found then raise exception 'Пациент не найден или находится в архиве. Владелец должен восстановить карточку';end if;
 end if;
 if jsonb_typeof(coalesce(p_payload->'items','[]'))<>'array' then raise exception 'Проверьте список препаратов';end if;
 if reserve_n then
  -- Owner approval is the authenticated owner performing this one atomic sale.
  -- Transfer just the missing usable units, then reuse the existing FEFO clinical path.
  for item in select (x->>'medication_id')::uuid med_id,sum((x->>'quantity')::numeric) qty
    from jsonb_array_elements(coalesce(p_payload->'items','[]')) x group by 1 order by 1 loop
   if item.qty is null or item.qty<=0 or item.qty<>trunc(item.qty) or item.qty::text in ('NaN','Infinity','-Infinity') then raise exception 'Укажите целое количество препарата';end if;
   perform 1 from public.medications where id=item.med_id for update;
   select coalesce(sum(work_quantity),0) into available_n from public.medication_batches
    where medication_id=item.med_id and expiry_date>=(now() at time zone 'Europe/Moscow')::date;
   missing_n:=greatest(item.qty-available_n,0);
   if missing_n>0 then perform private.move_stock_v3(item.med_id,missing_n,'reserve','work','reserve_to_work','Перевод владельцем для продажи');end if;
  end loop;
 end if;
 answer:=private.record_treatment_v3(p_kind,p_payload,p_request_id);
 result_id:=(answer->>'id')::uuid;
 if p_kind='procedure' then select paid_total,list_total into paid_n,list_n from public.procedures where id=result_id;
 else select paid_total,list_total into paid_n,list_n from public.sales where id=result_id;end if;
 if role_name='nurse' and paid_n<>list_n then raise exception 'Скидку может назначить только владелец';end if;
 if cash_n+terminal_n+card_n<>paid_n then raise exception 'Сумма способов оплаты должна совпадать со стоимостью: % ₽',paid_n;end if;
 insert into private.crm_payment_allocations(id,kind,procedure_id,sale_id,cash,terminal,owner_card,cash_received,change_amount,created_by)
 values(p_request_id,p_kind,case when p_kind='procedure' then result_id end,case when p_kind='sale' then result_id end,cash_n,terminal_n,card_n,received_n,received_n-cash_n,auth.uid());
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,after_data)
 values(auth.uid(),actor,'payment_recorded',p_kind,result_id::text,jsonb_build_object('paid_total',paid_n,'cash',cash_n,'terminal',terminal_n,'owner_card',card_n,'cash_received',received_n,'change',received_n-cash_n,'reserve_sale',reserve_n));
 return jsonb_build_object('id',result_id,'paid_total',paid_n,'payments',jsonb_build_object('cash',cash_n,'terminal',terminal_n,'owner_card',card_n,'cash_received',received_n,'change',received_n-cash_n));
end $$;

create or replace function private.crm_build_shift_report_v5(p_shift uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare answer jsonb; revenue_n jsonb; wages_n numeric; unknown_n integer;
begin
 with events as (
  select 'procedure' kind,p.id,p.paid_total from public.procedures p where shift_id=p_shift
  union all select 'sale',s.id,s.paid_total from public.sales s where shift_id=p_shift
 )
 select jsonb_build_object('cash',coalesce(sum(a.cash),0),'terminal',coalesce(sum(a.terminal),0),'owner_card',coalesce(sum(a.owner_card),0),
  'unclassified',coalesce(sum(case when a.id is null then e.paid_total else 0 end),0),'total',coalesce(sum(e.paid_total),0)) into revenue_n
 from events e left join private.crm_payment_allocations a on (e.kind='procedure' and a.procedure_id=e.id) or (e.kind='sale' and a.sale_id=e.id);
 select coalesce(sum(amount),0) into wages_n from private.crm_shift_payroll where shift_id=p_shift;
 select count(*) into unknown_n from public.shift_staff ss join public.staff st on st.id=ss.staff_id
  left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=p_shift and st.role='nurse' and w.shift_id is null;
 select jsonb_build_object(
  'shift',(select jsonb_build_object('id',id,'date',shift_date,'started_at',started_at,'planned_end_at',planned_end_at,'ended_at',ended_at,'status',status,'slot',daily_slot) from public.shifts where id=p_shift),
  'staff',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=p_shift),'[]'),
  'patients_count',(select count(distinct patient_id) from(select patient_id from public.procedures where shift_id=p_shift union all select patient_id from public.sales where shift_id=p_shift) e),
  'procedures_count',(select count(*) from public.procedures where shift_id=p_shift),
  'sales_count',(select count(*) from public.sales where shift_id=p_shift),
  'procedures_total',coalesce((select sum(paid_total) from public.procedures where shift_id=p_shift),0),
  'sales_total',coalesce((select sum(paid_total) from public.sales where shift_id=p_shift),0),
  'cash_total',revenue_n->'total','revenue',revenue_n,'payroll_total',wages_n,'payroll_unknown',unknown_n,'payroll_complete',unknown_n=0,
  'cash_after_salary',case when unknown_n=0 then (revenue_n->>'total')::numeric-wages_n end,
  'procedures',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'at',p.visit_at,'patient_id',p.patient_id,'patient',pt.full_name,'nurse',st.full_name,'type',p.procedure_type,'notes',p.notes,
   'list_total',p.list_total,'discount_amount',p.discount_amount,'paid_total',p.paid_total,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'line_total',pm.line_total) order by m.name) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]')) order by p.visit_at,p.id)
   from public.procedures p left join public.patients pt on pt.id=p.patient_id left join public.staff st on st.id=p.nurse_id where p.shift_id=p_shift),'[]'),
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'at',s.sold_at,'patient_id',s.patient_id,'patient',coalesce(pt.full_name,'Без пациента'),'nurse',st.full_name,'notes',s.notes,
   'list_total',s.list_total,'discount_amount',s.discount_amount,'paid_total',s.paid_total,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'line_total',si.line_total) order by m.name) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]')) order by s.sold_at,s.id)
   from public.sales s left join public.patients pt on pt.id=s.patient_id left join public.staff st on st.id=s.nurse_id where s.shift_id=p_shift),'[]'),
  'used',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.consumption_unit,'procedure_qty',u.proc,'sale_qty',u.sale,'quantity',u.proc+u.sale) order by m.name)
   from(select medication_id,sum(proc) proc,sum(sale) sale from(
    select pm.medication_id,pm.quantity proc,0::numeric sale from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id where p.shift_id=p_shift
    union all select si.medication_id,0,si.quantity from public.sale_items si join public.sales s on s.id=si.sale_id where s.shift_id=p_shift
   ) e group by medication_id) u join public.medications m on m.id=u.medication_id),'[]'),
  'stock',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.consumption_unit,'work',coalesce(w.quantity,0),'reserve',coalesce(r.quantity,0)) order by m.name)
   from public.medications m left join public.stock w on w.medication_id=m.id and w.location='work' left join public.stock r on r.medication_id=m.id and r.location='reserve' where m.active),'[]'),
  'warnings',coalesce((select jsonb_agg(warning) from(
   select jsonb_build_object('type','low_stock','scope','reserve','medication_id',m.id,'name',m.name,'quantity',coalesce(sum(s.quantity),0),'minimum',m.min_total_stock) warning
   from public.medications m left join public.stock s on s.medication_id=m.id where m.active group by m.id having coalesce(sum(s.quantity),0)<m.min_total_stock
   union all select jsonb_build_object('type','low_work','scope','work','medication_id',m.id,'name',m.name,'quantity',coalesce(s.quantity,0),'minimum',m.work_threshold)
   from public.medications m left join public.stock s on s.medication_id=m.id and s.location='work' where m.active and coalesce(s.quantity,0)<m.work_threshold
   union all select jsonb_build_object('type',case when b.expiry_date<(now() at time zone 'Europe/Moscow')::date then 'expired' else 'expiring' end,'scope','work','medication_id',m.id,'name',m.name,'expiry_date',b.expiry_date,'quantity',b.work_quantity)
   from public.medication_batches b join public.medications m on m.id=b.medication_id where b.work_quantity>0 and b.expiry_date<=(now() at time zone 'Europe/Moscow')::date+30
   union all select jsonb_build_object('type',case when b.expiry_date<(now() at time zone 'Europe/Moscow')::date then 'expired' else 'expiring' end,'scope','reserve','medication_id',m.id,'name',m.name,'expiry_date',b.expiry_date,'quantity',b.quantity_remaining-b.work_quantity)
   from public.medication_batches b join public.medications m on m.id=b.medication_id where b.quantity_remaining-b.work_quantity>0 and b.expiry_date<=(now() at time zone 'Europe/Moscow')::date+30
  ) alerts),'[]')
 ) into answer;
 return answer;
end $$;

create or replace function private.crm_finance_summary_v5(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tz text; first_day date; last_day date; grouping text:=coalesce(p_payload->>'group_by','day');
 employee uuid:=nullif(p_payload->>'employee_id','')::uuid; patient uuid:=nullif(p_payload->>'patient_id','')::uuid;
 medication uuid:=nullif(p_payload->>'medication_id','')::uuid; service uuid:=nullif(p_payload->>'service_id','')::uuid;
 answer jsonb; wages_n numeric; closed_wages numeric; open_wages numeric; shifts_n jsonb; complete_n boolean; unknown_n integer; has_open_n boolean;
 entity_filter boolean:=patient is not null or medication is not null or service is not null;
begin
 if auth.uid() is null or not private.is_manager() then raise exception 'Финансовые отчёты доступны только владельцу';end if;
 select time_zone into tz from private.crm_finance_settings where id;
 first_day:=coalesce(nullif(p_payload->>'from','')::date,(now() at time zone tz)::date);
 last_day:=coalesce(nullif(p_payload->>'to','')::date,first_day);
 if last_day<first_day or last_day-first_day>3660 then raise exception 'Проверьте период отчёта';end if;
 if grouping not in ('day','employee','patient','medication','service') then raise exception 'Неизвестная группировка';end if;
 with events as (
  select 'procedure' kind,p.id,p.shift_id,p.nurse_id,p.patient_id,p.service_id,p.procedure_type service_name,p.visit_at at,p.list_total,p.paid_total from public.procedures p
  where p.visit_at>=first_day::timestamp at time zone tz and p.visit_at<(last_day+1)::timestamp at time zone tz
  union all select 'sale',s.id,s.shift_id,s.nurse_id,s.patient_id,null,'Продажа препаратов',s.sold_at,s.list_total,s.paid_total from public.sales s
  where s.sold_at>=first_day::timestamp at time zone tz and s.sold_at<(last_day+1)::timestamp at time zone tz
 ), filtered as (
  select e.*,coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,coalesce(a.owner_card,0) owner_card,case when a.id is null then e.paid_total else 0 end unclassified
  from events e left join private.crm_payment_allocations a on(e.kind='procedure' and a.procedure_id=e.id) or(e.kind='sale' and a.sale_id=e.id)
  where (employee is null or e.nurse_id=employee) and(patient is null or e.patient_id=patient) and(service is null or e.service_id=service)
  and(medication is null or (e.kind='procedure' and exists(select 1 from public.procedure_medications where procedure_id=e.id and medication_id=medication))
   or(e.kind='sale' and exists(select 1 from public.sale_items where sale_id=e.id and medication_id=medication)))
 ), grouped_source as (
  select f.*,case grouping when 'day' then (f.at at time zone tz)::date::text when 'employee' then f.nurse_id::text when 'patient' then coalesce(f.patient_id::text,'no_patient') when 'service' then coalesce(f.service_id::text,'sale') end group_id,
   case grouping when 'day' then (f.at at time zone tz)::date::text when 'employee' then coalesce(st.full_name,'Сотрудник') when 'patient' then coalesce(pt.full_name,'Без пациента') when 'service' then f.service_name end label,1::numeric share,0::numeric quantity
  from filtered f left join public.staff st on st.id=f.nurse_id left join public.patients pt on pt.id=f.patient_id where grouping<>'medication'
  union all
  select f.*,m.id::text,m.name,case when f.list_total>0 then lines.line_total/f.list_total else 0 end,lines.quantity
  from filtered f join lateral(
   select medication_id,sum(line_total) line_total,sum(quantity) quantity from public.procedure_medications where f.kind='procedure' and procedure_id=f.id group by medication_id
   union all select medication_id,sum(line_total),sum(quantity) from public.sale_items where f.kind='sale' and sale_id=f.id group by medication_id
  ) lines on true join public.medications m on m.id=lines.medication_id where grouping='medication' and(medication is null or m.id=medication)
 ), grouped as (
  select group_id,label,count(distinct patient_id) patients_count,count(distinct id) filter(where kind='procedure') procedures_count,count(distinct id) filter(where kind='sale') sales_count,
   sum(quantity) quantity,round(sum(cash*share),2) cash,round(sum(terminal*share),2) terminal,round(sum(owner_card*share),2) owner_card,round(sum(unclassified*share),2) unclassified,round(sum(paid_total*share),2) total
  from grouped_source group by group_id,label
 )
 select jsonb_build_object('from',first_day,'to',last_day,'time_zone',tz,'group_by',grouping,
  'patients_count',(select count(distinct patient_id) from filtered),'procedures_count',(select count(*) from filtered where kind='procedure'),'sales_count',(select count(*) from filtered where kind='sale'),
  'revenue',(select jsonb_build_object('cash',coalesce(sum(cash),0),'terminal',coalesce(sum(terminal),0),'owner_card',coalesce(sum(owner_card),0),'unclassified',coalesce(sum(unclassified),0),'total',coalesce(sum(paid_total),0)) from filtered),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',group_id,'label',label,'patients_count',patients_count,'procedures_count',procedures_count,'sales_count',sales_count,'quantity',quantity,
   'revenue',jsonb_build_object('cash',cash,'terminal',terminal,'owner_card',owner_card,'unclassified',unclassified,'total',total)) order by label,group_id) from grouped),'[]'),
  'rows_revenue_basis',case when grouping='medication' then 'medication_line_share_of_paid_total' else 'full_receipt' end
 ) into answer;
 select coalesce(sum(w.amount),0),coalesce(sum(w.amount) filter(where s.status='closed'),0),coalesce(sum(w.amount) filter(where s.status='open'),0)
 into wages_n,closed_wages,open_wages from private.crm_shift_payroll w join public.shifts s on s.id=w.shift_id
 where s.shift_date between first_day and last_day and(employee is null or w.staff_id=employee);
 select count(*) into unknown_n from public.shift_staff ss join public.shifts s on s.id=ss.shift_id join public.staff st on st.id=ss.staff_id
  left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id
  where s.shift_date between first_day and last_day and st.role='nurse' and w.shift_id is null and(employee is null or ss.staff_id=employee);
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'shift_date',s.shift_date,'started_at',s.started_at,'ended_at',s.ended_at,'status',s.status,'slot',s.daily_slot,
  'staff',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=s.id),'[]'),
  'payroll_total',coalesce((select sum(amount) from private.crm_shift_payroll where shift_id=s.id),0),
  'payroll_complete',not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id
   left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=s.id and st.role='nurse' and w.shift_id is null)) order by s.shift_date desc,s.started_at desc),'[]') into shifts_n
 from public.shifts s where s.shift_date between first_day and last_day and(employee is null or exists(select 1 from public.shift_staff where shift_id=s.id and staff_id=employee));
 select not exists(select 1 from public.shifts where shift_date between first_day and last_day group by shift_date having count(*)<>2 or not bool_and(status='closed')) into complete_n;
 select exists(select 1 from public.shifts where shift_date between first_day and last_day and status='open') into has_open_n;
 return answer||jsonb_build_object('payroll_total',case when not entity_filter then wages_n end,'payroll_closed',case when not entity_filter then closed_wages end,
  'payroll_open',case when not entity_filter then open_wages end,'payroll_scope',case when entity_filter then 'not_applicable_to_entity_filter' when employee is null then 'all_period_shifts' else 'employee_period_shifts' end,
  'payroll_unknown',case when not entity_filter then unknown_n end,'payroll_complete',case when not entity_filter then unknown_n=0 end,
  'cash_after_salary',case when not entity_filter and unknown_n=0 then (answer->'revenue'->>'total')::numeric-wages_n end,'days_complete',complete_n,'has_open_shifts',has_open_n,'shifts',shifts_n);
end $$;

create or replace function private.crm_finance_v5(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; role_name text; sh uuid; staff_n uuid; wage numeric; old_n jsonb; new_n jsonb; answer jsonb; settings_n private.crm_finance_settings%rowtype; reason_n text; payroll_n numeric; unknown_n integer;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if jsonb_typeof(p_payload)<>'object' then raise exception 'Проверьте параметры';end if;
 if p_action='summary' then return private.crm_finance_summary_v5(p_payload);end if;
 if p_action in ('settings_get','settings_save') then
  if role_name='nurse' then raise exception 'Настройки доступны только владельцу';end if;
  select * into settings_n from private.crm_finance_settings where id for update;
  old_n:=to_jsonb(settings_n)-'updated_by'-'updated_at'-'id';
  if p_action='settings_save' then
   wage:=coalesce((p_payload->>'float_amount')::numeric,settings_n.float_amount);
   if wage<0 or wage<>round(wage,2) or wage::text in ('NaN','Infinity','-Infinity') or wage>999999999999.99 then raise exception 'Проверьте разменный фонд';end if;
   if coalesce(p_payload->>'time_zone',settings_n.time_zone)<>'Europe/Moscow' then raise exception 'Учёт смен и сроков годности ведётся по московскому времени';end if;
   update private.crm_finance_settings set float_amount=wage,time_zone=coalesce(p_payload->>'time_zone',time_zone),updated_by=auth.uid(),updated_at=now() where id returning * into settings_n;
   new_n:=to_jsonb(settings_n)-'updated_by'-'updated_at'-'id';
   insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,before_data,after_data)
   values(auth.uid(),actor,'finance_settings_changed','settings','finance',old_n,new_n);
  end if;
  return to_jsonb(settings_n)-'updated_by'-'updated_at'-'id';
 end if;
 if p_action not in ('shift_report','close','salary') or p_action is null then raise exception 'Неизвестная операция';end if;
 sh:=nullif(p_payload->>'shift_id','')::uuid;
 perform 1 from public.shifts where id=sh for update;
 if not found then raise exception 'Смена не найдена';end if;
 if role_name='nurse' and not exists(select 1 from public.shift_staff where shift_id=sh and staff_id=actor) then raise exception 'Нет доступа к смене';end if;
 if p_action='salary' then
  if role_name='nurse' then raise exception 'Зарплату изменяет только владелец';end if;
  staff_n:=(p_payload->>'staff_id')::uuid;wage:=(p_payload->>'amount')::numeric;reason_n:=nullif(trim(p_payload->>'reason'),'');
  if wage is null or wage<0 or wage<>round(wage,2) or wage::text in ('NaN','Infinity','-Infinity') or wage>999999999999.99 or reason_n is null then raise exception 'Укажите сумму зарплаты и причину изменения';end if;
  if not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=sh and ss.staff_id=staff_n and st.role='nurse') then raise exception 'Сотрудник не относится к смене';end if;
  select to_jsonb(w) into old_n from private.crm_shift_payroll w where shift_id=sh and staff_id=staff_n for update;
  insert into private.crm_shift_payroll(shift_id,staff_id,amount,reason,updated_by) values(sh,staff_n,wage,reason_n,auth.uid())
  on conflict(shift_id,staff_id) do update set amount=excluded.amount,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now() returning to_jsonb(crm_shift_payroll) into new_n;
  insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,before_data,after_data,reason)
  values(auth.uid(),actor,'salary_changed','shift_staff',sh::text||'/'||staff_n::text,old_n,new_n,reason_n);
  -- Keep stock and activity frozen; overlay explicitly audited payroll corrections only.
  select coalesce(sum(amount),0) into payroll_n from private.crm_shift_payroll where shift_id=sh;
  select count(*) into unknown_n from public.shift_staff ss join public.staff st on st.id=ss.staff_id
   left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=sh and st.role='nurse' and w.shift_id is null;
  update private.crm_shift_reports r set report=report||jsonb_build_object('staff',(select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=sh),
   'payroll_total',payroll_n,'payroll_unknown',unknown_n,'payroll_complete',unknown_n=0,'cash_after_salary',case when unknown_n=0 then (report->'revenue'->>'total')::numeric-payroll_n end) where shift_id=sh;
 elsif p_action='close' then
  if not exists(select 1 from private.crm_shift_reports where shift_id=sh) then
   update public.shifts set status='closed',ended_at=coalesce(ended_at,now()) where id=sh;
   answer:=private.crm_build_shift_report_v5(sh);
   insert into private.crm_shift_reports(shift_id,report,closed_by) values(sh,answer,auth.uid());
   insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,after_data)
   values(auth.uid(),actor,'shift_closed','shift',sh::text,jsonb_build_object('status','closed'));
  end if;
 end if;
 select report into answer from private.crm_shift_reports where shift_id=sh;
 if not found then answer:=private.crm_build_shift_report_v5(sh);end if;
 if role_name='nurse' then return private.crm_redact_finance_v5(answer);end if;
 return answer;
end $$;

create or replace function public.record_treatment_v5(p_kind text,p_payload jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.record_treatment_v5(p_kind,p_payload,p_request_id); $$;
create or replace function public.crm_finance_v5(p_action text,p_payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select private.crm_finance_v5(p_action,p_payload); $$;

-- Direct nurse reads of the old clinical tables disclosed paid totals across all shifts.
-- Mutations now use checked, atomic RPCs so stock and payments cannot be bypassed.
drop policy if exists nurse_procedures_select on public.procedures;
drop policy if exists nurse_procedures_insert_own on public.procedures;
drop policy if exists nurse_procedures_update_own on public.procedures;
drop policy if exists nurse_procedure_medications_select on public.procedure_medications;
drop policy if exists nurse_procedure_medications_insert on public.procedure_medications;
drop policy if exists nurse_procedure_medications_update on public.procedure_medications;
drop policy if exists nurse_sales_select on public.sales;
drop policy if exists nurse_sales_insert_own on public.sales;
drop policy if exists nurse_sales_update_own on public.sales;
drop policy if exists nurse_sale_items_select on public.sale_items;
drop policy if exists nurse_sale_items_insert on public.sale_items;
drop policy if exists nurse_sale_items_update on public.sale_items;
drop policy if exists nurse_shift_staff_insert on public.shift_staff;

-- Compatibility wrappers keep currently deployed clients operational with safe reports.
create or replace function public.shift_report_detailed_test(p_shift_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.crm_finance_v5('shift_report',jsonb_build_object('shift_id',p_shift_id)); $$;
create or replace function public.shift_report_v8(p_shift_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.crm_finance_v5('shift_report',jsonb_build_object('shift_id',p_shift_id)); $$;
create or replace function public.close_shift_v8(p_shift_id uuid)
returns void language plpgsql security invoker set search_path='' as $$ begin perform private.crm_finance_v5('close',jsonb_build_object('shift_id',p_shift_id));end $$;

create or replace function private.crm_patient_history_v5(p_patient uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; role_name text; answer jsonb;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if not exists(select 1 from public.patients where id=p_patient) then raise exception 'Пациент не найден';end if;
 select jsonb_build_object(
  'procedures',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'visit_at',p.visit_at,'procedure_type',p.procedure_type,'nurse',st.full_name,'notes',p.notes,'list_total',p.list_total,'discount_amount',p.discount_amount,'paid_total',p.paid_total,
   'medications',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'line_total',pm.line_total) order by m.name) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]')) order by p.visit_at desc,p.id)
   from public.procedures p left join public.staff st on st.id=p.nurse_id where p.patient_id=p_patient),'[]'),
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'sold_at',s.sold_at,'nurse',st.full_name,'notes',s.notes,'list_total',s.list_total,'discount_amount',s.discount_amount,'paid_total',s.paid_total,
   'items',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'line_total',si.line_total) order by m.name) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]')) order by s.sold_at desc,s.id)
   from public.sales s left join public.staff st on st.id=s.nurse_id where s.patient_id=p_patient),'[]')
 ) into answer;
 if role_name='nurse' then return private.crm_redact_finance_v5(answer);end if;
 return answer;
end $$;
create or replace function public.patient_history_v8(p_patient_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.crm_patient_history_v5(p_patient_id); $$;

-- Legacy treatment RPCs still enforce server prices and FEFO. Block nurse discounts
-- for every old entry point until clients move to the allocated v5 payment editor.
create or replace function private.crm_no_nurse_discount_v5()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.current_staff_role()='nurse' and (new.paid_total<>new.list_total or coalesce(new.discount_amount,0)<>0) then raise exception 'Скидку может назначить только владелец';end if;
 return new;
end $$;
drop trigger if exists crm_no_nurse_discount_v5 on public.procedures;
create trigger crm_no_nurse_discount_v5 before insert or update on public.procedures for each row execute function private.crm_no_nurse_discount_v5();
drop trigger if exists crm_no_nurse_discount_v5 on public.sales;
create trigger crm_no_nurse_discount_v5 before insert or update on public.sales for each row execute function private.crm_no_nurse_discount_v5();

-- Remove obsolete user-price clinical entry points, leaving v3 and service-based
-- compatibility RPCs available while the frontend release activates.
revoke execute on function public.save_procedure(uuid,uuid,uuid,text),public.save_procedure_v8(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text,text,jsonb),public.save_sale_v8(uuid,uuid,uuid,numeric,text,text,text,jsonb) from public,anon,authenticated;

revoke all on function private.crm_shift_slot_v5(),private.crm_shift_payroll_default_v5(),private.crm_redact_finance_v5(jsonb),private.crm_build_shift_report_v5(uuid),private.crm_no_nurse_discount_v5() from public,anon,authenticated;
revoke all on function private.record_treatment_v5(text,jsonb,uuid),private.crm_finance_summary_v5(jsonb),private.crm_finance_v5(text,jsonb),private.crm_patient_history_v5(uuid) from public,anon;
grant execute on function private.record_treatment_v5(text,jsonb,uuid),private.crm_finance_v5(text,jsonb),private.crm_patient_history_v5(uuid) to authenticated;
revoke all on function private.crm_finance_summary_v5(jsonb) from authenticated;
revoke all on function public.record_treatment_v5(text,jsonb,uuid),public.crm_finance_v5(text,jsonb),public.shift_report_detailed_test(uuid),public.shift_report_v8(uuid),public.close_shift_v8(uuid),public.patient_history_v8(uuid) from public,anon;
grant execute on function public.record_treatment_v5(text,jsonb,uuid),public.crm_finance_v5(text,jsonb),public.shift_report_detailed_test(uuid),public.shift_report_v8(uuid),public.close_shift_v8(uuid),public.patient_history_v8(uuid) to authenticated;

-- quick_ui_v4 context/favorites/repeat stay unchanged; report/close route through v5.
do $$ declare definition text;
begin
 select pg_get_functiondef('private.quick_ui_v4(text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'if p_action=''close'' then perform public.close_shift_v8(sh);end if;',
  'return private.crm_finance_v5(case when p_action=''close'' then ''close'' else ''shift_report'' end,p_payload);');
 execute definition;
end $$;
notify pgrst,'reload schema';

create or replace function private.warehouse_v5(p_action text,p_payload jsonb default '{}',p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; req private.warehouse_requests; med_id uuid:=nullif(p_payload->>'id','')::uuid;
 batch public.medication_batches; batch_id uuid; location_name text; actual numeric; delta numeric;
 old_n numeric; note text; before_ids uuid[]; received date;
begin
 if auth.uid() is null or not private.is_manager() then raise exception 'Доступно только владельцу';end if;
 if p_action='inventory' then
  if p_request_id is null then raise exception 'Нужен номер операции';end if;
  insert into private.warehouse_requests(id,staff_user,action,payload) values(p_request_id,auth.uid(),'v5_inventory',p_payload) on conflict do nothing;
  select * into req from private.warehouse_requests where id=p_request_id for update;
  if req.staff_user<>auth.uid() or req.action<>'v5_inventory' or req.payload<>p_payload then raise exception 'Номер операции уже используется';end if;
  if req.result is not null then return req.result;end if;
  perform 1 from public.medications where id=med_id and active for update;
  if not found then raise exception 'Препарат недоступен';end if;
  batch_id:=nullif(p_payload->>'batch_id','')::uuid; location_name:=p_payload->>'location';
  actual:=(p_payload->>'actual_quantity')::numeric; note:=nullif(trim(p_payload->>'reason'),'');
  if location_name is null or location_name not in ('reserve','work') or note is null then raise exception 'Укажите место хранения и причину инвентаризации';end if;
  if actual is null or actual<0 or actual<>trunc(actual) or actual::text in ('NaN','Infinity','-Infinity') then raise exception 'Фактический остаток: целое число от нуля';end if;
  select * into batch from public.medication_batches where id=batch_id and medication_id=med_id for update;
  if not found then raise exception 'Партия не найдена';end if;
  old_n:=case when location_name='work' then batch.work_quantity else batch.quantity_remaining-batch.work_quantity end;
  delta:=actual-old_n;
  if delta>0 and (batch.expiry_date is null or batch.expiry_date<(now() at time zone 'Europe/Moscow')::date) then raise exception 'Нельзя увеличивать годный остаток партии с истёкшим или неизвестным сроком';end if;
  if delta<>0 then
   update public.medication_batches set quantity_remaining=quantity_remaining+delta,
     quantity_received=quantity_received+greatest(delta,0),work_quantity=work_quantity+case when location_name='work' then delta else 0 end where id=batch_id;
   insert into public.stock(medication_id,location,quantity) values(med_id,location_name,greatest(delta,0))
     on conflict(medication_id,location) do update set quantity=public.stock.quantity+delta,updated_at=now();
   insert into public.stock_movements(medication_id,batch_id,movement_type,quantity,from_location,to_location,comment)
     values(med_id,batch_id,'correction',abs(delta),case when delta<0 then location_name end,case when delta>0 then location_name end,
      'Инвентаризация: '||old_n||' → '||actual||'. Причина: '||note);
  end if;
  v_result:=jsonb_build_object('id',med_id,'batch_id',batch_id,'before',old_n,'quantity',actual,'difference',delta);
  update private.warehouse_requests w set result=v_result where w.id=p_request_id;
  -- Qualify variable below to avoid ambiguity with the result column.
  return v_result;
 end if;
 if p_action in ('save','receive','opening') then
  if p_request_id is null then raise exception 'Нужен номер операции';end if;
  insert into private.warehouse_requests(id,staff_user,action,payload)
    values(p_request_id,auth.uid(),p_action,p_payload) on conflict do nothing;
  select * into req from private.warehouse_requests where id=p_request_id for update;
  if found then
   if req.staff_user<>auth.uid() or req.action<>p_action or req.payload<>p_payload then raise exception 'Номер операции уже используется';end if;
   if req.result is not null then return req.result;end if;
  end if;
 end if;
 if p_action in ('receive','opening') then
  perform 1 from public.medications where id=med_id for update;
  select coalesce(array_agg(id),array[]::uuid[]) into before_ids from public.medication_batches where medication_id=med_id;
  received:=coalesce(nullif(p_payload->>'received_date','')::date,(now() at time zone 'Europe/Moscow')::date);
  if received> (now() at time zone 'Europe/Moscow')::date or received<date '1900-01-01' then raise exception 'Проверьте дату поступления';end if;
 end if;
 v_result:=private.warehouse_v2(p_action,p_payload,p_request_id);
 if p_action='save' then
  update public.medications set manufacturer=nullif(trim(p_payload->>'manufacturer'),''),release_form=nullif(trim(p_payload->>'release_form'),''),comment=nullif(trim(p_payload->>'comment'),'')
   where id=(v_result->>'id')::uuid;
 elsif p_action in ('receive','opening') then
  update public.medication_batches set batch_number=nullif(trim(p_payload->>'batch_number'),''),supplier=nullif(trim(p_payload->>'supplier'),''),received_date=received
   where medication_id=med_id and not(id=any(before_ids)) returning id into batch_id;
  v_result:=v_result||jsonb_build_object('batch_id',batch_id);
  update private.warehouse_requests w set result=v_result where w.id=p_request_id;
 elsif p_action='list' then
  select coalesce(jsonb_agg(x.value||jsonb_build_object('manufacturer',m.manufacturer,'release_form',m.release_form,'comment',m.comment) order by m.name),'[]')
   into v_result from jsonb_array_elements(v_result) x join public.medications m on m.id=(x.value->>'id')::uuid;
 end if;
 return v_result;
end $$;
revoke all on function private.warehouse_v5(text,jsonb,uuid) from public,anon;
grant execute on function private.warehouse_v5(text,jsonb,uuid) to authenticated;
create or replace function public.warehouse_v5(p_action text,p_payload jsonb default '{}',p_request_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$select private.warehouse_v5(p_action,p_payload,p_request_id);$$;
revoke all on function public.warehouse_v5(text,jsonb,uuid) from public,anon;
grant execute on function public.warehouse_v5(text,jsonb,uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.work_catalog_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or coalesce(private.current_staff_role(),'') not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object(
  'id',m.id,'name',m.name,'manufacturer_country',m.manufacturer_country,'consumption_unit',m.consumption_unit,
  'manufacturer',m.manufacturer,'release_form',m.release_form,'sale_price',m.sale_price,'search_name',m.search_name,'generic_name',m.generic_name,'category',m.category,
  'dosage',m.dosage,'photo_path',m.photo_path,'work_qty',coalesce(b.qty,0),'nearest_expiry',b.expiry
 ) order by m.name),'[]') from public.medications m left join lateral(
  select sum(work_quantity) qty,min(expiry_date) expiry from public.medication_batches
  where medication_id=m.id and work_quantity>0 and expiry_date>=(now() at time zone 'Europe/Moscow')::date
 ) b on true where m.active);
end $function$
;

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
