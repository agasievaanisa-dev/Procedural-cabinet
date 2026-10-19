-- A separate non-cash payment channel. Old allocations keep their exact amounts.
-- Historical cash-count tokens must stay stable while other_card is zero.
begin;
set local lock_timeout='10s';
do $guard$
declare actual_n text;
begin
 if to_regprocedure('private.crm_add_receipt_v10_before_v29(text,uuid,uuid,uuid,jsonb,uuid,text)') is null then raise exception 'Missing released payment helper: private.crm_add_receipt_v10_before_v29(text,uuid,uuid,uuid,jsonb,uuid,text)';end if;
 select md5(pg_get_functiondef('private.crm_add_receipt_v10_before_v29(text,uuid,uuid,uuid,jsonb,uuid,text)'::regprocedure)) into actual_n;
 if actual_n<>'48faa73dcd73135dcc2d6d9675323375' then raise exception 'Payment helper changed since review: private.crm_add_receipt_v10_before_v29(text,uuid,uuid,uuid,jsonb,uuid,text)';end if;
 if to_regprocedure('private.crm_add_receipt_v10(text,uuid,uuid,uuid,jsonb,uuid,text)') is null then raise exception 'Missing released payment helper: private.crm_add_receipt_v10(text,uuid,uuid,uuid,jsonb,uuid,text)';end if;
 select md5(pg_get_functiondef('private.crm_add_receipt_v10(text,uuid,uuid,uuid,jsonb,uuid,text)'::regprocedure)) into actual_n;
 if actual_n<>'8c83a304b4344ef4f160d3cbcae04356' then raise exception 'Payment helper changed since review: private.crm_add_receipt_v10(text,uuid,uuid,uuid,jsonb,uuid,text)';end if;
 if to_regprocedure('private.crm_build_shift_report_legacy_v9(uuid)') is null then raise exception 'Missing released payment helper: private.crm_build_shift_report_legacy_v9(uuid)';end if;
 select md5(pg_get_functiondef('private.crm_build_shift_report_legacy_v9(uuid)'::regprocedure)) into actual_n;
 if actual_n<>'cd61ec566f9931831f657ffad9eabac7' then raise exception 'Payment helper changed since review: private.crm_build_shift_report_legacy_v9(uuid)';end if;
 if to_regprocedure('private.crm_build_shift_report_v5_before_v28(uuid)') is null then raise exception 'Missing released payment helper: private.crm_build_shift_report_v5_before_v28(uuid)';end if;
 select md5(pg_get_functiondef('private.crm_build_shift_report_v5_before_v28(uuid)'::regprocedure)) into actual_n;
 if actual_n<>'0534bfb2d1f8b5402c4750c6005dbbeb' then raise exception 'Payment helper changed since review: private.crm_build_shift_report_v5_before_v28(uuid)';end if;
 if to_regprocedure('private.crm_build_shift_report_v5_before_v30(uuid)') is null then raise exception 'Missing released payment helper: private.crm_build_shift_report_v5_before_v30(uuid)';end if;
 select md5(pg_get_functiondef('private.crm_build_shift_report_v5_before_v30(uuid)'::regprocedure)) into actual_n;
 if actual_n<>'e30eb14801271ebd59505e4d0140a3c7' then raise exception 'Payment helper changed since review: private.crm_build_shift_report_v5_before_v30(uuid)';end if;
 if to_regprocedure('private.crm_cash_financial_snapshot_v37(uuid)') is null then raise exception 'Missing released payment helper: private.crm_cash_financial_snapshot_v37(uuid)';end if;
 select md5(pg_get_functiondef('private.crm_cash_financial_snapshot_v37(uuid)'::regprocedure)) into actual_n;
 if actual_n<>'e9e0544b5a40abaa9e7a1f57de24a871' then raise exception 'Payment helper changed since review: private.crm_cash_financial_snapshot_v37(uuid)';end if;
 if to_regprocedure('private.crm_clinical_v10(text,jsonb,uuid)') is null then raise exception 'Missing released payment helper: private.crm_clinical_v10(text,jsonb,uuid)';end if;
 select md5(pg_get_functiondef('private.crm_clinical_v10(text,jsonb,uuid)'::regprocedure)) into actual_n;
 if actual_n<>'aebb517136a2f1925e0e9102ad05bf48' then raise exception 'Payment helper changed since review: private.crm_clinical_v10(text,jsonb,uuid)';end if;
 if to_regprocedure('private.crm_dashboard_day_v25_before_v30(date)') is null then raise exception 'Missing released payment helper: private.crm_dashboard_day_v25_before_v30(date)';end if;
 select md5(pg_get_functiondef('private.crm_dashboard_day_v25_before_v30(date)'::regprocedure)) into actual_n;
 if actual_n<>'017529b4561d6cfa093c3b7fb7141f6f' then raise exception 'Payment helper changed since review: private.crm_dashboard_day_v25_before_v30(date)';end if;
 if to_regprocedure('private.crm_finance_summary_v5_before_v28(jsonb)') is null then raise exception 'Missing released payment helper: private.crm_finance_summary_v5_before_v28(jsonb)';end if;
 select md5(pg_get_functiondef('private.crm_finance_summary_v5_before_v28(jsonb)'::regprocedure)) into actual_n;
 if actual_n<>'737f6b5ab6aa7df3b60f7322ed90d0fe' then raise exception 'Payment helper changed since review: private.crm_finance_summary_v5_before_v28(jsonb)';end if;
 if to_regprocedure('private.crm_finance_summary_v5_before_v30(jsonb)') is null then raise exception 'Missing released payment helper: private.crm_finance_summary_v5_before_v30(jsonb)';end if;
 select md5(pg_get_functiondef('private.crm_finance_summary_v5_before_v30(jsonb)'::regprocedure)) into actual_n;
 if actual_n<>'352ee42b0e38a80f3228f973de88186c' then raise exception 'Payment helper changed since review: private.crm_finance_summary_v5_before_v30(jsonb)';end if;
 if to_regprocedure('private.crm_payment_correction_v22(jsonb,uuid)') is null then raise exception 'Missing released payment helper: private.crm_payment_correction_v22(jsonb,uuid)';end if;
 select md5(pg_get_functiondef('private.crm_payment_correction_v22(jsonb,uuid)'::regprocedure)) into actual_n;
 if actual_n<>'8cae98669652ed3f02bb0af2c383cec7' then raise exception 'Payment helper changed since review: private.crm_payment_correction_v22(jsonb,uuid)';end if;
 if to_regprocedure('private.crm_record_treatment_v10_before_v28(text,jsonb,uuid,boolean)') is null then raise exception 'Missing released payment helper: private.crm_record_treatment_v10_before_v28(text,jsonb,uuid,boolean)';end if;
 select md5(pg_get_functiondef('private.crm_record_treatment_v10_before_v28(text,jsonb,uuid,boolean)'::regprocedure)) into actual_n;
 if actual_n<>'a8d09d8d20ee82ae179384c8d95f6a65' then raise exception 'Payment helper changed since review: private.crm_record_treatment_v10_before_v28(text,jsonb,uuid,boolean)';end if;
 if to_regprocedure('private.crm_shift_treatment_snapshot_v29(text,uuid)') is null then raise exception 'Missing released payment helper: private.crm_shift_treatment_snapshot_v29(text,uuid)';end if;
 select md5(pg_get_functiondef('private.crm_shift_treatment_snapshot_v29(text,uuid)'::regprocedure)) into actual_n;
 if actual_n<>'fbb1e2576c880f769040377f2b09b475' then raise exception 'Payment helper changed since review: private.crm_shift_treatment_snapshot_v29(text,uuid)';end if;
 if to_regprocedure('private.crm_treatment_snapshot_v10_before_v28(text,uuid)') is null then raise exception 'Missing released payment helper: private.crm_treatment_snapshot_v10_before_v28(text,uuid)';end if;
 select md5(pg_get_functiondef('private.crm_treatment_snapshot_v10_before_v28(text,uuid)'::regprocedure)) into actual_n;
 if actual_n<>'f02b29bb024ec94a6944bbf849fa2e6f' then raise exception 'Payment helper changed since review: private.crm_treatment_snapshot_v10_before_v28(text,uuid)';end if;
 if to_regprocedure('private.crm_treatment_snapshot_v10(text,uuid)') is null then raise exception 'Missing released payment helper: private.crm_treatment_snapshot_v10(text,uuid)';end if;
 select md5(pg_get_functiondef('private.crm_treatment_snapshot_v10(text,uuid)'::regprocedure)) into actual_n;
 if actual_n<>'aff5da6cae24bf8971e9bcd3bf1b9cb8' then raise exception 'Payment helper changed since review: private.crm_treatment_snapshot_v10(text,uuid)';end if;
 if to_regprocedure('private.crm_validate_payment_v10(jsonb)') is null then raise exception 'Missing released payment helper: private.crm_validate_payment_v10(jsonb)';end if;
 select md5(pg_get_functiondef('private.crm_validate_payment_v10(jsonb)'::regprocedure)) into actual_n;
 if actual_n<>'16b2fac6037e84f52480acfbdde5b2fb' then raise exception 'Payment helper changed since review: private.crm_validate_payment_v10(jsonb)';end if;
 if to_regprocedure('private.crm_clinical_v10_before_v28(text,jsonb,uuid)') is null then raise exception 'Missing released payment helper: private.crm_clinical_v10_before_v28(text,jsonb,uuid)';end if;
 select md5(pg_get_functiondef('private.crm_clinical_v10_before_v28(text,jsonb,uuid)'::regprocedure)) into actual_n;
 if actual_n<>'226aae2ef139599cf3433b65e10cd6c7' then raise exception 'Payment helper changed since review: private.crm_clinical_v10_before_v28(text,jsonb,uuid)';end if;
end $guard$;

alter table private.crm_payment_allocations add column other_card numeric(14,2) not null default 0 check(other_card>=0);
alter table private.crm_receipts_v10 add column other_card numeric(14,2) not null default 0 check(other_card>=0);
alter table private.crm_receipts_v10 drop constraint crm_receipts_positive_v29;
alter table private.crm_receipts_v10 add constraint crm_receipts_positive_v47 check(cash+terminal+owner_card+other_card+unclassified_amount>0);

create or replace function private.crm_validate_payment_v10(p_pay jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c numeric;t numeric;o numeric;x numeric;r numeric;
begin
 if jsonb_typeof(p_pay) is distinct from 'object' then raise exception 'Укажите способы оплаты';end if;
 if exists(select 1 from jsonb_object_keys(p_pay) k where k not in ('cash','terminal','owner_card','other_card','cash_received')) then raise exception 'Неизвестный способ оплаты';end if;
 c:=coalesce((p_pay->>'cash')::numeric,0);t:=coalesce((p_pay->>'terminal')::numeric,0);o:=coalesce((p_pay->>'owner_card')::numeric,0);x:=coalesce((p_pay->>'other_card')::numeric,0);r:=coalesce((p_pay->>'cash_received')::numeric,c);
 if exists(select 1 from unnest(array[c,t,o,x,r]) n where n<0 or n<>round(n,2) or n::text in ('NaN','Infinity','-Infinity') or n>9999999999.99) then raise exception 'Проверьте суммы оплаты';end if;
 if r<c or(c=0 and r<>0) then raise exception 'Проверьте полученные наличные';end if;
 return jsonb_build_object('cash',c,'terminal',t,'owner_card',o,'other_card',x,'cash_received',r,'change',r-c,'total',c+t+o+x);
end $$;
revoke all on function private.crm_validate_payment_v10(jsonb) from public,anon,authenticated;

-- BEGIN GENERATED RELEASED FUNCTION EXTENSIONS
-- Existing authorization, locking, idempotency and financial scopes are retained.
CREATE OR REPLACE FUNCTION private.crm_clinical_v10_before_v28(p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_request_id uuid DEFAULT NULL::uuid)
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
 -- Derive receipt scope from the locked pre-edit bill. Extra work on a
 -- fully settled bill belongs to the receiving shift; an existing unpaid
 -- true loan keeps its separate ledger even when edited at the same time.
 perform set_config('crm.debt_receipt_context_v29',jsonb_build_object('request_id',p_request_id,
  'payment_pending',coalesce((original->>'payment_pending')::boolean,false)
   or(p_action='treatment_edit' and coalesce((original->>'debt_total')::numeric,-1)=0))::text,true);
 pay:=private.crm_validate_payment_v10(coalesce(p_payload->'payments','{}'));
 if p_action='debt_payment' then
  if kind_n='procedure' and(original->>'patient_id') is null then raise exception 'Для оплаты долга нужен пациент';end if;
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
  if kind_n='procedure' and p_payload->>'payment_status'='pending' and nullif(original->>'patient_id','') is null then
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
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_add_receipt_v10_before_v29(p_kind text, p_id uuid, p_shift uuid, p_nurse uuid, p_pay jsonb, p_request uuid, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor uuid:=private.crm_actor_staff_v10();p jsonb:=private.crm_validate_payment_v10(p_pay-'total'-'change');
begin
 if(p->>'total')::numeric<=0 then raise exception 'Укажите положительную сумму оплаты долга';end if;
 perform 1 from public.shifts where id=p_shift and status='open' for update;
 if not found then raise exception 'Для приёма оплаты выберите открытую смену';end if;
 if not private.is_manager() and not exists(select 1 from public.shift_staff where shift_id=p_shift and staff_id=actor) then raise exception 'Нет доступа к смене оплаты';end if;
 if not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=p_shift and ss.staff_id=p_nurse and st.active and st.role='nurse') then raise exception 'Выберите медсестру смены оплаты';end if;
 insert into private.crm_receipts_v10(id,kind,procedure_id,sale_id,shift_id,nurse_id,cash,terminal,owner_card,other_card,cash_received,change_amount,created_by,comment)
 values(p_request,p_kind,case when p_kind='procedure' then p_id end,case when p_kind='sale' then p_id end,p_shift,p_nurse,(p->>'cash')::numeric,(p->>'terminal')::numeric,(p->>'owner_card')::numeric,(p->>'other_card')::numeric,(p->>'cash_received')::numeric,(p->>'change')::numeric,auth.uid(),nullif(trim(p_comment),''));
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_add_receipt_v10(p_kind text, p_id uuid, p_shift uuid, p_nurse uuid, p_pay jsonb, p_request uuid, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p jsonb:=private.crm_validate_payment_v10(p_pay-'total'-'change');context_n jsonb;pending_n boolean;actor_n uuid:=private.crm_actor_staff_v10();
begin
 -- The clinical entry point supplies the pre-edit state because an edit may
 -- clear payment_pending before this helper runs. It resets the context later.
 context_n:=nullif(current_setting('crm.debt_receipt_context_v29',true),'')::jsonb;
 if context_n->>'request_id'=p_request::text then pending_n:=(context_n->>'payment_pending')::boolean;
 elsif p_kind='procedure' then select payment_pending into pending_n from public.procedures where id=p_id;
 elsif p_kind='sale' then select payment_pending into pending_n from public.sales where id=p_id;
 end if;
 if pending_n is null or actor_n is null then raise exception 'Не удалось определить исходное состояние оплаты';end if;
 if pending_n then
  perform private.crm_add_receipt_v10_before_v29(p_kind,p_id,p_shift,p_nurse,p_pay,p_request,p_comment);
  update private.crm_receipts_v10 set paid_on=(created_at at time zone 'Europe/Moscow')::date,
   purpose=coalesce(nullif(trim(p_comment),''),'Оплата после процедуры') where id=p_request;
 else
  if(p->>'total')::numeric<=0 then raise exception 'Укажите положительную сумму оплаты долга';end if;
  insert into private.crm_receipts_v10(id,kind,procedure_id,sale_id,shift_id,nurse_id,cash,terminal,owner_card,other_card,cash_received,change_amount,
   created_by,comment,is_debt_repayment,paid_on,purpose)
  values(p_request,p_kind,case when p_kind='procedure' then p_id end,case when p_kind='sale' then p_id end,null,actor_n,
   (p->>'cash')::numeric,(p->>'terminal')::numeric,(p->>'owner_card')::numeric,(p->>'other_card')::numeric,(p->>'cash_received')::numeric,(p->>'change')::numeric,
   auth.uid(),nullif(trim(p_comment),''),true,(now() at time zone 'Europe/Moscow')::date,coalesce(nullif(trim(p_comment),''),'Погашение долга'));
 end if;
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_build_shift_report_legacy_v9(p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare answer jsonb; revenue_n jsonb; wages_n numeric; unknown_n integer;
 payment_only_procedures_n bigint; payment_only_sales_n bigint;
begin
 with events as (
  select 'procedure' kind,p.id,p.paid_total from public.procedures p where shift_id=p_shift
  union all select 'sale',s.id,s.paid_total from public.sales s where shift_id=p_shift
 )
 select jsonb_build_object('cash',coalesce(sum(a.cash),0),'terminal',coalesce(sum(a.terminal),0),'owner_card',coalesce(sum(a.owner_card),0),'other_card',coalesce(sum(a.other_card),0),
  'unclassified',coalesce(sum(case when a.id is null then e.paid_total else 0 end),0),'total',coalesce(sum(e.paid_total),0)) into revenue_n
 from events e left join private.crm_payment_allocations a on a.voided_at is null and ((e.kind='procedure' and a.procedure_id=e.id) or (e.kind='sale' and a.sale_id=e.id));
 select coalesce(sum(amount),0) into wages_n from private.crm_shift_payroll where shift_id=p_shift;
 select count(*) into unknown_n from public.shift_staff ss join public.staff st on st.id=ss.staff_id
  left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=p_shift and st.role='nurse' and w.shift_id is null;
 select count(*) into payment_only_procedures_n from public.procedures where shift_id=p_shift and not stock_deducted;
 select count(*) into payment_only_sales_n from public.sales where shift_id=p_shift and not stock_deducted;
 select jsonb_build_object(
  'shift',(select jsonb_build_object('id',id,'date',shift_date,'started_at',started_at,'planned_end_at',planned_end_at,'ended_at',ended_at,'status',status,'slot',daily_slot) from public.shifts where id=p_shift),
  'staff',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=p_shift),'[]'),
  'patients_count',(select count(distinct patient_id) from(select patient_id from public.procedures where shift_id=p_shift union all select patient_id from public.sales where shift_id=p_shift) e),
  'procedures_count',(select count(*) from public.procedures where shift_id=p_shift),
  'sales_count',(select count(*) from public.sales where shift_id=p_shift),
  'payment_only_procedures_count',payment_only_procedures_n,'payment_only_sales_count',payment_only_sales_n,
  'procedures_total',coalesce((select sum(paid_total) from public.procedures where shift_id=p_shift),0),
  'sales_total',coalesce((select sum(paid_total) from public.sales where shift_id=p_shift),0),
  'cash_total',revenue_n->'total','revenue',revenue_n,'payroll_total',wages_n,'payroll_unknown',unknown_n,'payroll_complete',unknown_n=0,
  'cash_after_salary',case when unknown_n=0 then (revenue_n->>'total')::numeric-wages_n end,
  'procedures',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'at',p.visit_at,'patient_id',p.patient_id,'patient',pt.full_name,'nurse',st.full_name,'type',p.procedure_type,'notes',p.notes,
   'list_total',p.list_total,'discount_amount',p.discount_amount,'paid_total',p.paid_total,'stock_deducted',p.stock_deducted,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'line_total',pm.line_total) order by m.name) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]')) order by p.visit_at,p.id)
   from public.procedures p left join public.patients pt on pt.id=p.patient_id left join public.staff st on st.id=p.nurse_id where p.shift_id=p_shift),'[]'),
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'at',s.sold_at,'patient_id',s.patient_id,'patient',coalesce(pt.full_name,'Без пациента'),'nurse',st.full_name,'notes',s.notes,
   'list_total',s.list_total,'discount_amount',s.discount_amount,'paid_total',s.paid_total,'stock_deducted',s.stock_deducted,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'line_total',si.line_total) order by m.name) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]')) order by s.sold_at,s.id)
   from public.sales s left join public.patients pt on pt.id=s.patient_id left join public.staff st on st.id=s.nurse_id where s.shift_id=p_shift),'[]'),
  'used',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.consumption_unit,'procedure_qty',u.proc,'sale_qty',u.sale,'quantity',u.proc+u.sale) order by m.name)
   from(select medication_id,sum(proc) proc,sum(sale) sale from(
    select pm.medication_id,pm.quantity proc,0::numeric sale from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id where p.shift_id=p_shift and p.stock_deducted
    union all select si.medication_id,0,si.quantity from public.sale_items si join public.sales s on s.id=si.sale_id where s.shift_id=p_shift and s.stock_deducted
   ) e group by medication_id) u join public.medications m on m.id=u.medication_id),'[]'),
  'untracked',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.consumption_unit,'procedure_qty',u.proc,'sale_qty',u.sale,'quantity',u.proc+u.sale) order by m.name)
   from(select medication_id,sum(proc) proc,sum(sale) sale from(
    select pm.medication_id,pm.quantity proc,0::numeric sale from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id where p.shift_id=p_shift and not p.stock_deducted
    union all select si.medication_id,0,si.quantity from public.sale_items si join public.sales s on s.id=si.sale_id where s.shift_id=p_shift and not s.stock_deducted
   ) e group by medication_id) u join public.medications m on m.id=u.medication_id),'[]'),
  'stock',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.consumption_unit,'work',coalesce(w.quantity,0),'reserve',coalesce(r.quantity,0)) order by m.name)
   from public.medications m left join public.stock w on w.medication_id=m.id and w.location='work' left join public.stock r on r.medication_id=m.id and r.location='reserve' where m.active),'[]'),
  'warnings',coalesce((select jsonb_agg(warning) from(
   select jsonb_build_object('type','low_stock','scope','reserve','medication_id',m.id,'name',m.name,'quantity',coalesce(sum(s.quantity),0),'minimum',m.min_total_stock) warning
   from public.medications m left join public.stock s on s.medication_id=m.id where m.active group by m.id having coalesce(sum(s.quantity),0)<m.min_total_stock
   union all select jsonb_build_object('type','low_work','scope','work','medication_id',m.id,'name',m.name,'quantity',coalesce(s.quantity,0),'minimum',m.work_threshold)
   from public.medications m left join public.stock s on s.medication_id=m.id and s.location='work' where m.active and coalesce(s.quantity,0)<m.work_threshold
   union all select jsonb_build_object('type',case when b.expiry_date<(now() at time zone 'Europe/Moscow')::date then 'expired' else 'expiring' end,'scope','work','medication_id',m.id,'name',m.name,'expiry_date',b.expiry_date,'quantity',b.work_quantity)
   from public.medication_batches b join public.medications m on m.id=b.medication_id where b.work_quantity>0 and b.expiry_date<=(now() at time zone 'Europe/Moscow')::date+30
   union all select jsonb_build_object('type',case when b.expiry_date<(now() at time zone 'Europe/Moscow')::date then 'expired' else 'expiring' end,'scope','reserve','medication_id',m.id,'name',m.name,'expiry_date',b.expiry_date,'quantity',b.quantity_remaining-b.work_quantity)
   from public.medication_batches b join public.medications m on m.id=b.medication_id where b.quantity_remaining-b.work_quantity>0 and b.expiry_date<=(now() at time zone 'Europe/Moscow')::date+30
   union all select jsonb_build_object('type','payment_only','scope','work','name','Без складского списания',
    'count',payment_only_procedures_n+payment_only_sales_n,'procedures_count',payment_only_procedures_n,'sales_count',payment_only_sales_n,
    'message','В смене есть операции без складского списания. Их количества учтены отдельно; по этим операциям остатки склада не менялись.')
   where payment_only_procedures_n+payment_only_sales_n>0
  ) alerts),'[]')
 ) into answer;
 return answer;
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_build_shift_report_v5_before_v28(p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a jsonb:=private.crm_build_shift_report_legacy_v9(p_shift);receipts_n jsonb;r jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'procedure_id',x.procedure_id,'sale_id',x.sale_id,'patient_id',coalesce(p.patient_id,s.patient_id),'patient',pt.full_name,'at',x.created_at,'nurse',st.full_name,
  'paid_total',x.cash+x.terminal+x.owner_card+x.other_card,'comment',x.comment,'payments',jsonb_build_object('cash',x.cash,'terminal',x.terminal,'owner_card',x.owner_card,'other_card',x.other_card,'cash_received',x.cash_received,'change',x.change_amount)) order by x.created_at,x.id),'[]') into receipts_n
  from private.crm_receipts_v10 x left join public.procedures p on p.id=x.procedure_id left join public.sales s on s.id=x.sale_id left join public.patients pt on pt.id=coalesce(p.patient_id,s.patient_id) join public.staff st on st.id=x.nurse_id where x.shift_id=p_shift and x.voided_at is null;
 select jsonb_build_object('cash',coalesce(sum(cash),0),'terminal',coalesce(sum(terminal),0),'owner_card',coalesce(sum(owner_card),0),'other_card',coalesce(sum(other_card),0),'total',coalesce(sum(cash+terminal+owner_card+other_card),0)) into r from private.crm_receipts_v10 where shift_id=p_shift and voided_at is null;
 return a||jsonb_build_object('procedures',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('procedure',p.id)||jsonb_build_object('paid_total',p.paid_total) order by coalesce(p.arrival_at,p.visit_at),p.id) from public.procedures p where p.shift_id=p_shift),'[]'),
  'sales',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('sale',s.id)||jsonb_build_object('paid_total',s.paid_total) order by coalesce(s.arrival_at,s.sold_at),s.id) from public.sales s where s.shift_id=p_shift),'[]'),
  'receipts',receipts_n,'debt_receipts_total',(r->>'total')::numeric,
  'cash_total',(a->'revenue'->>'total')::numeric+(r->>'total')::numeric,
  'charge_total',coalesce((select sum(charge_total) from public.procedures where shift_id=p_shift),0)+coalesce((select sum(charge_total) from public.sales where shift_id=p_shift),0),
  'debt_created_total',coalesce((select sum(charge_total-paid_total) from public.procedures where shift_id=p_shift),0)+coalesce((select sum(charge_total-paid_total) from public.sales where shift_id=p_shift),0),
  'debt_total',coalesce((select sum((private.crm_treatment_snapshot_v10('procedure',id)->>'debt_total')::numeric) from public.procedures where shift_id=p_shift),0)+coalesce((select sum((private.crm_treatment_snapshot_v10('sale',id)->>'debt_total')::numeric) from public.sales where shift_id=p_shift),0),
  'revenue',(a->'revenue')||jsonb_build_object('cash',(a->'revenue'->>'cash')::numeric+(r->>'cash')::numeric,'terminal',(a->'revenue'->>'terminal')::numeric+(r->>'terminal')::numeric,'owner_card',(a->'revenue'->>'owner_card')::numeric+(r->>'owner_card')::numeric,'other_card',(a->'revenue'->>'other_card')::numeric+(r->>'other_card')::numeric,'total',(a->'revenue'->>'total')::numeric+(r->>'total')::numeric),
  'cash_after_salary',case when(a->>'payroll_complete')::boolean then(a->'revenue'->>'total')::numeric+(r->>'total')::numeric-(a->>'payroll_total')::numeric end);
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_build_shift_report_v5_before_v30(p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare answer_n jsonb;initial_n jsonb;receipts_n jsonb;money_n jsonb;procedures_n jsonb;sales_n jsonb;loan_n numeric;pending_n numeric;created_n numeric;
begin
 answer_n:=private.crm_build_shift_report_v5_before_v29(p_shift);
 initial_n:=private.crm_build_shift_report_legacy_v9(p_shift)->'revenue';
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'record_id',coalesce(r.procedure_id,r.sale_id),
  'at',r.created_at,'patient_id',coalesce(p.patient_id,s.patient_id),'patient',coalesce(pt.full_name,'Без пациента'),
  'nurse_id',r.nurse_id,'nurse',st.full_name,'paid_total',r.cash+r.terminal+r.owner_card+r.other_card,
  'payments',jsonb_build_object('cash',r.cash,'terminal',r.terminal,'owner_card',r.owner_card,'other_card',r.other_card,'cash_received',r.cash_received,'change',r.change_amount),
  'comment',r.comment,'is_debt_repayment',false,'receipt_kind','after_procedure_payment') order by r.created_at,r.id),'[]') into receipts_n
 from private.crm_receipts_v10 r left join public.procedures p on p.id=r.procedure_id left join public.sales s on s.id=r.sale_id
  left join public.patients pt on pt.id=coalesce(p.patient_id,s.patient_id) left join public.staff st on st.id=r.nurse_id
 where r.shift_id=p_shift and r.voided_at is null and not r.is_debt_repayment;
 select jsonb_build_object('cash',(initial_n->>'cash')::numeric+coalesce(sum(r.cash),0),
  'terminal',(initial_n->>'terminal')::numeric+coalesce(sum(r.terminal),0),
  'owner_card',(initial_n->>'owner_card')::numeric+coalesce(sum(r.owner_card),0),
  'other_card',(initial_n->>'other_card')::numeric+coalesce(sum(r.other_card),0),
  'unclassified',coalesce((initial_n->>'unclassified')::numeric,0),
  'total',(initial_n->>'total')::numeric+coalesce(sum(r.cash+r.terminal+r.owner_card+r.other_card),0)) into money_n
 from private.crm_receipts_v10 r where r.shift_id=p_shift and r.voided_at is null and not r.is_debt_repayment;
 select coalesce(jsonb_agg(private.crm_shift_treatment_snapshot_v29('procedure',p.id) order by coalesce(p.arrival_at,p.visit_at),p.id),'[]') into procedures_n from public.procedures p where p.shift_id=p_shift;
 select coalesce(jsonb_agg(private.crm_shift_treatment_snapshot_v29('sale',s.id) order by coalesce(s.arrival_at,s.sold_at),s.id),'[]') into sales_n from public.sales s where s.shift_id=p_shift;
 select coalesce(sum((x->>'loan_debt_total')::numeric),0),coalesce(sum((x->>'pending_total')::numeric),0),
  coalesce(sum(case when coalesce((x->>'payment_pending')::boolean,false) then 0 else greatest((x->>'charge_total')::numeric-(x->>'received_total')::numeric,0) end),0)
 into loan_n,pending_n,created_n from jsonb_array_elements(procedures_n||sales_n) x;
 return answer_n||jsonb_build_object('procedures',procedures_n,'sales',sales_n,'receipts',receipts_n,'revenue',money_n,'cash_total',money_n->'total',
  'debt_total',loan_n,'loan_debt_total',loan_n,'pending_total',pending_n,'debt_created_total',created_n,
  'debt_receipts_total',coalesce((select sum((x->>'paid_total')::numeric) from jsonb_array_elements(receipts_n) x),0),
  'cash_after_salary',case when(answer_n->>'payroll_complete')::boolean then(money_n->>'total')::numeric-(answer_n->>'payroll_total')::numeric end);
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_clinical_v10(p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_n uuid;role_n text;kind_n text;id_n uuid;patient_n uuid;original_n jsonb;answer_n jsonb;items_n jsonb;
 req_n private.warehouse_requests%rowtype;amount_n numeric;date_n date;purpose_n text;pay_n jsonb;context_n text;sh_n uuid;
begin
 if p_action not in('debt_payment','debt_history','debts','treatment_edit') or p_action is null then
  return private.crm_clinical_v10_before_v29(p_action,p_payload,p_request_id);
 end if;
 select id,role into actor_n,role_n from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor_n is null or role_n not in('owner','admin','nurse') then raise exception 'Нет доступа' using errcode='42501';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Проверьте параметры';end if;
 if p_action='debts' then
  answer_n:=private.crm_clinical_v10_before_v29(p_action,p_payload,p_request_id);
  select coalesce(jsonb_agg(x order by x->>'at',x->>'id'),'[]') into items_n
   from jsonb_array_elements(answer_n->'debts') x where not coalesce((x->>'payment_pending')::boolean,false);
  return answer_n||jsonb_build_object('debts',items_n,
   'debt_total',coalesce((select sum((x->>'debt_total')::numeric) from jsonb_array_elements(items_n) x),0),
   'loan_debt_total',coalesce((select sum((x->>'debt_total')::numeric) from jsonb_array_elements(items_n) x),0),
   'pending_total',coalesce((select sum((x->>'debt_total')::numeric) from jsonb_array_elements(answer_n->'debts') x where coalesce((x->>'payment_pending')::boolean,false)),0));
 end if;
 kind_n:=coalesce(p_payload->>'kind','procedure');id_n:=nullif(p_payload->>'id','')::uuid;
 if kind_n not in('procedure','sale') then raise exception 'Неизвестная операция';end if;
 if p_action='debt_history' then
  patient_n:=nullif(p_payload->>'patient_id','')::uuid;
  if role_n='nurse' and patient_n is null and(id_n is null or not(p_payload?'kind')) then
   raise exception 'Выберите пациента или запись для истории погашений' using errcode='42501';
  end if;
  if patient_n is not null and not exists(select 1 from public.patients where id=patient_n and(deleted_at is null or private.is_manager())) then raise exception 'Пациент не найден';end if;
  if id_n is not null then
   original_n:=private.crm_treatment_snapshot_v10(kind_n,id_n);
   if role_n='nurse' and exists(select 1 from public.patients where id=nullif(original_n->>'patient_id','')::uuid and deleted_at is not null) then raise exception 'Пациент удалён. Обратитесь к владельцу';end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'record_id',coalesce(r.procedure_id,r.sale_id),
   'amount',r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount,'paid_on',r.paid_on,'purpose',r.purpose,
   'patient_id',coalesce(p.patient_id,s.patient_id),'patient',coalesce(pt.full_name,'Без пациента'),
   'nurse_id',r.nurse_id,'nurse',st.full_name,'created_at',r.created_at,'created_by',r.created_by,
   'is_debt_repayment',true,'receipt_kind','debt_repayment') order by r.paid_on desc,r.created_at desc,r.id),'[]') into items_n
  from private.crm_receipts_v10 r left join public.procedures p on p.id=r.procedure_id left join public.sales s on s.id=r.sale_id
   left join public.patients pt on pt.id=coalesce(p.patient_id,s.patient_id) left join public.staff st on st.id=r.nurse_id
  where r.is_debt_repayment and r.voided_at is null and(patient_n is null or coalesce(p.patient_id,s.patient_id)=patient_n)
   and(id_n is null or(r.kind=kind_n and coalesce(r.procedure_id,r.sale_id)=id_n))
   and(role_n<>'nurse' or pt.deleted_at is null);
  return jsonb_build_object('items',items_n,'total',coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(items_n) x),0));
 end if;
 if id_n is null then raise exception 'Выберите запись';end if;
 original_n:=private.crm_treatment_snapshot_v10(kind_n,id_n);
 if role_n='nurse' and exists(select 1 from public.patients where id=nullif(original_n->>'patient_id','')::uuid and deleted_at is not null) then raise exception 'Пациент удалён. Обратитесь к владельцу';end if;
 if p_action='treatment_edit' then
  context_n:=current_setting('crm.debt_receipt_context_v29',true);
  perform set_config('crm.debt_receipt_context_v29',jsonb_build_object('request_id',p_request_id,'payment_pending',coalesce((original_n->>'payment_pending')::boolean,false))::text,true);
  begin
   answer_n:=private.crm_clinical_v10_before_v29(p_action,p_payload,p_request_id);
  exception when others then
   perform set_config('crm.debt_receipt_context_v29',coalesce(context_n,''),true);raise;
  end;
  perform set_config('crm.debt_receipt_context_v29',coalesce(context_n,''),true);
  return answer_n;
 end if;
 if p_request_id is null then raise exception 'Нужен номер операции';end if;
 -- Check a completed request before consulting the current pending state: a
 -- full ordinary settlement clears that state and its retry remains ordinary.
 select * into req_n from private.warehouse_requests where id=p_request_id for update;
 if found then
  if req_n.staff_user is distinct from auth.uid() or req_n.action not in('clinical_v10_debt_payment','clinical_v29_debt_payment') or req_n.payload is distinct from p_payload then raise exception 'Номер операции уже использован';end if;
  if req_n.result is not null then return req_n.result;end if;
 end if;
 if coalesce((original_n->>'payment_pending')::boolean,false) then
  if p_payload?'amount' then raise exception 'Оплату после процедуры принимайте в открытую смену с указанием способа оплаты';end if;
  context_n:=current_setting('crm.debt_receipt_context_v29',true);
  perform set_config('crm.debt_receipt_context_v29',jsonb_build_object('request_id',p_request_id,'payment_pending',true)::text,true);
  begin answer_n:=private.crm_clinical_v10_before_v29(p_action,p_payload,p_request_id);
  exception when others then perform set_config('crm.debt_receipt_context_v29',coalesce(context_n,''),true);raise;end;
  perform set_config('crm.debt_receipt_context_v29',coalesce(context_n,''),true);
  return answer_n;
 end if;
 if p_payload?'amount' then
  if p_payload?'payments' then raise exception 'Укажите одну сумму погашения долга';end if;
  if jsonb_typeof(p_payload->'amount') not in('number','string') or coalesce(p_payload->>'amount','')!~'^[0-9]+([.][0-9]{1,2})?$' then raise exception 'Сумма должна быть положительной, с точностью до копейки';end if;
  amount_n:=(p_payload->>'amount')::numeric;
  if coalesce(p_payload->>'paid_on','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Укажите дату оплаты';end if;
  date_n:=(p_payload->>'paid_on')::date;
  if not isfinite(date_n) or to_char(date_n,'YYYY-MM-DD')<>(p_payload->>'paid_on') then raise exception 'Проверьте дату оплаты';end if;
  purpose_n:=nullif(trim(p_payload->>'purpose'),'');
  if jsonb_typeof(p_payload->'purpose') is distinct from 'string' or purpose_n is null or length(purpose_n)>2000 then raise exception 'Укажите назначение платежа (до 2000 символов)';end if;
 else
  -- Compatibility for released clients: their method allocation remains in
  -- the separate ledger and can never enter shift revenue or physical cash.
  pay_n:=private.crm_validate_payment_v10(coalesce(p_payload->'payments','{}'));
  amount_n:=(pay_n->>'total')::numeric;date_n:=(now() at time zone 'Europe/Moscow')::date;
  purpose_n:=coalesce(nullif(trim(p_payload->>'comment'),''),'Погашение долга');
 end if;
 if amount_n is null or amount_n<=0 or amount_n>999999999999.99 then raise exception 'Укажите положительную сумму погашения долга';end if;
 insert into private.warehouse_requests(id,staff_user,action,payload) values(p_request_id,auth.uid(),'clinical_v29_debt_payment',p_payload) on conflict do nothing;
 select * into req_n from private.warehouse_requests where id=p_request_id for update;
 if req_n.staff_user is distinct from auth.uid() or req_n.action<>'clinical_v29_debt_payment' or req_n.payload is distinct from p_payload then raise exception 'Номер операции уже использован';end if;
 if req_n.result is not null then return req_n.result;end if;
 sh_n:=(original_n->>'shift_id')::uuid;
 -- Same shift -> bill lock order as corrections and clinical edits. Closed
 -- shifts are valid: this lock does not attach the payment to their cash.
 perform 1 from public.shifts where id=sh_n for update;
 if kind_n='procedure' then perform 1 from public.procedures where id=id_n for update;
 else perform 1 from public.sales where id=id_n for update;end if;
 original_n:=private.crm_treatment_snapshot_v10(kind_n,id_n);
 if role_n='nurse' and exists(select 1 from public.patients where id=nullif(original_n->>'patient_id','')::uuid and deleted_at is not null) then raise exception 'Пациент удалён. Обратитесь к владельцу';end if;
 if coalesce((original_n->>'payment_pending')::boolean,false) then raise exception 'Состояние оплаты изменилось. Откройте запись заново';end if;
 if amount_n>(original_n->>'debt_total')::numeric then raise exception 'Оплата не должна превышать остаток долга';end if;
 insert into private.crm_receipts_v10(id,kind,procedure_id,sale_id,shift_id,nurse_id,cash,terminal,owner_card,other_card,cash_received,change_amount,
  created_by,comment,is_debt_repayment,unclassified_amount,paid_on,purpose)
 values(p_request_id,kind_n,case when kind_n='procedure' then id_n end,case when kind_n='sale' then id_n end,null,actor_n,
  coalesce((pay_n->>'cash')::numeric,0),coalesce((pay_n->>'terminal')::numeric,0),coalesce((pay_n->>'owner_card')::numeric,0),coalesce((pay_n->>'other_card')::numeric,0),
  coalesce((pay_n->>'cash_received')::numeric,0),coalesce((pay_n->>'change')::numeric,0),auth.uid(),purpose_n,true,
  case when pay_n is null then amount_n else 0 end,date_n,purpose_n);
 if kind_n='procedure' then update public.procedures set version=version+1 where id=id_n;
 else update public.sales set version=version+1 where id=id_n;end if;
 answer_n:=private.crm_treatment_snapshot_v10(kind_n,id_n)||jsonb_build_object('repayment_id',p_request_id,
  'repayment',jsonb_build_object('id',p_request_id,'amount',amount_n,'paid_on',date_n,'purpose',purpose_n));
 perform private.crm_audit_v5('debt_payment_v29',kind_n,id_n::text,original_n,answer_n,purpose_n);
 perform private.crm_refresh_closed_report_v10(sh_n);
 update private.warehouse_requests set result=answer_n where id=p_request_id;
 return answer_n;
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_dashboard_day_v25_before_v30(p_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare day_value date:=coalesce(p_date,(now() at time zone 'Europe/Moscow')::date);
 calendar_value jsonb;working_value jsonb;breakdown_value jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.staff
  where auth_user_id=auth.uid() and active and role in ('owner','admin')) then
  raise exception 'Финансовые отчёты доступны только администратору';
 end if;
 calendar_value:=private.crm_finance_summary_v5(jsonb_build_object('from',day_value,'to',day_value,'group_by','day'));

 with selected_shifts as materialized (
  select id,status from public.shifts where shift_date=day_value
 ), treatments as materialized (
  select 'procedure'::text kind,p.id,p.patient_id,p.paid_total,p.charge_total,p.payment_pending
   from public.procedures p join selected_shifts s on s.id=p.shift_id
  union all
  select 'sale',p.id,p.patient_id,p.paid_total,p.charge_total,p.payment_pending
   from public.sales p join selected_shifts s on s.id=p.shift_id
 ), repaid as (
  select t.kind,t.id,sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount) amount,
   coalesce(sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount) filter(where not r.is_debt_repayment),0) ordinary_amount
  from treatments t join private.crm_receipts_v10 r
   on r.voided_at is null and ((t.kind='procedure' and r.procedure_id=t.id)
    or(t.kind='sale' and r.sale_id=t.id)) group by t.kind,t.id
 ), bills as (
  select count(distinct t.patient_id) patients_count,
   count(*) filter(where t.kind='procedure') procedures_count,
   count(*) filter(where t.kind='sale') sales_count,
   coalesce(sum(t.charge_total),0) charge_total,
   coalesce(sum(case when t.payment_pending then 0 else greatest(0,t.charge_total-t.paid_total-coalesce(r.ordinary_amount,0)) end),0) debt_created_total,
   coalesce(sum(case when t.payment_pending then 0 else greatest(0,t.charge_total-t.paid_total-coalesce(r.amount,0)) end),0) debt_total,
   coalesce(sum(case when t.payment_pending then greatest(0,t.charge_total-t.paid_total-coalesce(r.amount,0)) else 0 end),0) pending_total
  from treatments t left join repaid r on r.kind=t.kind and r.id=t.id
 ), money as (
  -- Allocations are summed before joining a bill: payment history never
  -- multiplies patients, procedures or the original paid total.
  select coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,
   coalesce(a.owner_card,0) owner_card,coalesce(a.other_card,0) other_card,
   case when coalesce(a.entries,0)=0 then t.paid_total else 0 end unclassified,
   t.paid_total amount,false is_receipt
  from treatments t left join lateral (
   select count(*) entries,sum(a.cash) cash,sum(a.terminal) terminal,sum(a.owner_card) owner_card,sum(a.other_card) other_card
    from private.crm_payment_allocations a where a.voided_at is null
     and ((t.kind='procedure' and a.procedure_id=t.id)or(t.kind='sale' and a.sale_id=t.id))
  ) a on true
  union all
  select r.cash,r.terminal,r.owner_card,r.other_card,0::numeric,r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount,true
   from private.crm_receipts_v10 r join selected_shifts s on s.id=r.shift_id where r.voided_at is null and not r.is_debt_repayment
 ), income as (
  select coalesce(sum(cash),0) cash,coalesce(sum(terminal),0) terminal,coalesce(sum(owner_card),0) owner_card,coalesce(sum(other_card),0) other_card,
   coalesce(sum(unclassified),0) unclassified,coalesce(sum(amount),0) total,
   count(*) filter(where is_receipt) debt_payments_count,
   coalesce(sum(amount) filter(where is_receipt),0) debt_payments_total from money
 ), payroll as (
  select coalesce(sum(w.amount),0) amount from private.crm_shift_payroll w join selected_shifts s on s.id=w.shift_id
 ), unknown_payroll as (
  select count(*) amount from selected_shifts s join public.shift_staff ss on ss.shift_id=s.id
   join public.staff st on st.id=ss.staff_id left join private.crm_shift_payroll w on w.shift_id=s.id and w.staff_id=ss.staff_id
   where st.role='nurse' and w.shift_id is null
 )
 select jsonb_build_object('date',day_value,'basis','shift_date',
  'patients_count',b.patients_count,'procedures_count',b.procedures_count,'sales_count',b.sales_count,
  'charge_total',b.charge_total,'debt_created_total',b.debt_created_total,'debt_total',b.debt_total,'loan_debt_total',b.debt_total,'pending_total',b.pending_total,
  'debt_payments_count',i.debt_payments_count,'debt_payments_total',i.debt_payments_total,
  'revenue',jsonb_build_object('cash',i.cash,'terminal',i.terminal,'owner_card',i.owner_card,'other_card',i.other_card,'unclassified',i.unclassified,'total',i.total),
  'payroll_total',p.amount,'payroll_unknown',u.amount,'payroll_complete',u.amount=0,
  'cash_after_salary',case when u.amount=0 then i.total-p.amount end,
  'shift_count',(select count(*) from selected_shifts),
  'has_open_shifts',exists(select 1 from selected_shifts where status='open'))
 into working_value from bills b cross join income i cross join payroll p cross join unknown_payroll u;

 with treatments as (
  select 'procedure'::text kind,p.id,p.shift_id,p.visit_at recorded_at,p.paid_total from public.procedures p
  union all select 'sale',s.id,s.shift_id,s.sold_at,s.paid_total from public.sales s
 ), money as (
  select t.shift_id,coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,coalesce(a.owner_card,0) owner_card,coalesce(a.other_card,0) other_card,
   case when coalesce(a.entries,0)=0 then t.paid_total else 0 end unclassified,t.paid_total amount
  from treatments t left join lateral (
   select count(*) entries,sum(a.cash) cash,sum(a.terminal) terminal,sum(a.owner_card) owner_card,sum(a.other_card) other_card
    from private.crm_payment_allocations a where a.voided_at is null
     and ((t.kind='procedure' and a.procedure_id=t.id)or(t.kind='sale' and a.sale_id=t.id))
  ) a on true
  where t.recorded_at>=day_value::timestamp at time zone 'Europe/Moscow'
   and t.recorded_at<(day_value+1)::timestamp at time zone 'Europe/Moscow'
  union all
  select r.shift_id,r.cash,r.terminal,r.owner_card,r.other_card,0::numeric,r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount
   from private.crm_receipts_v10 r where r.voided_at is null and not r.is_debt_repayment
    and r.created_at>=day_value::timestamp at time zone 'Europe/Moscow'
    and r.created_at<(day_value+1)::timestamp at time zone 'Europe/Moscow'
 ), grouped as (
  select case when s.shift_date=day_value then 'current_day_shifts'
   when s.shift_date<day_value then 'previous_day_shifts' else 'other_day_shifts' end category,
   sum(m.cash) cash,sum(m.terminal) terminal,sum(m.owner_card) owner_card,sum(m.other_card) other_card,
   sum(m.unclassified) unclassified,sum(m.amount) total
  from money m left join public.shifts s on s.id=m.shift_id group by 1
 )
 select coalesce(jsonb_object_agg(category,jsonb_build_object('cash',cash,'terminal',terminal,
  'owner_card',owner_card,'other_card',other_card,'unclassified',unclassified,'total',total)),'{}'::jsonb) into breakdown_value from grouped;
 return jsonb_build_object('date',day_value,'time_zone','Europe/Moscow','working_day',working_value,
  'receipts_day',jsonb_build_object('date',day_value,'basis','recorded_receipt_date','revenue',calendar_value->'revenue',
   'debt_payments_count',calendar_value->'debt_payments_count','debt_payments_total',calendar_value->'debt_payments_total',
   'breakdown',breakdown_value));
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_finance_summary_v5_before_v28(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare tz text; first_day date; last_day date; grouping text:=coalesce(p_payload->>'group_by','day');
 employee uuid:=nullif(p_payload->>'employee_id','')::uuid; patient uuid:=nullif(p_payload->>'patient_id','')::uuid;
 medication uuid:=nullif(p_payload->>'medication_id','')::uuid; service uuid:=nullif(p_payload->>'service_id','')::uuid;
 answer jsonb; wages_n numeric; closed_wages numeric; open_wages numeric; shifts_n jsonb;
 complete_n boolean; unknown_n integer; has_open_n boolean;
 entity_filter boolean:=patient is not null or medication is not null or service is not null;
begin
 if auth.uid() is null or not private.is_manager() then raise exception 'Финансовые отчёты доступны только владельцу';end if;
 select time_zone into tz from private.crm_finance_settings where id;
 tz:=coalesce(tz,'Europe/Moscow');
 first_day:=coalesce(nullif(p_payload->>'from','')::date,(now() at time zone tz)::date);
 last_day:=coalesce(nullif(p_payload->>'to','')::date,first_day);
 if last_day<first_day or last_day-first_day>3660 then raise exception 'Проверьте период отчёта';end if;
 if grouping not in ('day','employee','patient','medication','service') then raise exception 'Неизвестная группировка';end if;
 with treatments as not materialized (
  select 'procedure'::text kind,p.id,p.shift_id,p.nurse_id,p.patient_id,p.service_id,p.procedure_type service_name,
   p.visit_at at,p.list_total,p.charge_total,p.paid_total,p.stock_deducted
  from public.procedures p
  union all
  select 'sale',s.id,s.shift_id,s.nurse_id,s.patient_id,null::uuid,'Продажа препаратов',
   s.sold_at,s.list_total,s.charge_total,s.paid_total,s.stock_deducted from public.sales s
 ), events as (
  select t.*,t.id event_id,false is_receipt,coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,
   coalesce(a.owner_card,0) owner_card,coalesce(a.other_card,0) other_card,case when a.id is null then t.paid_total else 0 end unclassified,
   greatest(0,t.charge_total-t.paid_total) debt_created_total,
   greatest(0,t.charge_total-t.paid_total-coalesce((select sum(r.cash+r.terminal+r.owner_card+r.other_card)
    from private.crm_receipts_v10 r where r.voided_at is null and ((t.kind='procedure' and r.procedure_id=t.id)
     or (t.kind='sale' and r.sale_id=t.id))),0)) debt_total
  from treatments t left join private.crm_payment_allocations a
   on a.voided_at is null and ((t.kind='procedure' and a.procedure_id=t.id) or (t.kind='sale' and a.sale_id=t.id))
  where t.at>=first_day::timestamp at time zone tz and t.at<(last_day+1)::timestamp at time zone tz
  union all
  select t.kind,t.id,r.shift_id,r.nurse_id,t.patient_id,t.service_id,t.service_name,r.created_at,
   t.list_total,0::numeric,r.cash+r.terminal+r.owner_card+r.other_card,t.stock_deducted,
   r.id,true,r.cash,r.terminal,r.owner_card,r.other_card,0::numeric,0::numeric,0::numeric
  from private.crm_receipts_v10 r join treatments t
   on (r.kind='procedure' and t.kind='procedure' and r.procedure_id=t.id)
    or (r.kind='sale' and t.kind='sale' and r.sale_id=t.id)
  where r.voided_at is null and r.created_at>=first_day::timestamp at time zone tz and r.created_at<(last_day+1)::timestamp at time zone tz
 ), filtered as (
  select e.* from events e
  where (employee is null or e.nurse_id=employee) and (patient is null or e.patient_id=patient)
   and (service is null or e.service_id=service or (e.kind='procedure' and exists(
    select 1 from private.crm_treatment_services ts where ts.procedure_id=e.id and ts.service_id=service)))
   and (medication is null or (e.kind='procedure' and exists(
    select 1 from public.procedure_medications pm where pm.procedure_id=e.id and pm.medication_id=medication))
    or (e.kind='sale' and exists(select 1 from public.sale_items si where si.sale_id=e.id and si.medication_id=medication)))
 ), grouped_source as (
  select f.*,case grouping when 'day' then (f.at at time zone tz)::date::text
    when 'employee' then f.nurse_id::text when 'patient' then coalesce(f.patient_id::text,'no_patient') end group_id,
   case grouping when 'day' then (f.at at time zone tz)::date::text
    when 'employee' then coalesce(st.full_name,'Сотрудник') when 'patient' then coalesce(pt.full_name,'Без пациента') end label,
   1::numeric share,0::numeric quantity
  from filtered f left join public.staff st on st.id=f.nurse_id left join public.patients pt on pt.id=f.patient_id
  where grouping in ('day','employee','patient')
  union all
  select f.*,m.id::text,m.name,
   case when f.list_total>0 then lines.line_total/f.list_total else 0 end,
   case when f.is_receipt then 0 else lines.quantity end
  from filtered f join lateral (
   select medication_id,sum(line_total) line_total,sum(quantity) quantity from public.procedure_medications
    where f.kind='procedure' and procedure_id=f.id group by medication_id
   union all select medication_id,sum(line_total),sum(quantity) from public.sale_items
    where f.kind='sale' and sale_id=f.id group by medication_id
  ) lines on true join public.medications m on m.id=lines.medication_id
  where grouping='medication' and (medication is null or m.id=medication)
  union all
  select f.*,coalesce(lines.service_id::text,'sale'),lines.name,
   case when lines.total>0 then lines.line_total/lines.total
    else lines.quantity/nullif(lines.total_quantity,0) end,
   case when f.is_receipt then 0 else lines.quantity end
  from filtered f join lateral (
   select src.*,sum(src.line_total) over() total,sum(src.quantity) over() total_quantity from (
    select ts.service_id,ts.name,sum(ts.quantity)::numeric quantity,
     sum(ts.quantity*(ts.work_price+ts.consumables_price)) line_total
    from private.crm_treatment_services ts where f.kind='procedure' and ts.procedure_id=f.id
    group by ts.service_id,ts.name
    union all select f.service_id,f.service_name,1::numeric,1::numeric
     where f.kind='sale' or not exists(select 1 from private.crm_treatment_services ts where ts.procedure_id=f.id)
   ) src
  ) lines on true where grouping='service' and (service is null or lines.service_id=service)
 ), grouped as (
  select group_id,label,count(distinct patient_id) patients_count,
   count(distinct id) filter(where kind='procedure' and not is_receipt) procedures_count,
   count(distinct id) filter(where kind='sale' and not is_receipt) sales_count,
   count(distinct id) filter(where kind='procedure' and not is_receipt and not stock_deducted) payment_only_procedures_count,
   count(distinct id) filter(where kind='sale' and not is_receipt and not stock_deducted) payment_only_sales_count,
   count(distinct event_id) filter(where is_receipt) debt_payments_count,
   sum(quantity) quantity,round(sum(cash*share),2) cash,round(sum(terminal*share),2) terminal,
   round(sum(owner_card*share),2) owner_card,round(sum(other_card*share),2) other_card,round(sum(unclassified*share),2) unclassified,
   round(sum(paid_total*share),2) total,round(sum(charge_total*share),2) charge_total,
   round(sum(debt_total*share),2) debt_total,round(sum(debt_created_total*share),2) debt_created_total,
   round(sum(paid_total*share) filter(where is_receipt),2) debt_payments_total
  from grouped_source group by group_id,label
 )
 select jsonb_build_object('from',first_day,'to',last_day,'time_zone',tz,'group_by',grouping,
  'patients_count',(select count(distinct patient_id) from filtered),
  'procedures_count',(select count(*) from filtered where kind='procedure' and not is_receipt),
  'sales_count',(select count(*) from filtered where kind='sale' and not is_receipt),
  'payment_only_procedures_count',(select count(*) from filtered where kind='procedure' and not is_receipt and not stock_deducted),
  'payment_only_sales_count',(select count(*) from filtered where kind='sale' and not is_receipt and not stock_deducted),
  'debt_payments_count',(select count(*) from filtered where is_receipt),
  'charge_total',(select coalesce(sum(charge_total),0) from filtered),
  'debt_total',(select coalesce(sum(debt_total),0) from filtered),
  'debt_created_total',(select coalesce(sum(debt_created_total),0) from filtered),
  'debt_payments_total',(select coalesce(sum(paid_total) filter(where is_receipt),0) from filtered),
  'debt_balance_basis','current_balance_of_bills_in_period',
  'revenue',(select jsonb_build_object('cash',coalesce(sum(cash),0),'terminal',coalesce(sum(terminal),0),
   'owner_card',coalesce(sum(owner_card),0),'other_card',coalesce(sum(other_card),0),'unclassified',coalesce(sum(unclassified),0),'total',coalesce(sum(paid_total),0)) from filtered),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',group_id,'label',label,'patients_count',patients_count,
   'procedures_count',procedures_count,'sales_count',sales_count,'quantity',quantity,
   'payment_only_procedures_count',payment_only_procedures_count,'payment_only_sales_count',payment_only_sales_count,
   'charge_total',charge_total,'debt_total',debt_total,'debt_created_total',debt_created_total,
   'debt_payments_count',debt_payments_count,'debt_payments_total',coalesce(debt_payments_total,0),
   'revenue',jsonb_build_object('cash',cash,'terminal',terminal,'owner_card',owner_card,'other_card',other_card,'unclassified',unclassified,'total',total))
    order by label,group_id) from grouped),'[]'::jsonb),
  'rows_revenue_basis',case when grouping='medication' then 'medication_line_share_of_paid_total'
   when grouping='service' then 'service_share_of_receipts' else 'actual_receipts_in_period' end
 ) into answer;
 select coalesce(sum(w.amount),0),coalesce(sum(w.amount) filter(where s.status='closed'),0),
  coalesce(sum(w.amount) filter(where s.status='open'),0)
 into wages_n,closed_wages,open_wages from private.crm_shift_payroll w join public.shifts s on s.id=w.shift_id
 where s.shift_date between first_day and last_day and(employee is null or w.staff_id=employee);
 select count(*) into unknown_n from public.shift_staff ss join public.shifts s on s.id=ss.shift_id join public.staff st on st.id=ss.staff_id
  left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id
  where s.shift_date between first_day and last_day and st.role='nurse' and w.shift_id is null and(employee is null or ss.staff_id=employee);
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'shift_date',s.shift_date,'started_at',s.started_at,
  'ended_at',s.ended_at,'status',s.status,'slot',s.daily_slot,
  'staff',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id
   left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=s.id),'[]'::jsonb),
  'payroll_total',coalesce((select sum(amount) from private.crm_shift_payroll where shift_id=s.id),0),
  'payroll_complete',not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id
   left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id
   where ss.shift_id=s.id and st.role='nurse' and w.shift_id is null)) order by s.shift_date desc,s.started_at desc),'[]'::jsonb) into shifts_n
 from public.shifts s where s.shift_date between first_day and last_day
  and(employee is null or exists(select 1 from public.shift_staff where shift_id=s.id and staff_id=employee));
 select not exists(select 1 from public.shifts where shift_date between first_day and last_day
  group by shift_date having count(*)<>2 or not bool_and(status='closed')) into complete_n;
 select exists(select 1 from public.shifts where shift_date between first_day and last_day and status='open') into has_open_n;
 return answer||jsonb_build_object('payroll_total',case when not entity_filter then wages_n end,
  'payroll_closed',case when not entity_filter then closed_wages end,'payroll_open',case when not entity_filter then open_wages end,
  'payroll_scope',case when entity_filter then 'not_applicable_to_entity_filter'
   when employee is null then 'all_period_shifts' else 'employee_period_shifts' end,
  'payroll_unknown',case when not entity_filter then unknown_n end,'payroll_complete',case when not entity_filter then unknown_n=0 end,
  'cash_after_salary',case when not entity_filter and unknown_n=0 then (answer->'revenue'->>'total')::numeric-wages_n end,
  'days_complete',complete_n,'has_open_shifts',has_open_n,'shifts',shifts_n);
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_finance_summary_v5_before_v30(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare tz text; first_day date; last_day date; grouping text:=coalesce(p_payload->>'group_by','day');
 employee uuid:=nullif(p_payload->>'employee_id','')::uuid; patient uuid:=nullif(p_payload->>'patient_id','')::uuid;
 medication uuid:=nullif(p_payload->>'medication_id','')::uuid; service uuid:=nullif(p_payload->>'service_id','')::uuid;
 answer jsonb; wages_n numeric; closed_wages numeric; open_wages numeric; shifts_n jsonb;
 complete_n boolean; unknown_n integer; has_open_n boolean;
 entity_filter boolean:=patient is not null or medication is not null or service is not null;
begin
 if auth.uid() is null or not private.is_manager() then raise exception 'Финансовые отчёты доступны только владельцу';end if;
 select time_zone into tz from private.crm_finance_settings where id;
 tz:=coalesce(tz,'Europe/Moscow');
 first_day:=coalesce(nullif(p_payload->>'from','')::date,(now() at time zone tz)::date);
 last_day:=coalesce(nullif(p_payload->>'to','')::date,first_day);
 if last_day<first_day or last_day-first_day>3660 then raise exception 'Проверьте период отчёта';end if;
 if grouping not in ('day','employee','patient','medication','service') then raise exception 'Неизвестная группировка';end if;
 with treatments as not materialized (
  select 'procedure'::text kind,p.id,p.shift_id,p.nurse_id,p.patient_id,p.service_id,p.procedure_type service_name,
   p.visit_at at,p.list_total,p.charge_total,p.paid_total,(p.stock_deducted or exists(select 1 from private.crm_partial_stock_records_v28 pr where pr.kind='procedure' and pr.record_id=p.id)) stock_deducted,p.payment_pending
  from public.procedures p
  union all
  select 'sale',s.id,s.shift_id,s.nurse_id,s.patient_id,null::uuid,'Продажа препаратов',
   s.sold_at,s.list_total,s.charge_total,s.paid_total,(s.stock_deducted or exists(select 1 from private.crm_partial_stock_records_v28 sr where sr.kind='sale' and sr.record_id=s.id)),s.payment_pending from public.sales s
 ), events as (
  select t.*,t.id event_id,false is_receipt,coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,
   coalesce(a.owner_card,0) owner_card,coalesce(a.other_card,0) other_card,case when a.id is null then t.paid_total else 0 end unclassified,
   case when t.payment_pending then 0 else greatest(0,t.charge_total-t.paid_total-coalesce((select sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount)
    from private.crm_receipts_v10 r where r.voided_at is null and not r.is_debt_repayment and ((t.kind='procedure' and r.procedure_id=t.id)
     or (t.kind='sale' and r.sale_id=t.id))),0)) end debt_created_total,
   case when t.payment_pending then 0 else greatest(0,t.charge_total-t.paid_total-coalesce((select sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount)
    from private.crm_receipts_v10 r where r.voided_at is null and ((t.kind='procedure' and r.procedure_id=t.id)
     or (t.kind='sale' and r.sale_id=t.id))),0)) end debt_total,
   case when t.payment_pending then greatest(0,t.charge_total-t.paid_total-coalesce((select sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount)
    from private.crm_receipts_v10 r where r.voided_at is null and ((t.kind='procedure' and r.procedure_id=t.id)
     or (t.kind='sale' and r.sale_id=t.id))),0)) else 0 end pending_total
  from treatments t left join private.crm_payment_allocations a
   on a.voided_at is null and ((t.kind='procedure' and a.procedure_id=t.id) or (t.kind='sale' and a.sale_id=t.id))
  where t.at>=first_day::timestamp at time zone tz and t.at<(last_day+1)::timestamp at time zone tz
  union all
  select t.kind,t.id,r.shift_id,r.nurse_id,t.patient_id,t.service_id,t.service_name,r.created_at,
   t.list_total,0::numeric,r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount,t.stock_deducted,t.payment_pending,
   r.id,true,r.cash,r.terminal,r.owner_card,r.other_card,0::numeric,0::numeric,0::numeric,0::numeric
  from private.crm_receipts_v10 r join treatments t
   on (r.kind='procedure' and t.kind='procedure' and r.procedure_id=t.id)
    or (r.kind='sale' and t.kind='sale' and r.sale_id=t.id)
  where r.voided_at is null and not r.is_debt_repayment and r.created_at>=first_day::timestamp at time zone tz and r.created_at<(last_day+1)::timestamp at time zone tz
 ), filtered as (
  select e.* from events e
  where (employee is null or e.nurse_id=employee) and (patient is null or e.patient_id=patient)
   and (service is null or e.service_id=service or (e.kind='procedure' and exists(
    select 1 from private.crm_treatment_services ts where ts.procedure_id=e.id and ts.service_id=service)))
   and (medication is null or (e.kind='procedure' and exists(
    select 1 from public.procedure_medications pm where pm.procedure_id=e.id and pm.medication_id=medication))
    or (e.kind='sale' and exists(select 1 from public.sale_items si where si.sale_id=e.id and si.medication_id=medication)))
 ), grouped_source as (
  select f.*,case grouping when 'day' then (f.at at time zone tz)::date::text
    when 'employee' then f.nurse_id::text when 'patient' then coalesce(f.patient_id::text,'no_patient') end group_id,
   case grouping when 'day' then (f.at at time zone tz)::date::text
    when 'employee' then coalesce(st.full_name,'Сотрудник') when 'patient' then coalesce(pt.full_name,'Без пациента') end label,
   1::numeric share,0::numeric quantity
  from filtered f left join public.staff st on st.id=f.nurse_id left join public.patients pt on pt.id=f.patient_id
  where grouping in ('day','employee','patient')
  union all
  select f.*,m.id::text,m.name,
   case when f.list_total>0 then lines.line_total/f.list_total else 0 end,
   case when f.is_receipt then 0 else lines.quantity end
  from filtered f join lateral (
   select medication_id,sum(line_total) line_total,sum(quantity) quantity from public.procedure_medications
    where f.kind='procedure' and procedure_id=f.id group by medication_id
   union all select medication_id,sum(line_total),sum(quantity) from public.sale_items
    where f.kind='sale' and sale_id=f.id group by medication_id
  ) lines on true join public.medications m on m.id=lines.medication_id
  where grouping='medication' and (medication is null or m.id=medication)
  union all
  select f.*,coalesce(lines.service_id::text,'sale'),lines.name,
   case when lines.total>0 then lines.line_total/lines.total
    else lines.quantity/nullif(lines.total_quantity,0) end,
   case when f.is_receipt then 0 else lines.quantity end
  from filtered f join lateral (
   select src.*,sum(src.line_total) over() total,sum(src.quantity) over() total_quantity from (
    select ts.service_id,ts.name,sum(ts.quantity)::numeric quantity,
     sum(ts.quantity*(ts.work_price+ts.consumables_price)) line_total
    from private.crm_treatment_services ts where f.kind='procedure' and ts.procedure_id=f.id
    group by ts.service_id,ts.name
    union all select f.service_id,f.service_name,1::numeric,1::numeric
     where f.kind='sale' or not exists(select 1 from private.crm_treatment_services ts where ts.procedure_id=f.id)
   ) src
  ) lines on true where grouping='service' and (service is null or lines.service_id=service)
 ), grouped as (
  select group_id,label,count(distinct patient_id) patients_count,
   count(distinct id) filter(where kind='procedure' and not is_receipt) procedures_count,
   count(distinct id) filter(where kind='sale' and not is_receipt) sales_count,
   count(distinct id) filter(where kind='procedure' and not is_receipt and not stock_deducted) payment_only_procedures_count,
   count(distinct id) filter(where kind='sale' and not is_receipt and not stock_deducted) payment_only_sales_count,
   count(distinct event_id) filter(where is_receipt) debt_payments_count,
   sum(quantity) quantity,round(sum(cash*share),2) cash,round(sum(terminal*share),2) terminal,
   round(sum(owner_card*share),2) owner_card,round(sum(other_card*share),2) other_card,round(sum(unclassified*share),2) unclassified,
   round(sum(paid_total*share),2) total,round(sum(charge_total*share),2) charge_total,
   round(sum(debt_total*share),2) debt_total,round(sum(pending_total*share),2) pending_total,round(sum(debt_created_total*share),2) debt_created_total,
   round(sum(paid_total*share) filter(where is_receipt),2) debt_payments_total
  from grouped_source group by group_id,label
 )
 select jsonb_build_object('from',first_day,'to',last_day,'time_zone',tz,'group_by',grouping,
  'patients_count',(select count(distinct patient_id) from filtered),
  'procedures_count',(select count(*) from filtered where kind='procedure' and not is_receipt),
  'sales_count',(select count(*) from filtered where kind='sale' and not is_receipt),
  'payment_only_procedures_count',(select count(*) from filtered where kind='procedure' and not is_receipt and not stock_deducted),
  'payment_only_sales_count',(select count(*) from filtered where kind='sale' and not is_receipt and not stock_deducted),
  'debt_payments_count',(select count(*) from filtered where is_receipt),
  'charge_total',(select coalesce(sum(charge_total),0) from filtered),
  'debt_total',(select coalesce(sum(debt_total),0) from filtered),
  'loan_debt_total',(select coalesce(sum(debt_total),0) from filtered),'pending_total',(select coalesce(sum(pending_total),0) from filtered),
  'debt_created_total',(select coalesce(sum(debt_created_total),0) from filtered),
  'debt_payments_total',(select coalesce(sum(paid_total) filter(where is_receipt),0) from filtered),
  'debt_balance_basis','current_balance_of_bills_in_period',
  'revenue',(select jsonb_build_object('cash',coalesce(sum(cash),0),'terminal',coalesce(sum(terminal),0),
   'owner_card',coalesce(sum(owner_card),0),'other_card',coalesce(sum(other_card),0),'unclassified',coalesce(sum(unclassified),0),'total',coalesce(sum(paid_total),0)) from filtered),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',group_id,'label',label,'patients_count',patients_count,
   'procedures_count',procedures_count,'sales_count',sales_count,'quantity',quantity,
   'payment_only_procedures_count',payment_only_procedures_count,'payment_only_sales_count',payment_only_sales_count,
   'charge_total',charge_total,'debt_total',debt_total,'loan_debt_total',debt_total,'pending_total',pending_total,'debt_created_total',debt_created_total,
   'debt_payments_count',debt_payments_count,'debt_payments_total',coalesce(debt_payments_total,0),
   'revenue',jsonb_build_object('cash',cash,'terminal',terminal,'owner_card',owner_card,'other_card',other_card,'unclassified',unclassified,'total',total))
    order by label,group_id) from grouped),'[]'::jsonb),
  'rows_revenue_basis',case when grouping='medication' then 'medication_line_share_of_paid_total'
   when grouping='service' then 'service_share_of_receipts' else 'actual_receipts_in_period' end
 ) into answer;
 select coalesce(sum(w.amount),0),coalesce(sum(w.amount) filter(where s.status='closed'),0),
  coalesce(sum(w.amount) filter(where s.status='open'),0)
 into wages_n,closed_wages,open_wages from private.crm_shift_payroll w join public.shifts s on s.id=w.shift_id
 where s.shift_date between first_day and last_day and(employee is null or w.staff_id=employee);
 select count(*) into unknown_n from public.shift_staff ss join public.shifts s on s.id=ss.shift_id join public.staff st on st.id=ss.staff_id
  left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id
  where s.shift_date between first_day and last_day and st.role='nurse' and w.shift_id is null and(employee is null or ss.staff_id=employee);
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'shift_date',s.shift_date,'started_at',s.started_at,
  'ended_at',s.ended_at,'status',s.status,'slot',s.daily_slot,
  'staff',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id
   left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=s.id),'[]'::jsonb),
  'payroll_total',coalesce((select sum(amount) from private.crm_shift_payroll where shift_id=s.id),0),
  'payroll_complete',not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id
   left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id
   where ss.shift_id=s.id and st.role='nurse' and w.shift_id is null)) order by s.shift_date desc,s.started_at desc),'[]'::jsonb) into shifts_n
 from public.shifts s where s.shift_date between first_day and last_day
  and(employee is null or exists(select 1 from public.shift_staff where shift_id=s.id and staff_id=employee));
 select not exists(select 1 from public.shifts where shift_date between first_day and last_day
  group by shift_date having count(*)<>2 or not bool_and(status='closed')) into complete_n;
 select exists(select 1 from public.shifts where shift_date between first_day and last_day and status='open') into has_open_n;
 return answer||jsonb_build_object('payroll_total',case when not entity_filter then wages_n end,
  'payroll_closed',case when not entity_filter then closed_wages end,'payroll_open',case when not entity_filter then open_wages end,
  'payroll_scope',case when entity_filter then 'not_applicable_to_entity_filter'
   when employee is null then 'all_period_shifts' else 'employee_period_shifts' end,
  'payroll_unknown',case when not entity_filter then unknown_n end,'payroll_complete',case when not entity_filter then unknown_n=0 end,
  'cash_after_salary',case when not entity_filter and unknown_n=0 then (answer->'revenue'->>'total')::numeric-wages_n end,
  'days_complete',complete_n,'has_open_shifts',has_open_n,'shifts',shifts_n);
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_payment_correction_v22(p_payload jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor_user_n uuid:=auth.uid();actor_staff_n uuid;role_n text;kind_n text;id_n uuid;
 req_n private.warehouse_requests%rowtype;original_n jsonb;answer_n jsonb;pay_n jsonb;
 reason_n text;expected_received_n numeric;initial_n jsonb;receipts_n jsonb;
 shift_ids_n uuid[];shift_n uuid;inner_payload_n jsonb;inner_request_n uuid:=gen_random_uuid();
begin
 -- Check live access before returning even a previously successful result.
 if actor_user_n is null then raise exception 'Войдите в программу' using errcode='42501';end if;
 select s.id,s.role into actor_staff_n,role_n from public.staff s
  where s.auth_user_id=actor_user_n and s.active and s.role in ('owner','admin') limit 1 for share;
 if actor_staff_n is null then
  raise exception 'Ошибочную оплату исправляет только администратор или владелец' using errcode='42501';
 end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Проверьте параметры исправления оплаты' using errcode='22023';
 end if;
 if p_payload->'confirm_no_money_received' is distinct from 'true'::jsonb then
  raise exception 'Подтвердите, что оплата отмечена ошибочно и деньги не получены' using errcode='22023';
 end if;
 reason_n:=nullif(trim(p_payload->>'correction_reason'),'');
 if reason_n is null or length(reason_n)>2000 then
  raise exception 'Укажите причину исправления ошибочной оплаты' using errcode='22023';
 end if;
 kind_n:=p_payload->>'kind';id_n:=nullif(p_payload->>'id','')::uuid;
 if kind_n is null or kind_n not in ('procedure','sale') or id_n is null then
  raise exception 'Выберите сохранённую процедуру или продажу' using errcode='22023';
 end if;
 if coalesce(p_payload->>'expected_received_total','') !~ '^\d+(\.\d{1,2})?$' then
  raise exception 'Обновите запись: не указана ранее сохранённая оплата' using errcode='22023';
 end if;
 expected_received_n:=(p_payload->>'expected_received_total')::numeric;
 if expected_received_n<=0 or expected_received_n>9999999999.99 then
  raise exception 'В записи нет оплаты для исправления' using errcode='22023';
 end if;
 if coalesce(p_payload->>'expected_version','') !~ '^[1-9][0-9]*$' then
  raise exception 'Обновите запись: не указана её версия' using errcode='22023';
 end if;
 if p_payload->>'payment_status' is distinct from 'debt' then
  raise exception 'После исправления выберите сохранение в долг' using errcode='22023';
 end if;
 pay_n:=private.crm_validate_payment_v10(p_payload->'payments');
 if (pay_n->>'total')::numeric<>0 or (pay_n->>'cash_received')::numeric<>0
  or coalesce((p_payload->>'paid_total')::numeric,0)<>0 then
  raise exception 'При исправлении ошибочной оплаты новая оплата должна быть 0 ₽' using errcode='22023';
 end if;

 -- The UUID owns the whole correction, including its delegated clinical edit.
 insert into private.warehouse_requests(id,staff_user,action,payload)
  values(p_request_id,actor_user_n,'payment_correction_v22',p_payload) on conflict do nothing;
 select r.* into req_n from private.warehouse_requests r where r.id=p_request_id for update;
 if req_n.staff_user<>actor_user_n or req_n.action<>'payment_correction_v22' or req_n.payload<>p_payload then
  raise exception 'Номер операции уже использован' using errcode='22023';
 end if;
 if req_n.result is not null then return req_n.result;end if;
 original_n:=private.crm_treatment_snapshot_v10(kind_n,id_n);
 if kind_n='procedure' and nullif(original_n->>'patient_id','') is null then
  raise exception 'Для сохранения долга нужен пациент' using errcode='22023';
 end if;

 -- The same shift->treatment lock order is used by ordinary edits and receipts.
 -- A version check after these locks rejects any receipt arriving in between.
 select array_agg(distinct x.shift_id order by x.shift_id) into shift_ids_n from (
  select (original_n->>'shift_id')::uuid shift_id
  union all select r.shift_id from private.crm_receipts_v10 r where r.voided_at is null
   and ((kind_n='procedure' and r.procedure_id=id_n) or (kind_n='sale' and r.sale_id=id_n))
 ) x;
 perform 1 from public.shifts s where s.id=any(shift_ids_n) order by s.id for update;
 if kind_n='procedure' then perform 1 from public.procedures p where p.id=id_n for update;
 else perform 1 from public.sales s where s.id=id_n for update;end if;
 original_n:=private.crm_treatment_snapshot_v10(kind_n,id_n);
 if (p_payload->>'expected_version')::integer<>(original_n->>'version')::integer
  or expected_received_n<>(original_n->>'paid_total')::numeric then
  raise exception 'Запись или оплата уже изменена. Откройте её заново' using errcode='40001';
 end if;
 -- Historical manager corrections keep the existing clinical edit policy:
 -- an archived/deleted patient may still have retained procedures and debts.
 if nullif(original_n->>'patient_id','') is not null then
  perform 1 from public.patients p where p.id=(original_n->>'patient_id')::uuid for share;
  if not found then raise exception 'Пациент не найден' using errcode='22023';end if;
 end if;
 perform 1 from private.crm_payment_allocations a
  where (kind_n='procedure' and a.procedure_id=id_n) or (kind_n='sale' and a.sale_id=id_n)
  order by a.id for update;
 perform 1 from private.crm_receipts_v10 r
  where (kind_n='procedure' and r.procedure_id=id_n) or (kind_n='sale' and r.sale_id=id_n)
  order by r.id for update;
 select to_jsonb(a) into initial_n from private.crm_payment_allocations a
  where a.voided_at is null and ((kind_n='procedure' and a.procedure_id=id_n) or (kind_n='sale' and a.sale_id=id_n));
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]'::jsonb) into receipts_n
  from private.crm_receipts_v10 r where r.voided_at is null
   and ((kind_n='procedure' and r.procedure_id=id_n) or (kind_n='sale' and r.sale_id=id_n));

 -- Retain every original payment amount, method, actor and timestamp for audit.
 update private.crm_payment_allocations a set voided_at=now(),voided_by=actor_user_n,
  void_reason=reason_n,void_request_id=p_request_id
  where a.voided_at is null and ((kind_n='procedure' and a.procedure_id=id_n) or (kind_n='sale' and a.sale_id=id_n));
 update private.crm_receipts_v10 r set voided_at=now(),voided_by=actor_user_n,
  void_reason=reason_n,void_request_id=p_request_id
  where r.voided_at is null and ((kind_n='procedure' and r.procedure_id=id_n) or (kind_n='sale' and r.sale_id=id_n));
 if kind_n='procedure' then update public.procedures set paid_total=0 where id=id_n;
 else update public.sales set paid_total=0 where id=id_n;end if;

 -- Keep all existing composition, discount, stock-difference and version checks.
 -- A failure below rolls back the void markers and initial-paid change as well.
 inner_payload_n:=p_payload-array['confirm_no_money_received','correction_reason','expected_received_total',
  'payment_shift_id','payment_nurse_id','payment_comment'];
 inner_payload_n:=inner_payload_n||jsonb_build_object('edit_reason',reason_n,'paid_total',0,'payments',
  jsonb_build_object('cash',0,'terminal',0,'owner_card',0,'other_card',0,'cash_received',0));
 answer_n:=private.crm_clinical_v10('treatment_edit',inner_payload_n,inner_request_n);
 if (answer_n->>'paid_total')::numeric<>0 or (answer_n->>'debt_total')::numeric<=0 then
  raise exception 'Проверьте стоимость для сохранения долга' using errcode='22023';
 end if;
 answer_n:=answer_n||jsonb_build_object('payment_correction',jsonb_build_object(
  'previous_received_total',expected_received_n,'new_received_total',0,'reason',reason_n));
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,before_data,after_data,reason)
  values(actor_user_n,actor_staff_n,'payment_corrected_v22',kind_n,id_n::text,
   jsonb_build_object('treatment',original_n,'allocation',initial_n,'receipts',receipts_n),answer_n,reason_n);
 -- A later mistaken receipt may belong to a different already-closed shift.
 foreach shift_n in array shift_ids_n loop perform private.crm_refresh_closed_report_v10(shift_n);end loop;
 update private.warehouse_requests set result=answer_n where id=p_request_id;
 return answer_n;
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_record_treatment_v10_before_v28(p_kind text, p_payload jsonb, p_request_id uuid, p_allocated boolean DEFAULT true)
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
 if p_kind='procedure' and paid_n<(data_n->>'charge_total')::numeric and patient is null then raise exception 'Для оплаты в долг выберите пациента';end if;
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
  insert into private.crm_payment_allocations(id,kind,procedure_id,sale_id,cash,terminal,owner_card,other_card,cash_received,change_amount,created_by) values(p_request_id,p_kind,case when p_kind='procedure' then id_n end,case when p_kind='sale' then id_n end,(pay->>'cash')::numeric,(pay->>'terminal')::numeric,(pay->>'owner_card')::numeric,(pay->>'other_card')::numeric,(pay->>'cash_received')::numeric,(pay->>'change')::numeric,auth.uid());
 end if;
 answer:=private.crm_treatment_snapshot_v10(p_kind,id_n)||jsonb_build_object('payments',pay);
 update private.warehouse_requests set result=answer where id=p_request_id;
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,after_data) values(auth.uid(),actor,'treatment_recorded_v10',p_kind,id_n::text,answer);
 return answer;
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_treatment_snapshot_v10_before_v28(p_kind text, p_id uuid)
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
  select coalesce(sum(cash+terminal+owner_card+other_card+unclassified_amount),0) into more_n from private.crm_receipts_v10 where procedure_id=p_id and voided_at is null;
 elsif p_kind='sale' then
  select to_jsonb(s)||jsonb_build_object('kind','sale','at',coalesce(s.arrival_at,s.sold_at),'sold_at',coalesce(s.arrival_at,s.sold_at),'recorded_at',coalesce((to_jsonb(s)->>'created_at')::timestamptz,s.sold_at),'patient',coalesce(pt.full_name,'Без пациента'),'nurse',st.full_name,'services','[]'::jsonb,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'medication_id',m.id,'name',m.name,'quantity',si.quantity,'dose',si.dose,'unit',m.consumption_unit,'unit_price',si.unit_price,'line_total',si.line_total) order by m.name,m.id) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]'),
   'own_medications','[]'::jsonb) into a from public.sales s left join public.patients pt on pt.id=s.patient_id join public.staff st on st.id=s.nurse_id where s.id=p_id;
  select coalesce(sum(cash+terminal+owner_card+other_card+unclassified_amount),0) into more_n from private.crm_receipts_v10 where sale_id=p_id and voided_at is null;
 else raise exception 'Неизвестная операция';end if;
 if a is null then raise exception 'Запись не найдена';end if;
 return a||jsonb_build_object('initial_paid_total',(a->>'paid_total')::numeric,'paid_total',(a->>'paid_total')::numeric+more_n,'received_total',(a->>'paid_total')::numeric+more_n,
  'debt_total',greatest((a->>'charge_total')::numeric-(a->>'paid_total')::numeric-more_n,0),
  'payment_pending',coalesce((a->>'payment_pending')::boolean,false) and (a->>'charge_total')::numeric>(a->>'paid_total')::numeric+more_n,'payment_only',not(a->>'stock_deducted')::boolean,
  'medications',a->'items','editable',private.is_manager() or(exists(select 1 from public.shifts sh join public.shift_staff ss on ss.shift_id=sh.id where sh.id=(a->>'shift_id')::uuid and sh.status='open' and ss.staff_id=private.crm_actor_staff_v10())));
end $function$
;

-- Fourth channel in lifetime and shift scopes; zero column omitted from
-- cash-count fingerprints so existing immutable counts remain valid.

CREATE OR REPLACE FUNCTION private.crm_treatment_snapshot_v10(p_kind text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare answer_n jsonb;cash_n numeric;terminal_n numeric;card_n numeric;other_n numeric;
 initial_classified_n numeric;initial_unknown_n numeric;debt_n numeric;ordinary_n numeric;
begin
 -- Preserve all existing role/editability, pending, partial-stock and lifetime totals.
 answer_n:=private.crm_treatment_snapshot_v10_before_v34(p_kind,p_id);
 select coalesce(sum(a.cash),0),coalesce(sum(a.terminal),0),coalesce(sum(a.owner_card),0),coalesce(sum(a.other_card),0)
 into cash_n,terminal_n,card_n,other_n
 from private.crm_payment_allocations a where a.voided_at is null and
  ((p_kind='procedure' and a.procedure_id=p_id)or(p_kind='sale' and a.sale_id=p_id));
 initial_classified_n:=cash_n+terminal_n+card_n+other_n;
 -- Older paid records may have no channel allocation. Never guess that this was cash.
 initial_unknown_n:=greatest(coalesce((answer_n->>'initial_paid_total')::numeric,0)-initial_classified_n,0);
 select cash_n+coalesce(sum(r.cash) filter(where not r.is_debt_repayment),0),
  terminal_n+coalesce(sum(r.terminal) filter(where not r.is_debt_repayment),0),
  card_n+coalesce(sum(r.owner_card) filter(where not r.is_debt_repayment),0),
  other_n+coalesce(sum(r.other_card) filter(where not r.is_debt_repayment),0),
  initial_unknown_n+coalesce(sum(r.unclassified_amount) filter(where not r.is_debt_repayment),0),
  coalesce(sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount) filter(where r.is_debt_repayment),0)
 into cash_n,terminal_n,card_n,other_n,initial_unknown_n,debt_n
 from private.crm_receipts_v10 r where r.voided_at is null and
  ((p_kind='procedure' and r.procedure_id=p_id)or(p_kind='sale' and r.sale_id=p_id));
 ordinary_n:=cash_n+terminal_n+card_n+other_n+initial_unknown_n;
 return answer_n||jsonb_build_object('payments_complete',true,
  'payments',jsonb_build_object('cash',cash_n,'terminal',terminal_n,'owner_card',card_n,'other_card',other_n,
   'unclassified',initial_unknown_n,'total',ordinary_n),
  'debt_repayments_total',debt_n);
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_shift_treatment_snapshot_v29(p_kind text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare answer_n jsonb;ordinary_n numeric;shift_n uuid;initial_n numeric;
 cash_n numeric;terminal_n numeric;card_n numeric;other_n numeric;unknown_n numeric;shift_receipts_n numeric;
 receipt_cash_n numeric;receipt_terminal_n numeric;receipt_card_n numeric;receipt_other_n numeric;receipt_unknown_n numeric;
begin
 answer_n:=private.crm_treatment_snapshot_v10(p_kind,p_id);
 shift_n:=nullif(answer_n->>'shift_id','')::uuid;
 initial_n:=coalesce((answer_n->>'initial_paid_total')::numeric,0);
 select coalesce(sum(a.cash),0),coalesce(sum(a.terminal),0),coalesce(sum(a.owner_card),0),coalesce(sum(a.other_card),0)
  into cash_n,terminal_n,card_n,other_n from private.crm_payment_allocations a
  where a.voided_at is null and((p_kind='procedure' and a.procedure_id=p_id)or(p_kind='sale' and a.sale_id=p_id));
 -- An old paid record without an allocation has an unknown method, never cash.
 unknown_n:=greatest(initial_n-cash_n-terminal_n-card_n-other_n,0);
 select coalesce(sum(r.cash+r.terminal+r.owner_card+r.other_card+r.unclassified_amount),0),
  coalesce(sum(r.cash) filter(where r.shift_id=shift_n),0),
  coalesce(sum(r.terminal) filter(where r.shift_id=shift_n),0),
  coalesce(sum(r.owner_card) filter(where r.shift_id=shift_n),0),
  coalesce(sum(r.other_card) filter(where r.shift_id=shift_n),0),
  coalesce(sum(r.unclassified_amount) filter(where r.shift_id=shift_n),0)
  into ordinary_n,receipt_cash_n,receipt_terminal_n,receipt_card_n,receipt_other_n,receipt_unknown_n
  from private.crm_receipts_v10 r where r.voided_at is null and not r.is_debt_repayment
   and((p_kind='procedure' and r.procedure_id=p_id)or(p_kind='sale' and r.sale_id=p_id));
 shift_receipts_n:=receipt_cash_n+receipt_terminal_n+receipt_card_n+receipt_other_n+receipt_unknown_n;
 return answer_n||jsonb_build_object(
  'lifetime_received_total',answer_n->'received_total','paid_total',answer_n->'initial_paid_total',
  'received_total',initial_n+ordinary_n,
  'payment_scope_v45','shift','shift_received_total_v45',initial_n+shift_receipts_n,
  'shift_payments_v45',jsonb_build_object('cash',cash_n+receipt_cash_n,'terminal',terminal_n+receipt_terminal_n,
   'owner_card',card_n+receipt_card_n,'other_card',other_n+receipt_other_n,'unclassified',unknown_n+receipt_unknown_n,'total',initial_n+shift_receipts_n),
  'received_other_shifts_v45',ordinary_n-shift_receipts_n);
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_cash_financial_snapshot_v37(p_shift uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
  'drawer',private.crm_cash_drawer_facts_v30_before_v37(p_shift),
  'opening',(select to_jsonb(o) from private.crm_cash_openings_v30 o where o.shift_id=p_shift),
  'initial_payments',coalesce((select jsonb_agg(case when a.other_card=0 then to_jsonb(a)-'other_card' else to_jsonb(a) end order by a.id)
   from private.crm_payment_allocations a left join public.procedures p on p.id=a.procedure_id
    left join public.sales s on s.id=a.sale_id
   where a.voided_at is null and coalesce(p.shift_id,s.shift_id)=p_shift),'[]'),
  'ordinary_receipts',coalesce((select jsonb_agg(case when r.other_card=0 then to_jsonb(r)-'other_card' else to_jsonb(r) end order by r.id) from private.crm_receipts_v10 r
   where r.shift_id=p_shift and r.voided_at is null and not r.is_debt_repayment),'[]'),
  'bills',coalesce((select jsonb_agg(b.value order by b.kind,b.id) from(
   select 'procedure' kind,p.id,jsonb_build_object('kind','procedure','id',p.id,'paid_total',p.paid_total,
    'charge_total',p.charge_total,'list_total',p.list_total,'payment_pending',p.payment_pending) value
    from public.procedures p where p.shift_id=p_shift
   union all select 'sale',s.id,jsonb_build_object('kind','sale','id',s.id,'paid_total',s.paid_total,
    'charge_total',s.charge_total,'list_total',s.list_total,'payment_pending',s.payment_pending)
    from public.sales s where s.shift_id=p_shift
  ) b),'[]'),
  'assigned_staff',coalesce((select jsonb_agg(jsonb_build_object('staff_id',st.id,'role',st.role,'active',st.active) order by st.id)
   from public.staff st where exists(select 1 from public.shift_staff ss where ss.shift_id=p_shift and ss.staff_id=st.id)),'[]'),
  'assigned_payroll',coalesce((select jsonb_agg(to_jsonb(w) order by w.staff_id) from private.crm_shift_payroll w where w.shift_id=p_shift),'[]')
 )
$function$
;

revoke all on function private.crm_treatment_snapshot_v10(text,uuid),
 private.crm_shift_treatment_snapshot_v29(text,uuid),
 private.crm_cash_financial_snapshot_v37(uuid) from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
