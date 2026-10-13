-- v24: shared procedure templates, separate clinical doses and patient-specific prices.
-- Existing production function definitions are retained except for the changes below.
-- Clinical wrappers, stock handling, payroll and v23 visit timestamps remain unchanged.
begin;

alter table public.procedure_medications add column if not exists dose text;
alter table public.sale_items add column if not exists dose text;
alter table private.crm_own_medications add column if not exists dose text;

do $migration$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.procedure_medications'::regclass and conname='procedure_medications_dose_length_v24') then
  alter table public.procedure_medications add constraint procedure_medications_dose_length_v24 check(dose is null or char_length(dose)<=200);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.sale_items'::regclass and conname='sale_items_dose_length_v24') then
  alter table public.sale_items add constraint sale_items_dose_length_v24 check(dose is null or char_length(dose)<=200);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='private.crm_own_medications'::regclass and conname='crm_own_medications_dose_length_v24') then
  alter table private.crm_own_medications add constraint crm_own_medications_dose_length_v24 check(dose is null or char_length(dose)<=200);
 end if;
end $migration$;

comment on column public.procedure_medications.dose is 'Clinical dose text; independent of billed whole quantity and catalog dosage.';
comment on column public.sale_items.dose is 'Clinical dose text; independent of billed whole quantity and catalog dosage.';
comment on column private.crm_own_medications.dose is 'Clinical dose text; independent of the whole quantity supplied by the patient.';

create or replace function private.crm_normalize_dose_v24(p_dose jsonb)
 returns text
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare dose_n text;
begin
 if p_dose is null or p_dose='null'::jsonb then return null;end if;
 if jsonb_typeof(p_dose)<>'string' then raise exception 'Доза должна быть строкой или пустым значением';end if;
 dose_n:=p_dose #>> '{}';
 if char_length(dose_n)>200 then raise exception 'Доза должна быть не длиннее 200 символов';end if;
 return nullif(trim(dose_n),'');
end $function$;
revoke all on function private.crm_normalize_dose_v24(jsonb) from public,anon,authenticated,service_role;

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
 canonical_items jsonb:='[]'::jsonb;email_value text;name_value text;new_role text;dose_value text;original_item jsonb;
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
 if p_action in ('patient_archive','service_save','staff_list','staff_save','audit_list','backup_export')
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
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.name,t.id) from private.crm_procedure_templates t),'[]'::jsonb);
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
   if item?'dose' then dose_value:=private.crm_normalize_dose_v24(item->'dose');
   else
    select value into original_item from jsonb_array_elements(coalesce(template_row.items,'[]'::jsonb))
     where (value->>'medication_id')::uuid=item_med limit 1;
    dose_value:=private.crm_normalize_dose_v24(original_item->'dose');
   end if;
   canonical_items:=canonical_items||jsonb_build_array(jsonb_build_object('medication_id',item_med,'quantity',qty,'dose',dose_value));
  end loop;
  if exists(select 1 from jsonb_array_elements(canonical_items) i
   group by (i->>'medication_id')::uuid having count(distinct i->'dose')>1) then
   raise exception 'Укажите одну дозу для повторяющегося препарата';end if;
  select coalesce(jsonb_agg(jsonb_build_object('medication_id',med,'quantity',quantity,'dose',dose) order by med),'[]'::jsonb)
   into canonical_items from (select (i->>'medication_id')::uuid med,sum((i->>'quantity')::numeric) quantity,i->'dose' dose
    from jsonb_array_elements(canonical_items) i group by (i->>'medication_id')::uuid,i->'dose') grouped;
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

CREATE OR REPLACE FUNCTION private.crm_prepare_treatment_v10(p_kind text, p_payload jsonb, p_original jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare items jsonb:=coalesce(p_payload->'items','[]');services jsonb;own_n jsonb:=coalesce(p_payload->'own_medications','[]');
 i jsonb;m public.medications%rowtype;s public.procedure_services%rowtype;old_n jsonb;
 normalized_items jsonb:='[]';result_own jsonb:='[]';dose_n text;
 result_items jsonb:='[]';result_services jsonb:='[]';q numeric;price_n numeric;list_n numeric:=0;work_n numeric:=0;consumables_n numeric:=0;charge_n numeric;reason_n text;comment_n text;
begin
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>200 then raise exception 'Проверьте список препаратов';end if;
 for i in select value from jsonb_array_elements(items) loop
  q:=(i->>'quantity')::numeric;
  if nullif(i->>'medication_id','') is null or q is null or q<=0 or q<>trunc(q) or q>1000000 or q::text in ('NaN','Infinity','-Infinity') then raise exception 'Укажите целое количество препарата';end if;
  if i?'dose' then dose_n:=private.crm_normalize_dose_v24(i->'dose');
  else
   select value into old_n from jsonb_array_elements(coalesce(p_original->'items','[]'))
    where (value->>'medication_id')::uuid=(i->>'medication_id')::uuid limit 1;
   dose_n:=private.crm_normalize_dose_v24(old_n->'dose');
  end if;
  normalized_items:=normalized_items||jsonb_build_array(jsonb_build_object('medication_id',(i->>'medication_id')::uuid,'quantity',q,'dose',dose_n));
 end loop;
 if exists(select 1 from jsonb_array_elements(normalized_items) x
  group by (x->>'medication_id')::uuid having count(distinct x->'dose')>1) then
  raise exception 'Укажите одну дозу для повторяющегося препарата';end if;
 select coalesce(jsonb_agg(jsonb_build_object('medication_id',z.id,'quantity',z.q,'dose',z.dose) order by z.id),'[]') into items
  from(select (x->>'medication_id')::uuid id,sum((x->>'quantity')::numeric) q,x->'dose' dose
   from jsonb_array_elements(normalized_items) x group by (x->>'medication_id')::uuid,x->'dose') z;
 if p_kind='sale' and jsonb_array_length(items)=0 then raise exception 'Добавьте препарат';end if;
 for i in select value from jsonb_array_elements(items) loop
  select * into m from public.medications where id=(i->>'medication_id')::uuid for update;
  if not found then raise exception 'Препарат не найден';end if;
  select value into old_n from jsonb_array_elements(coalesce(p_original->'items','[]')) where value->>'medication_id'=m.id::text limit 1;
  if not m.active and(old_n is null or(i->>'quantity')::numeric>(old_n->>'quantity')::numeric) then raise exception 'Архивный препарат можно только оставить или уменьшить в исходной записи';end if;
  if old_n is null then
   if not m.active or m.sale_price is null or m.sale_price<=0 or m.sale_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Укажите действующий препарат с ценой';end if;
   price_n:=m.sale_price;
  else price_n:=(old_n->>'unit_price')::numeric;end if;
  q:=(i->>'quantity')::numeric;list_n:=list_n+round(price_n*q,2);
  result_items:=result_items||jsonb_build_array(i||jsonb_build_object('unit_price',price_n,'line_total',round(price_n*q,2)));
 end loop;
 if p_kind='procedure' then
  services:=coalesce(p_payload->'services',jsonb_build_array(jsonb_build_object('service_id',p_payload->>'service_id','quantity',1)));
  if jsonb_typeof(services)<>'array' or jsonb_array_length(services) not between 1 and 100 then raise exception 'Добавьте услугу';end if;
  if exists(select 1 from jsonb_array_elements(services) x group by x->>'service_id' having count(*)>1) then raise exception 'Объедините повторяющиеся услуги';end if;
  for i in select value from jsonb_array_elements(services) loop
   q:=coalesce((i->>'quantity')::numeric,1);
   if nullif(i->>'service_id','') is null or q<=0 or q<>trunc(q) or q>1000 or q::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте услугу и количество';end if;
   select value into old_n from jsonb_array_elements(coalesce(p_original->'services','[]')) where value->>'service_id'=i->>'service_id' limit 1;
   if old_n is null then
    select * into s from public.procedure_services where id=(i->>'service_id')::uuid and active for share;
    if not found then raise exception 'Выберите действующую услугу';end if;
    old_n:=jsonb_build_object('service_id',s.id,'name',s.name,'work_price',s.work_price,'consumables_price',s.consumables_price);
   end if;
   if(old_n->>'work_price')::numeric<0 or(old_n->>'consumables_price')::numeric<0 or(old_n->>'work_price')::numeric::text in ('NaN','Infinity','-Infinity') or(old_n->>'consumables_price')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте цены услуги';end if;
   work_n:=work_n+(old_n->>'work_price')::numeric*q;consumables_n:=consumables_n+(old_n->>'consumables_price')::numeric*q;
   result_services:=result_services||jsonb_build_array(old_n||jsonb_build_object('quantity',q));
  end loop;
 end if;
 if jsonb_typeof(own_n)<>'array' or jsonb_array_length(own_n)>200 or(p_kind='sale' and jsonb_array_length(own_n)>0) then raise exception 'Проверьте препараты пациента';end if;
 for i in select value from jsonb_array_elements(own_n) loop
  q:=(i->>'quantity')::numeric;
  if coalesce(length(trim(i->>'name')),0) not between 1 and 500 or q is null or q<=0 or q<>trunc(q) or q>1000000 or q::text in ('NaN','Infinity','-Infinity') or coalesce(i->>'source','patient') not in ('patient','previously_purchased') or coalesce(length(i->>'unit'),0)>100 then raise exception 'Укажите название и целое количество препарата пациента';end if;
  if i?'dose' then dose_n:=private.crm_normalize_dose_v24(i->'dose');
  else
   -- Own rows have no stable input ID: inherit only an unambiguous identity dose.
   if (select count(distinct coalesce(to_jsonb(private.crm_normalize_dose_v24(x.value->'dose')),'null'::jsonb))
    from jsonb_array_elements(coalesce(p_original->'own_medications','[]')) x(value)
    where trim(x.value->>'name')=trim(i->>'name')
     and coalesce(x.value->>'source','patient')=coalesce(i->>'source','patient')
     and coalesce(nullif(trim(x.value->>'unit'),''),'амп.')=coalesce(nullif(trim(i->>'unit'),''),'амп.'))>1 then
    raise exception 'Укажите дозу для повторяющегося препарата пациента';end if;
   select x.value into old_n from jsonb_array_elements(coalesce(p_original->'own_medications','[]')) x(value)
    where trim(x.value->>'name')=trim(i->>'name')
     and coalesce(x.value->>'source','patient')=coalesce(i->>'source','patient')
     and coalesce(nullif(trim(x.value->>'unit'),''),'амп.')=coalesce(nullif(trim(i->>'unit'),''),'амп.')
    limit 1;
   dose_n:=private.crm_normalize_dose_v24(old_n->'dose');
  end if;
  result_own:=result_own||jsonb_build_array(i||jsonb_build_object('dose',dose_n));
 end loop;
 own_n:=result_own;
 list_n:=round(list_n+work_n+consumables_n,2);
 if p_payload ? 'charge_total' then charge_n:=(p_payload->>'charge_total')::numeric;
 elsif p_original is not null then charge_n:=list_n-((p_original->>'list_total')::numeric-(p_original->>'charge_total')::numeric);
 elsif p_payload ? 'paid_total' then charge_n:=(p_payload->>'paid_total')::numeric;
 else charge_n:=list_n;end if;
 if charge_n is null or charge_n<0 or charge_n<>round(charge_n,2) or charge_n::text in ('NaN','Infinity','-Infinity') then raise exception 'Сумма к оплате должна быть неотрицательной с точностью до копеек';end if;
 reason_n:=nullif(trim(p_payload->>'discount_reason'),'');comment_n:=nullif(trim(p_payload->>'discount_comment'),'');
 if charge_n<>list_n or p_payload->>'payment_status'='free' then
  if reason_n is null or comment_n is null then raise exception 'Укажите причину и обязательный комментарий к изменению цены или бесплатной процедуре';end if;
 else reason_n:=null;comment_n:=null;end if;
 return jsonb_build_object('items',result_items,'services',result_services,'own_medications',own_n,'list_total',list_n,'charge_total',charge_n,'work_price',work_n,'consumables_price',consumables_n,
  'discount_amount',greatest(list_n-charge_n,0),'discount_percent',case when list_n>0 then greatest(round((list_n-charge_n)*100/list_n,2),0) else 0 end,'discount_reason',reason_n,'discount_comment',comment_n);
end $function$;

CREATE OR REPLACE FUNCTION private.crm_save_details_v10(p_kind text, p_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare i jsonb;pos integer:=0;
begin
 if p_kind='procedure' then
  delete from public.procedure_medications where procedure_id=p_id;
  delete from private.crm_treatment_services where procedure_id=p_id;
  delete from private.crm_own_medications where procedure_id=p_id;
  for i in select value from jsonb_array_elements(p_data->'items') loop
   insert into public.procedure_medications(procedure_id,medication_id,quantity,unit_price,line_total,dose) values(p_id,(i->>'medication_id')::uuid,(i->>'quantity')::numeric,(i->>'unit_price')::numeric,(i->>'line_total')::numeric,i->>'dose');
  end loop;
  for i in select value from jsonb_array_elements(p_data->'services') loop
   insert into private.crm_treatment_services(procedure_id,position,service_id,name,quantity,work_price,consumables_price) values(p_id,pos,(i->>'service_id')::uuid,i->>'name',(i->>'quantity')::numeric,(i->>'work_price')::numeric,(i->>'consumables_price')::numeric);pos:=pos+1;
  end loop;pos:=0;
  for i in select value from jsonb_array_elements(p_data->'own_medications') loop
   insert into private.crm_own_medications(kind,procedure_id,position,name,quantity,unit,source,dose) values(p_kind,p_id,pos,trim(i->>'name'),(i->>'quantity')::numeric,coalesce(nullif(trim(i->>'unit'),''),'амп.'),coalesce(i->>'source','patient'),i->>'dose');pos:=pos+1;
  end loop;
 else
  delete from public.sale_items where sale_id=p_id;
  for i in select value from jsonb_array_elements(p_data->'items') loop
   insert into public.sale_items(sale_id,medication_id,quantity,unit_price,line_total,dose) values(p_id,(i->>'medication_id')::uuid,(i->>'quantity')::numeric,(i->>'unit_price')::numeric,(i->>'line_total')::numeric,i->>'dose');
  end loop;
 end if;
end $function$;

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
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'medication_id',m.id,'name',m.name,'quantity',pm.quantity,'dose',pm.dose,'unit',m.consumption_unit,'unit_price',pm.unit_price,'line_total',pm.line_total) order by m.name,m.id) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]'),
   'own_medications',coalesce((select jsonb_agg(jsonb_build_object('name',x.name,'quantity',x.quantity,'dose',x.dose,'unit',x.unit,'source',x.source) order by x.position) from private.crm_own_medications x where x.procedure_id=p.id),'[]')) into a
   from public.procedures p join public.patients pt on pt.id=p.patient_id join public.staff st on st.id=p.nurse_id where p.id=p_id;
  select coalesce(sum(cash+terminal+owner_card),0) into more_n from private.crm_receipts_v10 where procedure_id=p_id and voided_at is null;
 elsif p_kind='sale' then
  select to_jsonb(s)||jsonb_build_object('kind','sale','at',coalesce(s.arrival_at,s.sold_at),'sold_at',coalesce(s.arrival_at,s.sold_at),'recorded_at',coalesce((to_jsonb(s)->>'created_at')::timestamptz,s.sold_at),'patient',coalesce(pt.full_name,'Без пациента'),'nurse',st.full_name,'services','[]'::jsonb,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'medication_id',m.id,'name',m.name,'quantity',si.quantity,'dose',si.dose,'unit',m.consumption_unit,'unit_price',si.unit_price,'line_total',si.line_total) order by m.name,m.id) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]'),
   'own_medications','[]'::jsonb) into a from public.sales s left join public.patients pt on pt.id=s.patient_id join public.staff st on st.id=s.nurse_id where s.id=p_id;
  select coalesce(sum(cash+terminal+owner_card),0) into more_n from private.crm_receipts_v10 where sale_id=p_id and voided_at is null;
 else raise exception 'Неизвестная операция';end if;
 if a is null then raise exception 'Запись не найдена';end if;
 return a||jsonb_build_object('initial_paid_total',(a->>'paid_total')::numeric,'paid_total',(a->>'paid_total')::numeric+more_n,'received_total',(a->>'paid_total')::numeric+more_n,
  'debt_total',greatest((a->>'charge_total')::numeric-(a->>'paid_total')::numeric-more_n,0),
  'payment_pending',coalesce((a->>'payment_pending')::boolean,false) and (a->>'charge_total')::numeric>(a->>'paid_total')::numeric+more_n,'payment_only',not(a->>'stock_deducted')::boolean,
  'medications',a->'items','editable',private.is_manager() or(exists(select 1 from public.shifts sh join public.shift_staff ss on ss.shift_id=sh.id where sh.id=(a->>'shift_id')::uuid and sh.status='open' and ss.staff_id=private.crm_actor_staff_v10())));
end $function$;

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
   'medications',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',pm.quantity,'dose',pm.dose,'unit',m.consumption_unit,'line_total',pm.line_total) order by m.name) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]')) order by coalesce(p.arrival_at,p.visit_at) desc,p.id)
   from public.procedures p left join public.staff st on st.id=p.nurse_id where p.patient_id=p_patient),'[]'),
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'sold_at',coalesce(s.arrival_at,s.sold_at),'at',coalesce(s.arrival_at,s.sold_at),'arrival_at',s.arrival_at,'recorded_at',coalesce((to_jsonb(s)->>'created_at')::timestamptz,s.sold_at),'nurse',st.full_name,'notes',s.notes,'list_total',s.list_total,'discount_amount',s.discount_amount,'paid_total',s.paid_total,'stock_deducted',s.stock_deducted,
   'items',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',si.quantity,'dose',si.dose,'unit',m.consumption_unit,'line_total',si.line_total) order by m.name) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]')) order by coalesce(s.arrival_at,s.sold_at) desc,s.id)
   from public.sales s left join public.staff st on st.id=s.nurse_id where s.patient_id=p_patient),'[]')
 ) into answer;
 if role_name='nurse' then return private.crm_redact_finance_v5(answer);end if;
 return answer;
end $function$;

CREATE OR REPLACE FUNCTION private.crm_no_nurse_discount_v5()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.charge_total is null then new.charge_total:=new.paid_total;end if;
 if new.charge_total<0 or new.charge_total::text in ('NaN','Infinity','-Infinity') or new.paid_total is null or new.paid_total<0 or new.paid_total::text in ('NaN','Infinity','-Infinity') or new.paid_total>new.charge_total then raise exception 'Проверьте сумму и оплату';end if;
 new.discount_amount:=greatest(new.discount_amount,0);new.discount_percent:=greatest(new.discount_percent,0);
 if new.charge_total<>new.list_total and(nullif(trim(new.discount_reason),'') is null or nullif(trim(new.discount_comment),'') is null) then raise exception 'Укажите причину и обязательный комментарий к изменению цены';end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION private.crm_save_recovery_v16(p_rpc text, p_args jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  allowed_keys:=array['p_action','p_payload'];manager_only:=action_name<>'template_save';
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
end $function$;

CREATE OR REPLACE FUNCTION private.quick_ui_v4(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; role_name text; med uuid; sh uuid; pr public.procedures%rowtype; result jsonb;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if p_action='favorite' then
  med:=(p_payload->>'id')::uuid;
  if not exists(select 1 from public.medications where id=med and active) then raise exception 'Препарат не найден';end if;
  if coalesce((p_payload->>'selected')::boolean,false) then
   insert into private.medication_favorites values(auth.uid(),med) on conflict do nothing;
  else delete from private.medication_favorites where staff_user=auth.uid() and medication_id=med;end if;
  return jsonb_build_object('id',med,'selected',coalesce((p_payload->>'selected')::boolean,false));
 elsif p_action='context' then
  return jsonb_build_object(
   'favorites',coalesce((select jsonb_agg(medication_id) from private.medication_favorites where staff_user=auth.uid()),'[]'),
   'recent',coalesce((select jsonb_agg(jsonb_build_object('id',medication_id,'count',uses,'at',last_at) order by uses desc,last_at desc)
    from (select medication_id,count(*) uses,max(at) last_at from(
     select pm.medication_id,p.visit_at at from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id
      where p.visit_at>now()-interval '30 days'
     union all select si.medication_id,s.sold_at from public.sale_items si join public.sales s on s.id=si.sale_id
      where s.sold_at>now()-interval '30 days'
    ) e group by medication_id order by uses desc,last_at desc limit 30) ranked),'[]'),
   'shifts',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'started_at',s.started_at,'planned_end_at',s.planned_end_at,
    'staff',(select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name)) from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=s.id)) order by s.started_at desc)
    from public.shifts s where s.status='open' and (role_name in ('admin','owner') or exists(select 1 from public.shift_staff ss where ss.shift_id=s.id and ss.staff_id=actor))),'[]'));
 elsif p_action='last_procedure' then
  if not exists(select 1 from public.patients where id=(p_payload->>'patient_id')::uuid and (deleted_at is null or role_name in ('owner','admin'))) then raise exception 'Удалённый пациент недоступен';end if;
  select * into pr from public.procedures where patient_id=(p_payload->>'patient_id')::uuid order by visit_at desc,id desc limit 1;
  if not found then return null;end if;
  return jsonb_build_object('id',pr.id,'patient_id',pr.patient_id,'at',pr.visit_at,'service_name',pr.procedure_type,
   'service_id',coalesce(pr.service_id,(select (array_agg(id))[1] from public.procedure_services where name=pr.procedure_type and active having count(*)=1)),
   'items',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',pm.quantity,'dose',pm.dose,'unit',m.consumption_unit,'active',m.active) order by m.name)
    from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=pr.id),'[]'));
 elsif p_action in ('report','close') then
  sh:=(p_payload->>'shift_id')::uuid;
  if sh is null or not exists(select 1 from public.shifts where id=sh) then raise exception 'Смена не найдена';end if;
  if role_name not in ('admin','owner') and not exists(select 1 from public.shift_staff where shift_id=sh and staff_id=actor) then raise exception 'Нет доступа к смене';end if;
  return private.crm_finance_v5(case when p_action='close' then 'close' else 'shift_report' end,p_payload);
  result:=public.shift_report_detailed_test(sh);
  return result||jsonb_build_object('patients_count',(select count(distinct patient_id) from(
    select patient_id from public.procedures where shift_id=sh union select patient_id from public.sales where shift_id=sh) ps),
   'used',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.consumption_unit,'procedure_qty',u.proc,'sale_qty',u.sale,'quantity',u.proc+u.sale) order by m.name)
    from (select medication_id,sum(proc) proc,sum(sale) sale from(
     select pm.medication_id,pm.quantity proc,0::numeric sale from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id where p.shift_id=sh
     union all select si.medication_id,0,si.quantity from public.sale_items si join public.sales s on s.id=si.sale_id where s.shift_id=sh
    ) q group by medication_id) u join public.medications m on m.id=u.medication_id),'[]'));
 else raise exception 'Неизвестная операция';end if;
end $function$;

-- CREATE OR REPLACE retains each existing function's ownership and execution grants.
-- No direct table privileges or RPC grants are added.
notify pgrst,'reload schema';
commit;
