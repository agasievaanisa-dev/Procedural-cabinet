-- Separate true loan repayments from shift income and the physical cash drawer.
-- Existing bill/payment amounts and stock movements are never rewritten.
-- Apply after v28 and before crm-cash-drawer-v30.sql.
begin;
set local lock_timeout='10s';

alter table private.crm_receipts_v10 add column is_debt_repayment boolean not null default false;
alter table private.crm_receipts_v10 add column unclassified_amount numeric(14,2) not null default 0;
alter table private.crm_receipts_v10 add column paid_on date;
alter table private.crm_receipts_v10 add column purpose text;
alter table private.crm_receipts_v10 alter column shift_id drop not null;
-- Locate the released positive-total check by its expression, not its generated name.
do $constraint$
declare c record;matches_n integer:=0;
begin
 for c in select conname from pg_constraint where conrelid='private.crm_receipts_v10'::regclass
  and contype='c' and pg_get_constraintdef(oid) ~ 'cash.*terminal.*owner_card.*>.*0' loop
  matches_n:=matches_n+1;
  execute format('alter table private.crm_receipts_v10 drop constraint %I',c.conname);
 end loop;
 if matches_n<>1 then raise exception 'Unexpected receipt total constraint count: %',matches_n;end if;
end $constraint$;
alter table private.crm_receipts_v10 add constraint crm_receipts_positive_v29 check(cash+terminal+owner_card+unclassified_amount>0);
alter table private.crm_receipts_v10 add constraint crm_receipts_unclassified_v29 check(unclassified_amount>=0);
alter table private.crm_receipts_v10 add constraint crm_receipts_scope_v29 check(is_debt_repayment or(shift_id is not null and unclassified_amount=0));

-- Each released receipt has exactly one contemporaneous audit snapshot. Refuse
-- uncertain classification rather than guessing from today's settled status.
do $classify$
begin
 if exists(select 1 from private.crm_receipts_v10 r where
  (select count(*) from private.crm_audit_log a where a.created_at=r.created_at and a.actor_user=r.created_by
   and a.entity_id=coalesce(r.procedure_id,r.sale_id)::text and a.entity_type=r.kind
   and a.action in('debt_payment_v10','treatment_edit_v10')
   and jsonb_typeof(a.before_data->'payment_pending')='boolean')<>1) then
  raise exception 'A receipt has no unique original payment state; classification requires review';
 end if;
 update private.crm_receipts_v10 r set is_debt_repayment=not(a.before_data->>'payment_pending')::boolean,
  paid_on=(r.created_at at time zone 'Europe/Moscow')::date,
  purpose=coalesce(nullif(trim(r.comment),''),nullif(trim(a.reason),''),'Погашение долга')
 from private.crm_audit_log a where a.created_at=r.created_at and a.actor_user=r.created_by
  and a.entity_id=coalesce(r.procedure_id,r.sale_id)::text and a.entity_type=r.kind
  and a.action in('debt_payment_v10','treatment_edit_v10');
end $classify$;
create index crm_receipts_debt_history_v29 on private.crm_receipts_v10(paid_on desc,created_at desc,id) where is_debt_repayment and voided_at is null;

-- Copy bodies to internal backups; CREATE OR REPLACE retains every released
-- function OID, owner and ACL. Never rename a released function.
do $copy$
declare n text;sig text;source_n text;
begin
 for n,sig in select * from(values('crm_clinical_v10','text,jsonb,uuid'),('crm_add_receipt_v10','text,uuid,uuid,uuid,jsonb,uuid,text'),
  ('crm_treatment_snapshot_v10','text,uuid'),('crm_build_shift_report_v5','uuid'),('crm_refresh_closed_report_v10','uuid'),
  ('crm_finance_v5','text,jsonb')) t(n,sig) loop
  if to_regprocedure('private.'||n||'_before_v29('||sig||')') is not null then raise exception 'v29 backup already exists: %',n;end if;
  source_n:=pg_get_functiondef(to_regprocedure('private.'||n||'('||sig||')'));
  if source_n is null then raise exception 'Missing released function: %',n;end if;
  execute replace(source_n,'FUNCTION private.'||n||'(','FUNCTION private.'||n||'_before_v29(');
  execute 'revoke all on function private.'||n||'_before_v29('||sig||') from public,anon,authenticated';
 end loop;
end $copy$;
-- The innermost v28 snapshot still owns receipt summation. Include amount-only
-- repayments there so every older edit/correction path sees the same balance.
do $snapshot$
declare source_n text;anchor_n text:='sum(cash+terminal+owner_card)';hits_n integer;
begin
 source_n:=pg_get_functiondef('private.crm_treatment_snapshot_v10_before_v28(text,uuid)'::regprocedure);
 hits_n:=(length(source_n)-length(replace(source_n,anchor_n,'')))/length(anchor_n);
 if hits_n<>2 then raise exception 'Unexpected snapshot receipt-sum anchors: %',hits_n;end if;
 execute replace(source_n,anchor_n,'sum(cash+terminal+owner_card+unclassified_amount)');
end $snapshot$;

-- Capture receipt classification only after the released core has locked and
-- reread the bill. Concurrent edits cannot supply a stale payment state.
do $receipt_context$
declare source_n text;anchor_n text:=$anchor$original:=private.crm_treatment_snapshot_v10(kind_n,id_n);
 pay:=private.crm_validate_payment_v10$anchor$;hits_n integer;
begin
 source_n:=pg_get_functiondef('private.crm_clinical_v10_before_v28(text,jsonb,uuid)'::regprocedure);
 hits_n:=(length(source_n)-length(replace(source_n,anchor_n,'')))/length(anchor_n);
 if hits_n<>1 then raise exception 'Unexpected locked clinical receipt context anchors: %',hits_n;end if;
 execute replace(source_n,anchor_n,$replacement$original:=private.crm_treatment_snapshot_v10(kind_n,id_n);
 perform set_config('crm.debt_receipt_context_v29',jsonb_build_object('request_id',p_request_id,'payment_pending',coalesce((original->>'payment_pending')::boolean,false))::text,true);
 pay:=private.crm_validate_payment_v10$replacement$);
end $receipt_context$;

-- The old financial dispatcher refreshed saved reports even on a read. Keep
-- mutations on its close/salary paths; v29 overlays reads without saving them.
do $readonly_reports$
declare f record;source_n text;anchor_n text:='perform private.crm_refresh_closed_report_v10(sh);';hits_n integer:=0;
begin
 for f in select oid from pg_proc where pronamespace='private'::regnamespace
  and proname in('crm_finance_v5','crm_finance_v5_before_v28','crm_finance_v5_before_v29') loop
  source_n:=pg_get_functiondef(f.oid);
  if position(anchor_n in source_n)>0 then
   if (length(source_n)-length(replace(source_n,anchor_n,'')))/length(anchor_n)<>1 then raise exception 'Unexpected financial refresh anchors';end if;
   hits_n:=hits_n+1;
   execute replace(source_n,anchor_n,'if p_action<>''shift_report'' then '||anchor_n||'end if;');
  end if;
 end loop;
 if hits_n<>1 then raise exception 'Unexpected financial read-refresh function count: %',hits_n;end if;
end $readonly_reports$;

-- The journal deliberately whitelists fields from the pure shift builder.
-- Keep its loan/waiting distinction without widening its payroll access.
do $journal$
declare source_n text;anchor_n text:=$anchor$'debt_total',report_row->'debt_total',$anchor$;hits_n integer;
begin
 source_n:=pg_get_functiondef('private.crm_shift_journal_v12(date)'::regprocedure);
 hits_n:=(length(source_n)-length(replace(source_n,anchor_n,'')))/length(anchor_n);
 if hits_n<>1 then raise exception 'Unexpected shift journal debt anchors: %',hits_n;end if;
 execute replace(source_n,anchor_n,anchor_n||$fields$'loan_debt_total',report_row->'loan_debt_total','pending_total',report_row->'pending_total',$fields$);
end $journal$;

create or replace function private.crm_treatment_snapshot_v10(p_kind text,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare answer_n jsonb;balance_n numeric;pending_n boolean;
begin
 answer_n:=private.crm_treatment_snapshot_v10_before_v29(p_kind,p_id);
 balance_n:=(answer_n->>'debt_total')::numeric;pending_n:=coalesce((answer_n->>'payment_pending')::boolean,false);
 return answer_n||jsonb_build_object('loan_debt_total',case when pending_n then 0 else balance_n end,
  'pending_total',case when pending_n then balance_n else 0 end);
end $$;

create or replace function private.crm_add_receipt_v10(p_kind text,p_id uuid,p_shift uuid,p_nurse uuid,p_pay jsonb,p_request uuid,p_comment text)
returns void language plpgsql security invoker set search_path='' as $$
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
  insert into private.crm_receipts_v10(id,kind,procedure_id,sale_id,shift_id,nurse_id,cash,terminal,owner_card,cash_received,change_amount,
   created_by,comment,is_debt_repayment,paid_on,purpose)
  values(p_request,p_kind,case when p_kind='procedure' then p_id end,case when p_kind='sale' then p_id end,null,actor_n,
   (p->>'cash')::numeric,(p->>'terminal')::numeric,(p->>'owner_card')::numeric,(p->>'cash_received')::numeric,(p->>'change')::numeric,
   auth.uid(),nullif(trim(p_comment),''),true,(now() at time zone 'Europe/Moscow')::date,coalesce(nullif(trim(p_comment),''),'Погашение долга'));
 end if;
end $$;

create or replace function private.crm_clinical_v10(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
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
   'amount',r.cash+r.terminal+r.owner_card+r.unclassified_amount,'paid_on',r.paid_on,'purpose',r.purpose,
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
 insert into private.crm_receipts_v10(id,kind,procedure_id,sale_id,shift_id,nurse_id,cash,terminal,owner_card,cash_received,change_amount,
  created_by,comment,is_debt_repayment,unclassified_amount,paid_on,purpose)
 values(p_request_id,kind_n,case when kind_n='procedure' then id_n end,case when kind_n='sale' then id_n end,null,actor_n,
  coalesce((pay_n->>'cash')::numeric,0),coalesce((pay_n->>'terminal')::numeric,0),coalesce((pay_n->>'owner_card')::numeric,0),
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
end $$;

-- In a shift journal, the bill balance includes all collections, while the
-- displayed received amount excludes the separate true-debt ledger.
create function private.crm_shift_treatment_snapshot_v29(p_kind text,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare answer_n jsonb;ordinary_n numeric;
begin
 answer_n:=private.crm_treatment_snapshot_v10(p_kind,p_id);
 select coalesce(sum(r.cash+r.terminal+r.owner_card+r.unclassified_amount),0) into ordinary_n from private.crm_receipts_v10 r
  where r.voided_at is null and not r.is_debt_repayment and((p_kind='procedure' and r.procedure_id=p_id)or(p_kind='sale' and r.sale_id=p_id));
 return answer_n||jsonb_build_object('lifetime_received_total',answer_n->'received_total','paid_total',answer_n->'initial_paid_total',
  'received_total',(answer_n->>'initial_paid_total')::numeric+ordinary_n);
end $$;
revoke all on function private.crm_shift_treatment_snapshot_v29(text,uuid) from public,anon,authenticated;

create or replace function private.crm_build_shift_report_v5(p_shift uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare answer_n jsonb;initial_n jsonb;receipts_n jsonb;money_n jsonb;procedures_n jsonb;sales_n jsonb;loan_n numeric;pending_n numeric;created_n numeric;
begin
 answer_n:=private.crm_build_shift_report_v5_before_v29(p_shift);
 initial_n:=private.crm_build_shift_report_legacy_v9(p_shift)->'revenue';
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'record_id',coalesce(r.procedure_id,r.sale_id),
  'at',r.created_at,'patient_id',coalesce(p.patient_id,s.patient_id),'patient',coalesce(pt.full_name,'Без пациента'),
  'nurse_id',r.nurse_id,'nurse',st.full_name,'paid_total',r.cash+r.terminal+r.owner_card,
  'payments',jsonb_build_object('cash',r.cash,'terminal',r.terminal,'owner_card',r.owner_card,'cash_received',r.cash_received,'change',r.change_amount),
  'comment',r.comment,'is_debt_repayment',false,'receipt_kind','after_procedure_payment') order by r.created_at,r.id),'[]') into receipts_n
 from private.crm_receipts_v10 r left join public.procedures p on p.id=r.procedure_id left join public.sales s on s.id=r.sale_id
  left join public.patients pt on pt.id=coalesce(p.patient_id,s.patient_id) left join public.staff st on st.id=r.nurse_id
 where r.shift_id=p_shift and r.voided_at is null and not r.is_debt_repayment;
 select jsonb_build_object('cash',(initial_n->>'cash')::numeric+coalesce(sum(r.cash),0),
  'terminal',(initial_n->>'terminal')::numeric+coalesce(sum(r.terminal),0),
  'owner_card',(initial_n->>'owner_card')::numeric+coalesce(sum(r.owner_card),0),
  'unclassified',coalesce((initial_n->>'unclassified')::numeric,0),
  'total',(initial_n->>'total')::numeric+coalesce(sum(r.cash+r.terminal+r.owner_card),0)) into money_n
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
end $$;

-- Retain the frozen warehouse/payroll sections of closed reports while
-- refreshing their financial presentation using the corrected receipt scope.
create function private.crm_financial_overlay_v29(p_report jsonb,p_fresh jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select p_report||jsonb_build_object('procedures',p_fresh->'procedures','sales',p_fresh->'sales','receipts',p_fresh->'receipts',
  'charge_total',p_fresh->'charge_total','debt_total',p_fresh->'debt_total','loan_debt_total',p_fresh->'loan_debt_total',
  'pending_total',p_fresh->'pending_total','debt_created_total',p_fresh->'debt_created_total','debt_receipts_total',p_fresh->'debt_receipts_total',
  'revenue',p_fresh->'revenue','cash_total',p_fresh->'cash_total')||case when p_report?'cash_after_salary' then jsonb_build_object('cash_after_salary',
   case when p_fresh->>'cash_after_salary_semantics'='actual_cash_balance' then p_fresh->'cash_after_salary'
    else to_jsonb(case when coalesce((p_report->>'payroll_complete')::boolean,false) then(p_fresh->'revenue'->>'total')::numeric-(p_report->>'payroll_total')::numeric end) end)
   else '{}'::jsonb end||case when p_fresh->>'cash_after_salary_semantics'='actual_cash_balance'
    then jsonb_build_object('cash_after_salary_semantics','actual_cash_balance') else '{}'::jsonb end;
$$;
revoke all on function private.crm_financial_overlay_v29(jsonb,jsonb) from public,anon,authenticated;
create or replace function private.crm_refresh_closed_report_v10(p_shift uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare fresh_n jsonb;
begin
 perform private.crm_refresh_closed_report_v10_before_v29(p_shift);
 if not exists(select 1 from private.crm_shift_reports where shift_id=p_shift) then return;end if;
 fresh_n:=private.crm_build_shift_report_v5(p_shift);
 update private.crm_shift_reports set report=private.crm_financial_overlay_v29(report,fresh_n) where shift_id=p_shift;
end $$;
create or replace function private.crm_finance_v5(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer_n jsonb;fresh_n jsonb;
begin
 answer_n:=private.crm_finance_v5_before_v29(p_action,p_payload);
 if p_action in('shift_report','close','salary') and answer_n?'revenue' then
  fresh_n:=private.crm_build_shift_report_v5(nullif(p_payload->>'shift_id','')::uuid);
  return private.crm_financial_overlay_v29(answer_n,fresh_n);
 end if;
 return answer_n;
end $$;

CREATE OR REPLACE FUNCTION private.crm_finance_summary_v5(p_payload jsonb)
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
   coalesce(a.owner_card,0) owner_card,case when a.id is null then t.paid_total else 0 end unclassified,
   case when t.payment_pending then 0 else greatest(0,t.charge_total-t.paid_total-coalesce((select sum(r.cash+r.terminal+r.owner_card+r.unclassified_amount)
    from private.crm_receipts_v10 r where r.voided_at is null and not r.is_debt_repayment and ((t.kind='procedure' and r.procedure_id=t.id)
     or (t.kind='sale' and r.sale_id=t.id))),0)) end debt_created_total,
   case when t.payment_pending then 0 else greatest(0,t.charge_total-t.paid_total-coalesce((select sum(r.cash+r.terminal+r.owner_card+r.unclassified_amount)
    from private.crm_receipts_v10 r where r.voided_at is null and ((t.kind='procedure' and r.procedure_id=t.id)
     or (t.kind='sale' and r.sale_id=t.id))),0)) end debt_total,
   case when t.payment_pending then greatest(0,t.charge_total-t.paid_total-coalesce((select sum(r.cash+r.terminal+r.owner_card+r.unclassified_amount)
    from private.crm_receipts_v10 r where r.voided_at is null and ((t.kind='procedure' and r.procedure_id=t.id)
     or (t.kind='sale' and r.sale_id=t.id))),0)) else 0 end pending_total
  from treatments t left join private.crm_payment_allocations a
   on a.voided_at is null and ((t.kind='procedure' and a.procedure_id=t.id) or (t.kind='sale' and a.sale_id=t.id))
  where t.at>=first_day::timestamp at time zone tz and t.at<(last_day+1)::timestamp at time zone tz
  union all
  select t.kind,t.id,r.shift_id,r.nurse_id,t.patient_id,t.service_id,t.service_name,r.created_at,
   t.list_total,0::numeric,r.cash+r.terminal+r.owner_card+r.unclassified_amount,t.stock_deducted,t.payment_pending,
   r.id,true,r.cash,r.terminal,r.owner_card,0::numeric,0::numeric,0::numeric,0::numeric
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
   round(sum(owner_card*share),2) owner_card,round(sum(unclassified*share),2) unclassified,
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
   'owner_card',coalesce(sum(owner_card),0),'unclassified',coalesce(sum(unclassified),0),'total',coalesce(sum(paid_total),0)) from filtered),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',group_id,'label',label,'patients_count',patients_count,
   'procedures_count',procedures_count,'sales_count',sales_count,'quantity',quantity,
   'payment_only_procedures_count',payment_only_procedures_count,'payment_only_sales_count',payment_only_sales_count,
   'charge_total',charge_total,'debt_total',debt_total,'loan_debt_total',debt_total,'pending_total',pending_total,'debt_created_total',debt_created_total,
   'debt_payments_count',debt_payments_count,'debt_payments_total',coalesce(debt_payments_total,0),
   'revenue',jsonb_build_object('cash',cash,'terminal',terminal,'owner_card',owner_card,'unclassified',unclassified,'total',total))
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

CREATE OR REPLACE FUNCTION private.crm_dashboard_day_v25(p_date date DEFAULT NULL::date)
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
  select t.kind,t.id,sum(r.cash+r.terminal+r.owner_card+r.unclassified_amount) amount,
   coalesce(sum(r.cash+r.terminal+r.owner_card+r.unclassified_amount) filter(where not r.is_debt_repayment),0) ordinary_amount
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
   coalesce(a.owner_card,0) owner_card,
   case when coalesce(a.entries,0)=0 then t.paid_total else 0 end unclassified,
   t.paid_total amount,false is_receipt
  from treatments t left join lateral (
   select count(*) entries,sum(a.cash) cash,sum(a.terminal) terminal,sum(a.owner_card) owner_card
    from private.crm_payment_allocations a where a.voided_at is null
     and ((t.kind='procedure' and a.procedure_id=t.id)or(t.kind='sale' and a.sale_id=t.id))
  ) a on true
  union all
  select r.cash,r.terminal,r.owner_card,0::numeric,r.cash+r.terminal+r.owner_card+r.unclassified_amount,true
   from private.crm_receipts_v10 r join selected_shifts s on s.id=r.shift_id where r.voided_at is null and not r.is_debt_repayment
 ), income as (
  select coalesce(sum(cash),0) cash,coalesce(sum(terminal),0) terminal,coalesce(sum(owner_card),0) owner_card,
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
  'revenue',jsonb_build_object('cash',i.cash,'terminal',i.terminal,'owner_card',i.owner_card,'unclassified',i.unclassified,'total',i.total),
  'payroll_total',p.amount,'payroll_unknown',u.amount,'payroll_complete',u.amount=0,
  'cash_after_salary',case when u.amount=0 then i.total-p.amount end,
  'shift_count',(select count(*) from selected_shifts),
  'has_open_shifts',exists(select 1 from selected_shifts where status='open'))
 into working_value from bills b cross join income i cross join payroll p cross join unknown_payroll u;

 with treatments as (
  select 'procedure'::text kind,p.id,p.shift_id,p.visit_at recorded_at,p.paid_total from public.procedures p
  union all select 'sale',s.id,s.shift_id,s.sold_at,s.paid_total from public.sales s
 ), money as (
  select t.shift_id,coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,coalesce(a.owner_card,0) owner_card,
   case when coalesce(a.entries,0)=0 then t.paid_total else 0 end unclassified,t.paid_total amount
  from treatments t left join lateral (
   select count(*) entries,sum(a.cash) cash,sum(a.terminal) terminal,sum(a.owner_card) owner_card
    from private.crm_payment_allocations a where a.voided_at is null
     and ((t.kind='procedure' and a.procedure_id=t.id)or(t.kind='sale' and a.sale_id=t.id))
  ) a on true
  where t.recorded_at>=day_value::timestamp at time zone 'Europe/Moscow'
   and t.recorded_at<(day_value+1)::timestamp at time zone 'Europe/Moscow'
  union all
  select r.shift_id,r.cash,r.terminal,r.owner_card,0::numeric,r.cash+r.terminal+r.owner_card+r.unclassified_amount
   from private.crm_receipts_v10 r where r.voided_at is null and not r.is_debt_repayment
    and r.created_at>=day_value::timestamp at time zone 'Europe/Moscow'
    and r.created_at<(day_value+1)::timestamp at time zone 'Europe/Moscow'
 ), grouped as (
  select case when s.shift_date=day_value then 'current_day_shifts'
   when s.shift_date<day_value then 'previous_day_shifts' else 'other_day_shifts' end category,
   sum(m.cash) cash,sum(m.terminal) terminal,sum(m.owner_card) owner_card,
   sum(m.unclassified) unclassified,sum(m.amount) total
  from money m left join public.shifts s on s.id=m.shift_id group by 1
 )
 select coalesce(jsonb_object_agg(category,jsonb_build_object('cash',cash,'terminal',terminal,
  'owner_card',owner_card,'unclassified',unclassified,'total',total)),'{}'::jsonb) into breakdown_value from grouped;
 return jsonb_build_object('date',day_value,'time_zone','Europe/Moscow','working_day',working_value,
  'receipts_day',jsonb_build_object('date',day_value,'basis','recorded_receipt_date','revenue',calendar_value->'revenue',
   'debt_payments_count',calendar_value->'debt_payments_count','debt_payments_total',calendar_value->'debt_payments_total',
   'breakdown',breakdown_value));
end $function$
;

-- No new table: the released explicit backup whitelist already contains
-- crm_receipts_v10 and warehouse_requests, including the new receipt columns.
notify pgrst,'reload schema';
commit;
