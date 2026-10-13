-- Exact patient arrival timestamps are independent of money receipt timestamps.
-- No existing business records are backfilled or modified by installation.
begin;
set local lock_timeout='10s';

alter table public.patients add column if not exists first_visit_at timestamptz;
alter table public.procedures add column if not exists arrival_at timestamptz;
alter table public.sales add column if not exists arrival_at timestamptz;

comment on column public.patients.first_visit_at is 'Optional manually specified first patient visit time, independent of card creation.';
comment on column public.procedures.arrival_at is 'Optional patient arrival time; visit_at retains original record/payment event time.';
comment on column public.sales.arrival_at is 'Optional patient arrival time; sold_at retains original record/payment event time.';

-- ISO calendar and explicit offset validation avoids dependence on database/browser
-- local timezones, and rejects normalized invalid dates such as February 30 or 24:00.
create or replace function private.crm_visit_timestamp_v23(p_value text)
returns timestamptz language plpgsql stable security invoker set search_path='' as $$
declare value_n text:=nullif(trim(p_value),'');parts_n text[];result_n timestamptz;
begin
 if value_n is null then return null;end if;
 parts_n:=regexp_match(value_n,'^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(:([0-9]{2})(\.[0-9]{1,6})?)?(Z|([+-])([0-9]{2}):([0-9]{2}))$');
 if parts_n is null then
  raise exception 'Укажите точную дату и время посещения с часовым поясом' using errcode='22023';
 end if;
 if parts_n[1]::integer<1 or parts_n[4]::integer>23 or parts_n[5]::integer>59
  or coalesce(parts_n[7]::integer,0)>59 or coalesce(parts_n[11]::integer,0)>14
  or coalesce(parts_n[12]::integer,0)>59
  or (coalesce(parts_n[11]::integer,0)=14 and coalesce(parts_n[12]::integer,0)<>0) then
  raise exception 'Проверьте дату и время посещения: такого времени нет' using errcode='22023';
 end if;
 begin result_n:=value_n::timestamptz;
 exception when datetime_field_overflow or invalid_datetime_format then
  raise exception 'Проверьте дату и время посещения: такой даты нет' using errcode='22023';
 end;
 return result_n;
end $$;
revoke all on function private.crm_visit_timestamp_v23(text) from public,anon,authenticated;

-- Patient cards preserve all management role, audit, archive and service validation.
CREATE OR REPLACE FUNCTION private.crm_management_v5(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if p_action in ('patient_save','patient_archive') and entity_id is not null and exists(select 1 from public.patients where id=entity_id and deleted_at is not null) then raise exception 'Удалённый пациент недоступен для изменения';end if;
 case p_action
 when 'patient_list' then
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.full_name,p.id) from public.patients p
   where p.deleted_at is null and (not p.archived or (is_manager and coalesce((p_payload->>'include_archived')::boolean,false)))),'[]'::jsonb);
 when 'patient_save' then
  -- Exact first-visit time is optional; absent legacy fields preserve existing data.
  if p_payload?'first_visit_at' then perform private.crm_visit_timestamp_v23(p_payload->>'first_visit_at');end if;
  if entity_id is not null and not is_manager then raise exception 'Изменять пациентов может только владелец';end if;
  if entity_id is not null then
   select * into patient_row from public.patients where id=entity_id and deleted_at is null for update;
   if not found then raise exception 'Пациент не найден';end if;
   before_row:=to_jsonb(patient_row);
  end if;
  name_value:=case when p_payload?'full_name' then nullif(trim(p_payload->>'full_name'),'') else patient_row.full_name end;
  if name_value is null then raise exception 'Укажите имя пациента';end if;
  if p_payload?'sex' and nullif(p_payload->>'sex','') is not null and
   p_payload->>'sex' not in ('female','male','other','unknown') then raise exception 'Проверьте пол пациента';end if;
  if nullif(p_payload->>'birth_date','')::date>(now() at time zone 'Europe/Moscow')::date then raise exception 'Дата рождения не может быть в будущем';end if;
  if entity_id is null then
   insert into public.patients(full_name,birth_date,sex,phone,complaints,request,prescriptions,notes,first_visit_at)
   values(name_value,nullif(p_payload->>'birth_date','')::date,nullif(p_payload->>'sex',''),nullif(trim(p_payload->>'phone'),''),
    nullif(trim(p_payload->>'complaints'),''),nullif(trim(p_payload->>'request'),''),nullif(trim(p_payload->>'prescriptions'),''),nullif(trim(p_payload->>'notes'),''),private.crm_visit_timestamp_v23(p_payload->>'first_visit_at'))
   returning to_jsonb(patients.*) into result_row;
  else
   update public.patients set full_name=name_value,
    first_visit_at=case when p_payload?'first_visit_at' then private.crm_visit_timestamp_v23(p_payload->>'first_visit_at') else first_visit_at end,
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
  select to_jsonb(p) into before_row from public.patients p where id=entity_id and p.deleted_at is null for update;
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
end $function$;

-- Clinical display snapshots expose arrival time, while recorded_at retains the original creation time.
CREATE OR REPLACE FUNCTION private.crm_treatment_snapshot_v10(p_kind text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a jsonb;more_n numeric;
begin
 if p_kind='procedure' then
  select to_jsonb(p)||jsonb_build_object('kind','procedure','at',coalesce(p.arrival_at,p.visit_at),'visit_at',coalesce(p.arrival_at,p.visit_at),'recorded_at',coalesce((to_jsonb(p)->>'created_at')::timestamptz,p.visit_at),'patient',pt.full_name,'nurse',st.full_name,
   'services',coalesce((select jsonb_agg(jsonb_build_object('service_id',s.service_id,'name',s.name,'quantity',s.quantity,'work_price',s.work_price,'consumables_price',s.consumables_price,'line_total',round((s.work_price+s.consumables_price)*s.quantity,2)) order by s.position) from private.crm_treatment_services s where s.procedure_id=p.id),'[]'),
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'medication_id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'unit_price',pm.unit_price,'line_total',pm.line_total) order by m.name,m.id) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]'),
   'own_medications',coalesce((select jsonb_agg(jsonb_build_object('name',x.name,'quantity',x.quantity,'unit',x.unit,'source',x.source) order by x.position) from private.crm_own_medications x where x.procedure_id=p.id),'[]')) into a
   from public.procedures p join public.patients pt on pt.id=p.patient_id join public.staff st on st.id=p.nurse_id where p.id=p_id;
  select coalesce(sum(cash+terminal+owner_card),0) into more_n from private.crm_receipts_v10 where procedure_id=p_id and voided_at is null;
 elsif p_kind='sale' then
  select to_jsonb(s)||jsonb_build_object('kind','sale','at',coalesce(s.arrival_at,s.sold_at),'sold_at',coalesce(s.arrival_at,s.sold_at),'recorded_at',coalesce((to_jsonb(s)->>'created_at')::timestamptz,s.sold_at),'patient',coalesce(pt.full_name,'Без пациента'),'nurse',st.full_name,'services','[]'::jsonb,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'medication_id',m.id,'name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'unit_price',si.unit_price,'line_total',si.line_total) order by m.name,m.id) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]'),
   'own_medications','[]'::jsonb) into a from public.sales s left join public.patients pt on pt.id=s.patient_id join public.staff st on st.id=s.nurse_id where s.id=p_id;
  select coalesce(sum(cash+terminal+owner_card),0) into more_n from private.crm_receipts_v10 where sale_id=p_id and voided_at is null;
 else raise exception 'Неизвестная операция';end if;
 if a is null then raise exception 'Запись не найдена';end if;
 return a||jsonb_build_object('initial_paid_total',(a->>'paid_total')::numeric,'paid_total',(a->>'paid_total')::numeric+more_n,'received_total',(a->>'paid_total')::numeric+more_n,
  'debt_total',greatest((a->>'charge_total')::numeric-(a->>'paid_total')::numeric-more_n,0),
  'payment_pending',coalesce((a->>'payment_pending')::boolean,false) and (a->>'charge_total')::numeric>(a->>'paid_total')::numeric+more_n,'payment_only',not(a->>'stock_deducted')::boolean,
  'medications',a->'items','editable',private.is_manager() or(exists(select 1 from public.shifts sh join public.shift_staff ss on ss.shift_id=sh.id where sh.id=(a->>'shift_id')::uuid and sh.status='open' and ss.staff_id=private.crm_actor_staff_v10())));
end $function$;

-- Creation writes only the optional arrival column, preserving original receipt timestamps.
CREATE OR REPLACE FUNCTION private.crm_record_treatment_v10(p_kind text, p_payload jsonb, p_request_id uuid, p_allocated boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;role_n text;req private.warehouse_requests%rowtype;sh uuid;nurse uuid;patient uuid;data_n jsonb;pay jsonb;paid_n numeric;id_n uuid;stock_n boolean;reserve_n boolean;item jsonb;available_n numeric;missing_n numeric;answer jsonb;pending_n boolean;arrival_n timestamptz;
begin
 select id,role into actor,role_n from public.staff where active and auth_user_id=auth.uid() limit 1;
 if auth.uid() is null or actor is null or role_n not in ('owner','admin','nurse') then raise exception 'Нет доступа';end if;
 if p_kind is null or p_kind not in ('procedure','sale') or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Проверьте операцию';end if;
 insert into private.warehouse_requests(id,staff_user,action,payload) values(p_request_id,auth.uid(),'clinical_'||p_kind,p_payload) on conflict do nothing;
 select * into req from private.warehouse_requests where id=p_request_id for update;
 if req.staff_user<>auth.uid() or req.action<>'clinical_'||p_kind or req.payload<>p_payload then raise exception 'Номер операции уже использован';end if;
 if req.result is not null then return req.result;end if;
 arrival_n:=private.crm_visit_timestamp_v23(p_payload->>'arrival_at');
 sh:=(p_payload->>'shift_id')::uuid;nurse:=(p_payload->>'nurse_id')::uuid;patient:=nullif(p_payload->>'patient_id','')::uuid;reserve_n:=coalesce((p_payload->>'reserve_sale')::boolean,false);
 perform 1 from public.shifts where id=sh and status='open' for update;
 if not found then raise exception 'Смена закрыта или не выбрана';end if;
 if role_n='nurse' and not exists(select 1 from public.shift_staff where shift_id=sh and staff_id=actor) then raise exception 'Нет доступа к этой смене';end if;
 if not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=sh and ss.staff_id=nurse and st.active and st.role='nurse') then raise exception 'Выберите медсестру этой смены';end if;
 if p_kind='procedure' and patient is null then raise exception 'Выберите пациента';end if;
 if patient is not null then
  perform 1 from public.patients where id=patient and not archived and deleted_at is null for share;
  if not found then raise exception 'Пациент удалён или находится в архиве';end if;
 end if;
 if reserve_n and(p_kind<>'sale' or role_n='nurse') then raise exception 'Продажа из запаса доступна только владельцу';end if;
 select not payment_only into stock_n from private.crm_finance_settings where id for share;
 if not found then raise exception 'Настройки финансов не найдены';end if;
 if p_payload ? 'expected_stock_deducted' and(jsonb_typeof(p_payload->'expected_stock_deducted') is distinct from 'boolean' or(p_payload->>'expected_stock_deducted')::boolean is distinct from stock_n) then raise exception 'Режим учёта изменён. Обновите форму';end if;
 data_n:=private.crm_prepare_treatment_v10(p_kind,p_payload);
 if p_allocated then pay:=private.crm_validate_payment_v10(p_payload->'payments');paid_n:=(pay->>'total')::numeric;
 else paid_n:=coalesce((p_payload->>'paid_total')::numeric,(data_n->>'charge_total')::numeric);end if;
 if paid_n<0 or paid_n>(data_n->>'charge_total')::numeric or paid_n<>round(paid_n,2) or paid_n::text in ('NaN','Infinity','-Infinity') then raise exception 'Оплата превышает сумму к оплате';end if;
 if p_payload ? 'paid_total' and(p_payload->>'paid_total')::numeric<>paid_n then raise exception 'Сумма способов оплаты не совпадает с оплатой';end if;
 perform private.crm_validate_status_v10(p_payload->>'payment_status',(data_n->>'charge_total')::numeric,paid_n);
 pending_n:=coalesce(p_payload->>'payment_status'='pending',false);
 if paid_n<(data_n->>'charge_total')::numeric and patient is null then raise exception 'Для оплаты в долг выберите пациента';end if;
 if p_kind='procedure' then
  insert into public.procedures(patient_id,shift_id,nurse_id,service_id,procedure_type,work_price,consumables_price,list_total,charge_total,discount_amount,discount_percent,discount_reason,discount_comment,paid_total,notes,stock_deducted,payment_pending,arrival_at)
   values(patient,sh,nurse,(data_n->'services'->0->>'service_id')::uuid,data_n->'services'->0->>'name',(data_n->>'work_price')::numeric,(data_n->>'consumables_price')::numeric,(data_n->>'list_total')::numeric,(data_n->>'charge_total')::numeric,(data_n->>'discount_amount')::numeric,(data_n->>'discount_percent')::numeric,data_n->>'discount_reason',data_n->>'discount_comment',paid_n,p_payload->>'notes',stock_n,pending_n,arrival_n) returning id into id_n;
 else
  insert into public.sales(shift_id,nurse_id,patient_id,list_total,charge_total,discount_amount,discount_percent,discount_reason,discount_comment,paid_total,notes,stock_deducted,payment_pending,arrival_at)
   values(sh,nurse,patient,(data_n->>'list_total')::numeric,(data_n->>'charge_total')::numeric,(data_n->>'discount_amount')::numeric,(data_n->>'discount_percent')::numeric,data_n->>'discount_reason',data_n->>'discount_comment',paid_n,p_payload->>'notes',stock_n,pending_n,arrival_n) returning id into id_n;
 end if;
 perform private.crm_save_details_v10(p_kind,id_n,data_n);
 if stock_n then
  for item in select value from jsonb_array_elements(data_n->'items') loop
   if reserve_n then
    select coalesce(sum(work_quantity),0) into available_n from public.medication_batches where medication_id=(item->>'medication_id')::uuid and expiry_date>=(now() at time zone 'Europe/Moscow')::date;
    missing_n:=greatest((item->>'quantity')::numeric-available_n,0);
    if missing_n>0 then perform private.move_stock_v3((item->>'medication_id')::uuid,missing_n,'reserve','work','reserve_to_work','Перевод владельцем для продажи');end if;
   end if;
   perform private.move_stock_v3((item->>'medication_id')::uuid,(item->>'quantity')::numeric,'work',null,case when p_kind='procedure' then 'procedure_use' else 'sale' end,'Расход по процедуре или продаже',case when p_kind='procedure' then id_n end,case when p_kind='sale' then id_n end);
  end loop;
 end if;
 if p_allocated then
  insert into private.crm_payment_allocations(id,kind,procedure_id,sale_id,cash,terminal,owner_card,cash_received,change_amount,created_by) values(p_request_id,p_kind,case when p_kind='procedure' then id_n end,case when p_kind='sale' then id_n end,(pay->>'cash')::numeric,(pay->>'terminal')::numeric,(pay->>'owner_card')::numeric,(pay->>'cash_received')::numeric,(pay->>'change')::numeric,auth.uid());
 end if;
 answer:=private.crm_treatment_snapshot_v10(p_kind,id_n)||jsonb_build_object('payments',pay);
 update private.warehouse_requests set result=answer where id=p_request_id;
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,after_data) values(auth.uid(),actor,'treatment_recorded_v10',p_kind,id_n::text,answer);
 return answer;
end $function$;

-- Edits retain version, shift, stock, payment and comment-free awaiting-payment guards.
CREATE OR REPLACE FUNCTION private.crm_clinical_v10(p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;role_n text;kind_n text:=coalesce(p_payload->>'kind','procedure');id_n uuid;patient_n uuid;req private.warehouse_requests%rowtype;
 original jsonb;updated_n jsonb;data_n jsonb;pay jsonb;result_n jsonb;item record;old_q numeric;new_q numeric;sh uuid;pay_shift uuid;pay_nurse uuid;editable_n boolean;reason_n text;pending_n boolean;arrival_n timestamptz;
begin
 select id,role into actor,role_n from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_n not in ('owner','admin','nurse') then raise exception 'Нет доступа';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or p_action is null then raise exception 'Проверьте параметры';end if;
 if p_action='patient_treatments' then
  patient_n:=(p_payload->>'patient_id')::uuid;
  if not exists(select 1 from public.patients where id=patient_n and(deleted_at is null or private.is_manager())) then raise exception 'Пациент не найден';end if;
  return jsonb_build_object('procedures',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('procedure',p.id) order by coalesce(p.arrival_at,p.visit_at) desc,p.id) from public.procedures p where p.patient_id=patient_n),'[]'),
   'sales',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('sale',s.id) order by coalesce(s.arrival_at,s.sold_at) desc,s.id) from public.sales s where s.patient_id=patient_n),'[]'));
 elsif p_action='debts' then
  patient_n:=nullif(p_payload->>'patient_id','')::uuid;
  if role_n='nurse' and patient_n is null then raise exception 'Общий список долгов доступен только владельцу';end if;
  if patient_n is not null and not exists(select 1 from public.patients where id=patient_n and(deleted_at is null or private.is_manager())) then raise exception 'Пациент не найден';end if;
  select coalesce(jsonb_agg(x.a order by x.a->>'at',x.a->>'id'),'[]') into result_n from(
   select private.crm_treatment_snapshot_v10('procedure',p.id) a from public.procedures p where p.charge_total>p.paid_total and(patient_n is null or p.patient_id=patient_n)
   union all select private.crm_treatment_snapshot_v10('sale',s.id) from public.sales s where s.charge_total>s.paid_total and(patient_n is null or s.patient_id=patient_n)
  ) x where(x.a->>'debt_total')::numeric>0;
  return jsonb_build_object('debts',result_n,'debt_total',coalesce((select sum((a->>'debt_total')::numeric) from jsonb_array_elements(result_n) a),0));
 end if;
 if p_action not in ('treatment_get','treatment_edit','debt_payment') or kind_n not in ('procedure','sale') then raise exception 'Неизвестная операция';end if;
 id_n:=(p_payload->>'id')::uuid;original:=private.crm_treatment_snapshot_v10(kind_n,id_n);
 if role_n='nurse' and exists(select 1 from public.patients where id=nullif(original->>'patient_id','')::uuid and deleted_at is not null) then raise exception 'Пациент удалён. Обратитесь к владельцу';end if;
 if p_action='treatment_get' then return original;end if;
 if p_request_id is null then raise exception 'Нужен номер операции';end if;
 insert into private.warehouse_requests(id,staff_user,action,payload) values(p_request_id,auth.uid(),'clinical_v10_'||p_action,p_payload) on conflict do nothing;
 select * into req from private.warehouse_requests where id=p_request_id for update;
 if req.staff_user<>auth.uid() or req.action<>'clinical_v10_'||p_action or req.payload<>p_payload then raise exception 'Номер операции уже использован';end if;
 if req.result is not null then return req.result;end if;
 sh:=(original->>'shift_id')::uuid;
 if p_action='debt_payment' then pay_shift:=(p_payload->>'shift_id')::uuid;pay_nurse:=(p_payload->>'nurse_id')::uuid;
 else pay_shift:=coalesce(nullif(p_payload->>'payment_shift_id','')::uuid,sh);pay_nurse:=coalesce(nullif(p_payload->>'payment_nurse_id','')::uuid,(original->>'nurse_id')::uuid);end if;
 -- Consistent lock order prevents two corrections/receipts from spending the same balance.
 perform 1 from public.shifts where id in(sh,pay_shift) order by id for update;
 if kind_n='procedure' then perform 1 from public.procedures where id=id_n for update;
 else perform 1 from public.sales where id=id_n for update;end if;
 original:=private.crm_treatment_snapshot_v10(kind_n,id_n);
 pay:=private.crm_validate_payment_v10(coalesce(p_payload->'payments','{}'));
 if p_action='debt_payment' then
  if(original->>'patient_id') is null then raise exception 'Для оплаты долга нужен пациент';end if;
  if(pay->>'total')::numeric<=0 or(pay->>'total')::numeric>(original->>'debt_total')::numeric then raise exception 'Оплата должна быть больше нуля и не превышать остаток долга';end if;
  perform private.crm_add_receipt_v10(kind_n,id_n,pay_shift,pay_nurse,pay,p_request_id,p_payload->>'comment');
  -- Preserve pending during partial collection; clear it only when fully settled.
  pending_n:=coalesce((original->>'payment_pending')::boolean,false) and
   (original->>'charge_total')::numeric>(original->>'paid_total')::numeric+(pay->>'total')::numeric;
  if kind_n='procedure' then update public.procedures set version=version+1,payment_pending=pending_n where id=id_n;
  else update public.sales set version=version+1,payment_pending=pending_n where id=id_n;end if;
 else
  reason_n:=nullif(trim(p_payload->>'edit_reason'),'');
  -- Composition changes before any payment do not need a manual edit comment.
  -- The reason is still recorded in the audit; discounts retain their own validation.
  if reason_n is null and coalesce((original->>'payment_pending')::boolean,false)
   and coalesce((original->>'paid_total')::numeric,-1)=0 and (pay->>'total')::numeric=0
   and (p_payload->>'payment_status' is null or p_payload->>'payment_status'='pending')
   and not exists(select 1 from private.crm_receipts_v10 r
    where r.voided_at is null and ((kind_n='procedure' and r.procedure_id=id_n) or (kind_n='sale' and r.sale_id=id_n))) then
   reason_n:='Редактирование процедуры до оплаты';
  end if;
  if reason_n is null then raise exception 'Укажите, что изменили и почему';end if;
  editable_n:=(original->>'editable')::boolean;
  if not editable_n then raise exception 'Редактировать можно записи своей открытой смены. Другие записи исправляет владелец';end if;
  if nullif(p_payload->>'expected_version','') is null or(p_payload->>'expected_version')::integer<>(original->>'version')::integer then raise exception 'Запись уже изменена. Откройте её заново';end if;
  if jsonb_typeof(p_payload->'expected_stock_deducted') is distinct from 'boolean' or(p_payload->>'expected_stock_deducted')::boolean<>(original->>'stock_deducted')::boolean then raise exception 'Режим исходной процедуры не совпадает';end if;
  if(p_payload ? 'patient_id' and(p_payload->>'patient_id') is distinct from(original->>'patient_id')) or(p_payload ? 'shift_id' and(p_payload->>'shift_id') is distinct from(original->>'shift_id')) or(p_payload ? 'nurse_id' and(p_payload->>'nurse_id') is distinct from(original->>'nurse_id')) then raise exception 'Пациент, смена и медсестра исходной записи не меняются';end if;
  perform 1 from public.medications where id in(select(x->>'medication_id')::uuid from jsonb_array_elements(original->'items') x union select(x->>'medication_id')::uuid from jsonb_array_elements(coalesce(p_payload->'items','[]')) x) order by id for update;
  if p_payload?'arrival_at' then arrival_n:=private.crm_visit_timestamp_v23(p_payload->>'arrival_at');end if;
  data_n:=private.crm_prepare_treatment_v10(kind_n,p_payload,original);
  perform private.crm_validate_status_v10(p_payload->>'payment_status',(data_n->>'charge_total')::numeric,(original->>'paid_total')::numeric+(pay->>'total')::numeric);
  if(data_n->>'charge_total')::numeric<(original->>'paid_total')::numeric+(pay->>'total')::numeric then raise exception 'Новая сумма меньше уже полученной оплаты. Нужен отдельный возврат владельца';end if;
  if p_payload->>'payment_status'='pending' and nullif(original->>'patient_id','') is null then
   raise exception 'Для оплаты после процедуры выберите пациента';
  end if;
  -- Older clients omit payment_status: retain their existing pending state.
  pending_n:=case when p_payload->>'payment_status'='pending' then true
   when p_payload->>'payment_status' in ('paid','debt','free') then false
   else coalesce((original->>'payment_pending')::boolean,false) end;
  pending_n:=pending_n and (data_n->>'charge_total')::numeric>(original->>'paid_total')::numeric+(pay->>'total')::numeric;
  if(original->>'stock_deducted')::boolean then
   -- Lock the union of old/new medication IDs, then apply only quantity differences.
   for item in select id from(
    select(x->>'medication_id')::uuid id from jsonb_array_elements(original->'items') x
    union select(x->>'medication_id')::uuid from jsonb_array_elements(data_n->'items') x
   ) z order by id loop
    perform 1 from public.medications where id=item.id for update;
    select coalesce(sum((x->>'quantity')::numeric),0) into old_q from jsonb_array_elements(original->'items') x where(x->>'medication_id')::uuid=item.id;
    select coalesce(sum((x->>'quantity')::numeric),0) into new_q from jsonb_array_elements(data_n->'items') x where(x->>'medication_id')::uuid=item.id;
    if new_q>old_q then perform private.move_stock_v3(item.id,new_q-old_q,'work',null,case when kind_n='procedure' then 'procedure_use' else 'sale' end,'Дополнение процедуры или продажи',case when kind_n='procedure' then id_n end,case when kind_n='sale' then id_n end);
    elsif new_q<old_q then perform private.crm_return_consumed_v10(kind_n,id_n,item.id,old_q-new_q,p_request_id);end if;
   end loop;
  end if;
  if kind_n='procedure' then
   update public.procedures set service_id=(data_n->'services'->0->>'service_id')::uuid,procedure_type=data_n->'services'->0->>'name',work_price=(data_n->>'work_price')::numeric,consumables_price=(data_n->>'consumables_price')::numeric,
    list_total=(data_n->>'list_total')::numeric,charge_total=(data_n->>'charge_total')::numeric,discount_amount=(data_n->>'discount_amount')::numeric,discount_percent=(data_n->>'discount_percent')::numeric,
    discount_reason=data_n->>'discount_reason',discount_comment=data_n->>'discount_comment',notes=p_payload->>'notes',version=version+1,payment_pending=pending_n,
    arrival_at=case when p_payload?'arrival_at' then arrival_n else arrival_at end where id=id_n;
  else
   update public.sales set list_total=(data_n->>'list_total')::numeric,charge_total=(data_n->>'charge_total')::numeric,discount_amount=(data_n->>'discount_amount')::numeric,discount_percent=(data_n->>'discount_percent')::numeric,
    discount_reason=data_n->>'discount_reason',discount_comment=data_n->>'discount_comment',notes=p_payload->>'notes',version=version+1,payment_pending=pending_n,
    arrival_at=case when p_payload?'arrival_at' then arrival_n else arrival_at end where id=id_n;
  end if;
  perform private.crm_save_details_v10(kind_n,id_n,data_n);
  if(pay->>'total')::numeric>0 then perform private.crm_add_receipt_v10(kind_n,id_n,pay_shift,pay_nurse,pay,p_request_id,p_payload->>'payment_comment');end if;
 end if;
 updated_n:=private.crm_treatment_snapshot_v10(kind_n,id_n)||jsonb_build_object('payments',pay);
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,before_data,after_data,reason)
  values(auth.uid(),actor,p_action||'_v10',kind_n,id_n::text,original,updated_n,coalesce(reason_n,p_payload->>'payment_comment',p_payload->>'comment',p_payload->>'discount_comment'));
 perform private.crm_refresh_closed_report_v10(sh);
 update private.warehouse_requests set result=updated_n where id=p_request_id;
 return updated_n;
end $function$;

-- Shift journals and printed reports use arrival ordering; receipts keep collection times.
CREATE OR REPLACE FUNCTION private.crm_build_shift_report_v5(p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a jsonb:=private.crm_build_shift_report_legacy_v9(p_shift);receipts_n jsonb;r jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'procedure_id',x.procedure_id,'sale_id',x.sale_id,'patient_id',coalesce(p.patient_id,s.patient_id),'patient',pt.full_name,'at',x.created_at,'nurse',st.full_name,
  'paid_total',x.cash+x.terminal+x.owner_card,'comment',x.comment,'payments',jsonb_build_object('cash',x.cash,'terminal',x.terminal,'owner_card',x.owner_card,'cash_received',x.cash_received,'change',x.change_amount)) order by x.created_at,x.id),'[]') into receipts_n
  from private.crm_receipts_v10 x left join public.procedures p on p.id=x.procedure_id left join public.sales s on s.id=x.sale_id left join public.patients pt on pt.id=coalesce(p.patient_id,s.patient_id) join public.staff st on st.id=x.nurse_id where x.shift_id=p_shift and x.voided_at is null;
 select jsonb_build_object('cash',coalesce(sum(cash),0),'terminal',coalesce(sum(terminal),0),'owner_card',coalesce(sum(owner_card),0),'total',coalesce(sum(cash+terminal+owner_card),0)) into r from private.crm_receipts_v10 where shift_id=p_shift and voided_at is null;
 return a||jsonb_build_object('procedures',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('procedure',p.id)||jsonb_build_object('paid_total',p.paid_total) order by coalesce(p.arrival_at,p.visit_at),p.id) from public.procedures p where p.shift_id=p_shift),'[]'),
  'sales',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('sale',s.id)||jsonb_build_object('paid_total',s.paid_total) order by coalesce(s.arrival_at,s.sold_at),s.id) from public.sales s where s.shift_id=p_shift),'[]'),
  'receipts',receipts_n,'debt_receipts_total',(r->>'total')::numeric,
  'cash_total',(a->'revenue'->>'total')::numeric+(r->>'total')::numeric,
  'charge_total',coalesce((select sum(charge_total) from public.procedures where shift_id=p_shift),0)+coalesce((select sum(charge_total) from public.sales where shift_id=p_shift),0),
  'debt_created_total',coalesce((select sum(charge_total-paid_total) from public.procedures where shift_id=p_shift),0)+coalesce((select sum(charge_total-paid_total) from public.sales where shift_id=p_shift),0),
  'debt_total',coalesce((select sum((private.crm_treatment_snapshot_v10('procedure',id)->>'debt_total')::numeric) from public.procedures where shift_id=p_shift),0)+coalesce((select sum((private.crm_treatment_snapshot_v10('sale',id)->>'debt_total')::numeric) from public.sales where shift_id=p_shift),0),
  'revenue',(a->'revenue')||jsonb_build_object('cash',(a->'revenue'->>'cash')::numeric+(r->>'cash')::numeric,'terminal',(a->'revenue'->>'terminal')::numeric+(r->>'terminal')::numeric,'owner_card',(a->'revenue'->>'owner_card')::numeric+(r->>'owner_card')::numeric,'total',(a->'revenue'->>'total')::numeric+(r->>'total')::numeric),
  'cash_after_salary',case when(a->>'payroll_complete')::boolean then(a->'revenue'->>'total')::numeric+(r->>'total')::numeric-(a->>'payroll_total')::numeric end);
end $function$;

-- Legacy compact patient history uses the same arrival time as full clinical history.
CREATE OR REPLACE FUNCTION private.crm_patient_history_v5(p_patient uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; role_name text; answer jsonb;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if not exists(select 1 from public.patients where id=p_patient and (deleted_at is null or role_name in ('owner','admin'))) then raise exception 'Пациент не найден';end if;
 select jsonb_build_object(
  'procedures',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'visit_at',coalesce(p.arrival_at,p.visit_at),'at',coalesce(p.arrival_at,p.visit_at),'arrival_at',p.arrival_at,'recorded_at',coalesce((to_jsonb(p)->>'created_at')::timestamptz,p.visit_at),'procedure_type',p.procedure_type,'nurse',st.full_name,'notes',p.notes,'list_total',p.list_total,'discount_amount',p.discount_amount,'paid_total',p.paid_total,'stock_deducted',p.stock_deducted,
   'medications',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'line_total',pm.line_total) order by m.name) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]')) order by coalesce(p.arrival_at,p.visit_at) desc,p.id)
   from public.procedures p left join public.staff st on st.id=p.nurse_id where p.patient_id=p_patient),'[]'),
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'sold_at',coalesce(s.arrival_at,s.sold_at),'at',coalesce(s.arrival_at,s.sold_at),'arrival_at',s.arrival_at,'recorded_at',coalesce((to_jsonb(s)->>'created_at')::timestamptz,s.sold_at),'nurse',st.full_name,'notes',s.notes,'list_total',s.list_total,'discount_amount',s.discount_amount,'paid_total',s.paid_total,'stock_deducted',s.stock_deducted,
   'items',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'line_total',si.line_total) order by m.name) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]')) order by coalesce(s.arrival_at,s.sold_at) desc,s.id)
   from public.sales s left join public.staff st on st.id=s.nurse_id where s.patient_id=p_patient),'[]')
 ) into answer;
 if role_name='nurse' then return private.crm_redact_finance_v5(answer);end if;
 return answer;
end $function$;

-- CREATE OR REPLACE preserves current execution privileges on all replaced APIs.
-- The new validator remains private and is invoked through already authorized functions.
-- Financial-period aggregation and v22 payment correction APIs are intentionally unchanged.
notify pgrst,'reload schema';
commit;
