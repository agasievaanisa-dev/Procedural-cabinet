-- A medicine sale may be saved/collected in debt without a patient card.
-- Procedures still require a patient. This changes no saved rows or privileges.
-- Patch only the released checks; keep captured prices, payment/stock handling,
-- idempotency, visit time, permissions and audit logic byte-for-byte otherwise.
begin;
set local lock_timeout='10s';

do $migration$
declare patch record;source_n text;old_count integer;new_count integer;
begin
 if position($guard$if p_kind='procedure' and patient is null then raise exception 'Выберите пациента';end if;$guard$
  in pg_get_functiondef('private.crm_record_treatment_v10(text,jsonb,uuid,boolean)'::regprocedure))=0 then
  raise exception 'v27: patient-required procedure guard was not found';
 end if;
 for patch in select * from (values
  ('private.crm_record_treatment_v10(text,jsonb,uuid,boolean)',
   $old$if paid_n<(data_n->>'charge_total')::numeric and patient is null then raise exception 'Для оплаты в долг выберите пациента';end if;$old$,
   $new$if p_kind='procedure' and paid_n<(data_n->>'charge_total')::numeric and patient is null then raise exception 'Для оплаты в долг выберите пациента';end if;$new$),
  ('private.crm_clinical_v10(text,jsonb,uuid)',
   $old$if(original->>'patient_id') is null then raise exception 'Для оплаты долга нужен пациент';end if;$old$,
   $new$if kind_n='procedure' and(original->>'patient_id') is null then raise exception 'Для оплаты долга нужен пациент';end if;$new$),
  ('private.crm_clinical_v10(text,jsonb,uuid)',
   $old$if p_payload->>'payment_status'='pending' and nullif(original->>'patient_id','') is null then$old$,
   $new$if kind_n='procedure' and p_payload->>'payment_status'='pending' and nullif(original->>'patient_id','') is null then$new$),
  ('private.crm_payment_correction_v22(jsonb,uuid)',
   $old$if nullif(original_n->>'patient_id','') is null then
  raise exception 'Для сохранения долга нужен пациент' using errcode='22023';
 end if;$old$,
   $new$if kind_n='procedure' and nullif(original_n->>'patient_id','') is null then
  raise exception 'Для сохранения долга нужен пациент' using errcode='22023';
 end if;$new$),
  ('private.crm_payment_correction_v22(jsonb,uuid)',
   $old$perform 1 from public.patients p where p.id=(original_n->>'patient_id')::uuid for share;
 if not found then raise exception 'Пациент не найден' using errcode='22023';end if;$old$,
   $new$if nullif(original_n->>'patient_id','') is not null then
  perform 1 from public.patients p where p.id=(original_n->>'patient_id')::uuid for share;
  if not found then raise exception 'Пациент не найден' using errcode='22023';end if;
 end if;$new$)
 ) as changes(signature,old_fragment,new_fragment) loop
  source_n:=pg_get_functiondef(patch.signature::regprocedure);
  -- A matching second application is harmless; unexpected source fails closed.
  new_count:=(length(source_n)-length(replace(source_n,patch.new_fragment,'')))/length(patch.new_fragment);
  if new_count=1 then continue;end if;
  old_count:=(length(source_n)-length(replace(source_n,patch.old_fragment,'')))/length(patch.old_fragment);
  if old_count<>1 or new_count<>0 then
   raise exception 'v27: expected exactly one released check in %, found % old/% new',patch.signature,old_count,new_count;
  end if;
  execute replace(source_n,patch.old_fragment,patch.new_fragment);
 end loop;
end $migration$;

notify pgrst,'reload schema';
commit;
