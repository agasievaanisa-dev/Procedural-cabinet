-- The signed-in employee's working-day journal. Reads assigned shifts only,
-- including closed shifts; does not refresh cached reports or record receipts/audits.
-- Requires crm-clinical-v10.sql (current pure report builder).
begin;

create or replace function private.crm_shift_journal_v12(p_date date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;day_value date:=coalesce(p_date,(now() at time zone 'Europe/Moscow')::date);
 shift_row record;report_row jsonb;reports_value jsonb:='[]'::jsonb;
begin
 if auth.uid() is null then raise exception 'Войдите в программу';end if;
 select id into actor from public.staff where auth_user_id=auth.uid() and active
  and role in ('owner','admin','nurse') limit 1 for share;
 if actor is null then raise exception 'Нет доступа к журналу смен';end if;

 for shift_row in
  select s.id from public.shifts s where s.shift_date=day_value
   and exists(select 1 from public.shift_staff ss where ss.shift_id=s.id and ss.staff_id=actor)
  order by s.started_at,s.id
 loop
  -- The existing finance endpoint refreshes closed snapshots on reads. Calling
  -- its pure builder here keeps this journal free of database mutations.
  report_row:=private.crm_build_shift_report_v5(shift_row.id);
  -- Whitelist the operational/financial fields already available to an assigned
  -- nurse. An owner receives the same journal, without warehouse or payroll data.
  reports_value:=reports_value||jsonb_build_array(jsonb_build_object(
   'shift',report_row->'shift',
   'staff',coalesce((select jsonb_agg(jsonb_build_object('id',x->'id','full_name',x->'full_name'))
    from jsonb_array_elements(coalesce(report_row->'staff','[]'::jsonb)) x),'[]'::jsonb),
   'patients_count',report_row->'patients_count','procedures_count',report_row->'procedures_count','sales_count',report_row->'sales_count',
   'procedures',coalesce(report_row->'procedures','[]'::jsonb),'sales',coalesce(report_row->'sales','[]'::jsonb),
   'receipts',coalesce(report_row->'receipts','[]'::jsonb),
   'procedures_total',report_row->'procedures_total','sales_total',report_row->'sales_total','revenue',report_row->'revenue',
   'charge_total',report_row->'charge_total','debt_total',report_row->'debt_total',
   'debt_created_total',report_row->'debt_created_total','debt_receipts_total',report_row->'debt_receipts_total'
  ));
 end loop;
 return jsonb_build_object('date',day_value,'time_zone','Europe/Moscow','reports',reports_value);
end $$;
revoke all on function private.crm_shift_journal_v12(date) from public,anon,authenticated;

create or replace function public.crm_shift_journal_v12(p_date date default null)
returns jsonb language sql security definer set search_path='' as $$
 select private.crm_shift_journal_v12(p_date);
$$;
revoke all on function public.crm_shift_journal_v12(date) from public,anon;
grant execute on function public.crm_shift_journal_v12(date) to authenticated;
notify pgrst,'reload schema';
commit;
