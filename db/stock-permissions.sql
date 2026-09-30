-- Old prototypes must not bypass the validated stock and clinical operations.
revoke all on function public.manager_set_medication_test(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,integer) from public,anon,authenticated;
revoke all on function public.admin_medications() from public,anon,authenticated;
revoke all on function public.rls_auto_enable() from public,anon,authenticated;
revoke all on function public.save_procedure(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.start_shift(date,timestamptz) from public,anon,authenticated;
revoke all on function public.start_shift_v8(date,timestamptz,uuid,uuid) from public,anon,authenticated;
