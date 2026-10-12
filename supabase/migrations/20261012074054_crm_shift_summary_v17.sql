-- Assigned nurses may view shift wages and the amount after payroll.
-- Existing finance RPCs continue enforcing assigned-shift access and manager-only writes.
begin;
set local lock_timeout='10s';

create or replace function private.crm_nurse_shift_report_v10(p_report jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select coalesce((select jsonb_object_agg(entry.key,entry.value)
  from jsonb_each(coalesce(p_report,'{}'::jsonb)) entry
  where entry.key<>all(array['stock','used','untracked','warnings','float_amount','payroll_closed','payroll_open'])
   and entry.key!~'(^|_)(purchase|purchases|cost|profit)(_|$)'), '{}'::jsonb)
 ||jsonb_build_object('staff',coalesce((select jsonb_agg(jsonb_build_object(
  'id',member->'id','full_name',member->'full_name','amount',member->'amount') order by ordinal)
  from jsonb_array_elements(case when jsonb_typeof(p_report->'staff')='array'
   then p_report->'staff' else '[]'::jsonb end) with ordinality as staff_rows(member,ordinal)), '[]'::jsonb));
$$;
revoke all on function private.crm_nurse_shift_report_v10(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
