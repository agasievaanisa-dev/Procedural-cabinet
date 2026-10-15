-- Run after crm-partial-stock-v28.sql and crm-partial-stock-backup-v28.sql.
-- Real manager/server exports are inspected without printing any clinical rows.
-- All identities, ledger rows, flags, exports and the credential canary roll back.
begin;

create temporary table v28_backup_exports(kind text primary key,data jsonb not null);
grant select,insert on v28_backup_exports to authenticated,service_role;
-- An unlisted private table must never become part of a full backup.
create table private.crm_partial_stock_backup_credentials_v28_test(secret text);
insert into private.crm_partial_stock_backup_credentials_v28_test values('TEST synthetic credential excluded v28');

do $$declare owner_user uuid:=gen_random_uuid();nurse_user uuid:=gen_random_uuid();
 nurse_staff uuid;shift_n uuid;med_n uuid;paused_n uuid;
begin
 insert into auth.users(id,email) values
  (owner_user,owner_user::text||'@partial-backup-v28.example.invalid'),
  (nurse_user,nurse_user::text||'@partial-backup-v28.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id)
  values('TEST partial backup owner v28','owner',true,owner_user);
 insert into public.staff(full_name,role,active,auth_user_id)
  values('TEST partial backup nurse v28','nurse',true,nurse_user) returning id into nurse_staff;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-12-28',timestamptz '2096-12-28 08:30+03',timestamptz '2096-12-28 16:00+03','open') returning id into shift_n;
 insert into public.shift_staff(shift_id,staff_id) values(shift_n,nurse_staff);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST partial backup tracked v28','амп.',10,0,100,0,0) returning id into med_n;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(med_n,2,2,2,19,current_date+90);
 insert into public.stock(medication_id,location,quantity) values(med_n,'work',2),(med_n,'reserve',0);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST partial backup manually paused v28','амп.',10,0,100,0,0) returning id into paused_n;
 perform set_config('test.v28backup.owner',owner_user::text,true);
 perform set_config('test.v28backup.nurse',nurse_user::text,true);
 perform set_config('test.v28backup.nurse_staff',nurse_staff::text,true);
 perform set_config('test.v28backup.shift',shift_n::text,true);
 perform set_config('test.v28backup.medication',med_n::text,true);
 perform set_config('test.v28backup.paused',paused_n::text,true);
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_user,'role','authenticated')::text,true);
end $$;

set local role authenticated;
do $$declare result_n jsonb;payload_n jsonb;request_n uuid:=gen_random_uuid();
begin
 perform public.crm_partial_stock_v28('mode_set','{"enabled":true}',gen_random_uuid());
 perform public.crm_partial_stock_v28('tracking_set',jsonb_build_object(
  'id',current_setting('test.v28backup.paused'),'enabled',false,'reason','TEST synthetic pause for backup'),gen_random_uuid());
 payload_n:=jsonb_build_object('shift_id',current_setting('test.v28backup.shift'),
  'nurse_id',current_setting('test.v28backup.nurse_staff'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v28backup.medication'),'quantity',5)),
  'charge_total',500,'paid_total',0,'payment_status','debt','payments',jsonb_build_object('cash',0),
  'expected_stock_deducted',false,'expected_partial_stock',true,'notes','TEST partial backup synthetic sale v28');
 result_n:=public.record_treatment_v5('sale',payload_n,request_n);
 if (result_n->'stock_summary'->>'deducted_quantity')::numeric is distinct from 2
  or (result_n->'stock_summary'->>'pending_quantity')::numeric is distinct from 3 then
  raise exception 'Backup fixture did not create an actual partial-stock ledger';end if;
 if public.record_treatment_v5('sale',payload_n,request_n) is distinct from result_n then
  raise exception 'Backup fixture retry changed the stored result';end if;
 perform set_config('test.v28backup.sale',result_n->>'id',true);
 perform set_config('test.v28backup.request',request_n::text,true);
 insert into pg_temp.v28_backup_exports values('manager',public.crm_management_v5('backup_export'));
end $$;
reset role;

-- Scheduled backups use the same private snapshot through the server-only RPC.
set local role service_role;
insert into pg_temp.v28_backup_exports values('scheduled',public.crm_backup_data_v5());
reset role;

do $$declare export_n record;tables_n jsonb;row_n jsonb;name_n text;count_n integer;source_n text;
 private_names_n text[]:=array[
  'medication_favorites','warehouse_requests','crm_audit_log','crm_templates','crm_procedure_templates',
  'crm_finance_settings','crm_payment_allocations','crm_shift_payroll','crm_shift_reports','crm_deleted_medications_v7',
  'crm_treatment_services','crm_own_medications','crm_receipts_v10','crm_stock_returns_v10','crm_patient_delete_requests_v10',
  'crm_partial_stock_tracking_v28','crm_partial_stock_records_v28','crm_partial_stock_lines_v28','crm_partial_stock_requests_v28'];
begin
 if not exists(select 1 from private.crm_partial_stock_tracking_v28 where medication_id=current_setting('test.v28backup.medication')::uuid and enabled and source='auto')
  or not exists(select 1 from private.crm_partial_stock_tracking_v28 where medication_id=current_setting('test.v28backup.paused')::uuid and not enabled and source='manual') then
  raise exception 'Backup fixtures are missing enabled/paused tracking flags';end if;
 for export_n in select * from pg_temp.v28_backup_exports loop
  tables_n:=export_n.data->'tables';
  if export_n.data->>'format' is distinct from 'procedural-cabinet-backup-v5'
   or jsonb_typeof(tables_n) is distinct from 'object'
   or nullif(export_n.data->>'created_at','')::timestamptz is null then
   raise exception '% backup changed the established envelope',export_n.kind;end if;
  if export_n.kind='manager' then
   if export_n.data->>'version' is distinct from '5.0'
    or nullif(export_n.data->>'exported_at','')::timestamptz is null
    or export_n.data-array['format','created_at','tables','version','exported_at']<>'{}'::jsonb then
    raise exception 'Manager backup changed the established download envelope';end if;
  elsif export_n.data-array['format','created_at','tables']<>'{}'::jsonb then
   raise exception 'Scheduled backup changed the established envelope';end if;
  if exists(select 1 from jsonb_object_keys(tables_n) k(name)
   where split_part(name,'.',1) not in('public','private')
    or(split_part(name,'.',1)='private' and not(split_part(name,'.',2)=any(private_names_n))))
   or tables_n ?| array['private.crm_backup_config','auth.users','vault.secrets','vault.decrypted_secrets',
    'private.crm_partial_stock_backup_credentials_v28_test'] then
   raise exception '% backup includes private credentials or an unlisted schema/table',export_n.kind;end if;
  foreach name_n in array array['crm_partial_stock_tracking_v28','crm_partial_stock_records_v28',
   'crm_partial_stock_lines_v28','crm_partial_stock_requests_v28'] loop
   if jsonb_typeof(tables_n->('private.'||name_n)) is distinct from 'array' then
    raise exception '% backup omits partial table %',export_n.kind,name_n;end if;
   execute format('select count(*) from private.%I',name_n) into count_n;
   if jsonb_array_length(tables_n->('private.'||name_n))<>count_n then
    raise exception '% backup omits rows from partial table %',export_n.kind,name_n;end if;
  end loop;
  for row_n in select to_jsonb(t) from private.crm_partial_stock_tracking_v28 t
   where medication_id in(current_setting('test.v28backup.medication')::uuid,current_setting('test.v28backup.paused')::uuid) loop
   if not(tables_n->'private.crm_partial_stock_tracking_v28' @> jsonb_build_array(row_n)) then
    raise exception '% backup changed or lost a tracking policy row',export_n.kind;end if;
  end loop;
  select to_jsonb(r) into row_n from private.crm_partial_stock_records_v28 r
   where kind='sale' and record_id=current_setting('test.v28backup.sale')::uuid;
  if row_n is null or not(tables_n->'private.crm_partial_stock_records_v28' @> jsonb_build_array(row_n)) then
   raise exception '% backup lost the partial-stock record marker',export_n.kind;end if;
  select to_jsonb(l) into row_n from private.crm_partial_stock_lines_v28 l
   where kind='sale' and record_id=current_setting('test.v28backup.sale')::uuid;
  if row_n is null or row_n->>'pending_reason' is distinct from 'shortage'
   or (row_n->>'requested_qty')::numeric is distinct from 5
   or (row_n->>'deducted_qty')::numeric is distinct from 2
   or (row_n->>'pending_qty')::numeric is distinct from 3
   or not(tables_n->'private.crm_partial_stock_lines_v28' @> jsonb_build_array(row_n)) then
   raise exception '% backup lost the actual requested/deducted/pending ledger',export_n.kind;end if;
  select to_jsonb(r) into row_n from private.crm_partial_stock_requests_v28 r
   where request_id=current_setting('test.v28backup.request')::uuid;
  if row_n is null or row_n->'result' is null or row_n->'result'='null'::jsonb
   or not(tables_n->'private.crm_partial_stock_requests_v28' @> jsonb_build_array(row_n)) then
   raise exception '% backup lost the retry payload/result receipt',export_n.kind;end if;
  select to_jsonb(f) into row_n from private.crm_finance_settings f where id;
  if row_n->'partial_stock' is distinct from 'true'::jsonb or row_n->'payment_only' is distinct from 'true'::jsonb
   or not(tables_n->'private.crm_finance_settings' @> jsonb_build_array(row_n)) then
   raise exception '% backup lost the partial-stock accounting mode',export_n.kind;end if;
  select to_jsonb(s) into row_n from public.sales s where id=current_setting('test.v28backup.sale')::uuid;
  if not(tables_n->'public.sales' @> jsonb_build_array(row_n)) then
   raise exception '% backup lost the related financial sale',export_n.kind;end if;
 end loop;
 -- The whitelist is patched inside the existing one-statement snapshot builder.
 source_n:=pg_get_functiondef('private.crm_backup_data_v5()'::regprocedure);
 if not exists(select 1 from pg_proc where oid='private.crm_backup_data_v5()'::regprocedure
  and prosecdef and provolatile='s' and proconfig @> array['search_path=""'])
  or source_n not like '%array_to_string(parts,%union all%'
  or has_function_privilege('authenticated','private.crm_backup_data_v5()','execute')
  or has_function_privilege('anon','private.crm_backup_data_v5()','execute')
  or not has_function_privilege('service_role','private.crm_backup_data_v5()','execute') then
  raise exception 'Backup snapshot/security contract changed';end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.v28backup.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v28backup.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$begin
 begin perform public.crm_management_v5('backup_export');raise exception 'Nurse downloaded a full backup';
 exception when others then if sqlerrm<>'Доступно только владельцу' then raise;end if;end;
 begin perform public.crm_backup_data_v5();raise exception 'Nurse called the server backup endpoint';
 exception when insufficient_privilege then null;end;
end $$;
reset role;

select true as partial_stock_backup_v28_verified;
rollback;
