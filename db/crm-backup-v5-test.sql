begin;
do $$ declare role_n text; r jsonb;
begin
 if not exists(select 1 from cron.job where jobname='crm-backup-v5' and active and schedule='15 0 * * *') then raise exception 'Daily backup is not scheduled';end if;
 if not exists(select 1 from storage.buckets where id='crm-backups' and not public) then raise exception 'Backup bucket is public/missing';end if;
 foreach role_n in array array['anon','authenticated'] loop
  if has_function_privilege(role_n,'public.crm_backup_data_v5()','execute') or
   has_function_privilege(role_n,'public.crm_backup_authorize_v5(text)','execute') or
   has_function_privilege(role_n,'public.crm_admin_create_staff_v5(uuid,uuid,text)','execute') then raise exception 'Server-only endpoint exposed';end if;
 end loop;
 if private.crm_backup_authorize_v5(repeat('x',64)) then raise exception 'Invalid backup token accepted';end if;
 -- Check only exported table names, never return their clinical rows to the caller.
 r:=private.crm_backup_data_v5();
 if not(r->'tables' ?& array['private.warehouse_requests','private.crm_payment_allocations','private.crm_shift_reports','private.crm_procedure_templates']) then raise exception 'Backup omits required relational tables';end if;
 if r->'tables' ? 'private.crm_backup_config' or r->'tables' ? 'auth.users' then raise exception 'Backup includes credentials';end if;
end $$;
rollback;
