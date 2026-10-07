-- Run only after the frontend release using record_treatment_v5 is live.
-- Operational/history compatibility endpoints remain available and role-redacted.
begin;
revoke execute on function public.record_treatment_v3(text,jsonb,uuid),
 public.save_procedure_test(uuid,uuid,uuid,uuid,numeric,text,text,text,jsonb),
 public.save_sale_test(uuid,uuid,uuid,numeric,text,text,text,jsonb)
from public,anon,authenticated;
-- private.record_treatment_v3 is retained for the checked atomic v5 implementation.
revoke execute on function private.record_treatment_v3(text,jsonb,uuid) from public,anon,authenticated;
-- Retired catalog/mentor RPCs are outside the two supported CRM roles.
-- Old mentor guards treated a missing staff role as NULL and could disclose history.
revoke execute on function public.mentor_patients_test(),public.mentor_patient_history_test(uuid),
 public.nurse_medication_catalog() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
