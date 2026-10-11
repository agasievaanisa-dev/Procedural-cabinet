-- Keep additional receipts, captured services, own medicines and removal audit in full backups.
begin;
create or replace function private.crm_backup_data_v5() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t record; parts text[]:=array[]::text[]; result jsonb;
begin
 for t in select table_schema,table_name from information_schema.tables
  where table_type='BASE TABLE' and (table_schema='public' or (table_schema='private' and table_name in (
   'medication_favorites','warehouse_requests','crm_audit_log','crm_templates','crm_procedure_templates',
   'crm_finance_settings','crm_payment_allocations','crm_shift_payroll','crm_shift_reports','crm_deleted_medications_v7',
   'crm_treatment_services','crm_own_medications','crm_receipts_v10','crm_stock_returns_v10','crm_patient_delete_requests_v10')))
  order by table_schema,table_name loop
  parts:=array_append(parts,format('select %L::text as name, coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) as rows from %I.%I t',
   t.table_schema||'.'||t.table_name,t.table_schema,t.table_name));
 end loop;
 execute 'select jsonb_object_agg(name,rows) from ('||array_to_string(parts,' union all ')||') all_tables' into result;
 return jsonb_build_object('format','procedural-cabinet-backup-v5','created_at',now(),'tables',result);
end $$;
revoke all on function private.crm_backup_data_v5() from public,anon,authenticated;
grant execute on function private.crm_backup_data_v5() to service_role;
notify pgrst,'reload schema';
commit;
