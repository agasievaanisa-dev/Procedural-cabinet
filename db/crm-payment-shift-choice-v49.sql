-- v49: explicitly choose the receiving shift for an ordinary waiting payment.
-- No payment timestamp, amount, method, historical balance or true-debt ledger
-- is changed. Preserve the released functions' OIDs, grants, search_path,
-- authorization, deterministic locks and completed-request replay behavior.
-- Source anchors and full hashes bound each patch to the reviewed release.
begin;
set local lock_timeout='10s';

do $v49_1$
declare actual_n text;
begin
 if to_regprocedure('private.crm_clinical_v10(text,jsonb,uuid)') is null then raise exception 'v49: missing reviewed function private.crm_clinical_v10(text,jsonb,uuid)';end if;
 select md5(pg_get_functiondef('private.crm_clinical_v10(text,jsonb,uuid)'::regprocedure)) into actual_n;
 if actual_n='76ef3b14daf3159d2cfb0c47d478100b' then return;end if;
 if actual_n<>'9ca3d6b595ab3d78fc3a10d561956959' then raise exception 'v49: reviewed function changed: private.crm_clinical_v10(text,jsonb,uuid)';end if;
 execute $definition_v49_1$CREATE OR REPLACE FUNCTION private.crm_clinical_v10(p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_request_id uuid DEFAULT NULL::uuid)
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
 if p_payload?'payment_shift_explicit' and jsonb_typeof(p_payload->'payment_shift_explicit') is distinct from 'boolean' then
  raise exception 'Выберите смену оплаты заново';end if;
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
  perform set_config('crm.debt_receipt_context_v29',jsonb_build_object('request_id',p_request_id,'payment_shift_explicit',coalesce(p_payload->'payment_shift_explicit'='true'::jsonb,false),'payment_pending',coalesce((original_n->>'payment_pending')::boolean,false))::text,true);
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
  perform set_config('crm.debt_receipt_context_v29',jsonb_build_object('request_id',p_request_id,'payment_shift_explicit',coalesce(p_payload->'payment_shift_explicit'='true'::jsonb,false),'payment_pending',true)::text,true);
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
$definition_v49_1$;
end $v49_1$;

do $v49_2$
declare actual_n text;
begin
 if to_regprocedure('private.crm_clinical_v10_before_v28(text,jsonb,uuid)') is null then raise exception 'v49: missing reviewed function private.crm_clinical_v10_before_v28(text,jsonb,uuid)';end if;
 select md5(pg_get_functiondef('private.crm_clinical_v10_before_v28(text,jsonb,uuid)'::regprocedure)) into actual_n;
 if actual_n='db1441de0574bf1de93840193be80705' then return;end if;
 if actual_n<>'afc66d75fe9c77454559566e6d12c771' then raise exception 'v49: reviewed function changed: private.crm_clinical_v10_before_v28(text,jsonb,uuid)';end if;
 execute $definition_v49_2$CREATE OR REPLACE FUNCTION private.crm_clinical_v10_before_v28(p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_request_id uuid DEFAULT NULL::uuid)
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
 if p_payload?'payment_shift_explicit' and jsonb_typeof(p_payload->'payment_shift_explicit') is distinct from 'boolean' then
  raise exception 'Выберите смену оплаты заново';end if;
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
 perform set_config('crm.debt_receipt_context_v29',jsonb_build_object('request_id',p_request_id,'payment_shift_explicit',coalesce(p_payload->'payment_shift_explicit'='true'::jsonb,false),
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
$definition_v49_2$;
end $v49_2$;

do $v49_3$
declare actual_n text;
begin
 if to_regprocedure('private.crm_add_receipt_v10_before_v29(text,uuid,uuid,uuid,jsonb,uuid,text)') is null then raise exception 'v49: missing reviewed function private.crm_add_receipt_v10_before_v29(text,uuid,uuid,uuid,jsonb,uuid,text)';end if;
 select md5(pg_get_functiondef('private.crm_add_receipt_v10_before_v29(text,uuid,uuid,uuid,jsonb,uuid,text)'::regprocedure)) into actual_n;
 if actual_n='49ac9f3a17621a10557145942135f5d8' then return;end if;
 if actual_n<>'e33e0abea8a1d51635f1c751c7fc55f1' then raise exception 'v49: reviewed function changed: private.crm_add_receipt_v10_before_v29(text,uuid,uuid,uuid,jsonb,uuid,text)';end if;
 execute $definition_v49_3$CREATE OR REPLACE FUNCTION private.crm_add_receipt_v10_before_v29(p_kind text, p_id uuid, p_shift uuid, p_nurse uuid, p_pay jsonb, p_request uuid, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor uuid:=private.crm_actor_staff_v10();p jsonb:=private.crm_validate_payment_v10(p_pay-'total'-'change');source_shift_n uuid;choice_context_n jsonb;
begin
 if(p->>'total')::numeric<=0 then raise exception 'Укажите положительную сумму оплаты долга';end if;
 perform 1 from public.shifts where id=p_shift and status='open' for update;
 if not found then raise exception 'Для приёма оплаты выберите открытую смену';end if;
 if not private.is_manager() and not exists(select 1 from public.shift_staff where shift_id=p_shift and staff_id=actor) then raise exception 'Нет доступа к смене оплаты';end if;
 if not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=p_shift and ss.staff_id=p_nurse and st.active and st.role='nurse') then raise exception 'Выберите медсестру смены оплаты';end if;
 -- v49: a later clock time does not move a waiting visit into another open
 -- shift. Its locked original shift is the default; another open receiving
 -- shift must have been explicitly chosen in this exact request. The caller
 -- already locks original and receiving shifts in deterministic UUID order.
 if p_kind='procedure' then select shift_id into source_shift_n from public.procedures where id=p_id;
 elsif p_kind='sale' then select shift_id into source_shift_n from public.sales where id=p_id;end if;
 if source_shift_n is distinct from p_shift and exists(select 1 from public.shifts s
  where s.id=source_shift_n and s.status='open' and(private.is_manager()
   or exists(select 1 from public.shift_staff ss where ss.shift_id=s.id and ss.staff_id=actor))) then
  choice_context_n:=nullif(current_setting('crm.debt_receipt_context_v29',true),'')::jsonb;
  if choice_context_n->>'request_id' is distinct from p_request::text
   or choice_context_n->'payment_shift_explicit' is distinct from 'true'::jsonb then
   raise exception 'Исходная смена ещё открыта. Обновите запись и выберите смену, в кассу которой принята оплата';
  end if;
 end if;
 insert into private.crm_receipts_v10(id,kind,procedure_id,sale_id,shift_id,nurse_id,cash,terminal,owner_card,other_card,cash_received,change_amount,created_by,comment)
 values(p_request,p_kind,case when p_kind='procedure' then p_id end,case when p_kind='sale' then p_id end,p_shift,p_nurse,(p->>'cash')::numeric,(p->>'terminal')::numeric,(p->>'owner_card')::numeric,(p->>'other_card')::numeric,(p->>'cash_received')::numeric,(p->>'change')::numeric,auth.uid(),nullif(trim(p_comment),''));
end $function$
$definition_v49_3$;
end $v49_3$;

commit;
