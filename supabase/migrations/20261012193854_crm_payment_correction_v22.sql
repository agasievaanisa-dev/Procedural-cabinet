-- Correct an explicitly mistaken payment: money was never received.
-- Original allocations/receipts retain their amounts and are marked void for reports.
-- Installing this migration changes no existing patient, payment or stock records.
begin;
set local lock_timeout='10s';

alter table private.crm_payment_allocations
 add column voided_at timestamptz,
 add column voided_by uuid,
 add column void_reason text,
 add column void_request_id uuid references private.warehouse_requests(id);
alter table private.crm_receipts_v10
 add column voided_at timestamptz,
 add column voided_by uuid,
 add column void_reason text,
 add column void_request_id uuid references private.warehouse_requests(id);
alter table private.crm_payment_allocations add constraint crm_allocation_void_v22 check (
 (voided_at is null and voided_by is null and void_reason is null and void_request_id is null)
 or (voided_at is not null and voided_by is not null and nullif(trim(void_reason),'') is not null and void_request_id is not null));
alter table private.crm_receipts_v10 add constraint crm_receipt_void_v22 check (
 (voided_at is null and voided_by is null and void_reason is null and void_request_id is null)
 or (voided_at is not null and voided_by is not null and nullif(trim(void_reason),'') is not null and void_request_id is not null));
-- These tables remain private, RLS enabled, and present in the existing full backup.
revoke all on private.crm_payment_allocations,private.crm_receipts_v10 from public,anon,authenticated;


-- Preserve the released snapshot, including pending and peer-shift edit rules.

CREATE OR REPLACE FUNCTION private.crm_treatment_snapshot_v10(p_kind text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a jsonb;more_n numeric;
begin
 if p_kind='procedure' then
  select to_jsonb(p)||jsonb_build_object('kind','procedure','at',p.visit_at,'patient',pt.full_name,'nurse',st.full_name,
   'services',coalesce((select jsonb_agg(jsonb_build_object('service_id',s.service_id,'name',s.name,'quantity',s.quantity,'work_price',s.work_price,'consumables_price',s.consumables_price,'line_total',round((s.work_price+s.consumables_price)*s.quantity,2)) order by s.position) from private.crm_treatment_services s where s.procedure_id=p.id),'[]'),
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'medication_id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'unit_price',pm.unit_price,'line_total',pm.line_total) order by m.name,m.id) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]'),
   'own_medications',coalesce((select jsonb_agg(jsonb_build_object('name',x.name,'quantity',x.quantity,'unit',x.unit,'source',x.source) order by x.position) from private.crm_own_medications x where x.procedure_id=p.id),'[]')) into a
   from public.procedures p join public.patients pt on pt.id=p.patient_id join public.staff st on st.id=p.nurse_id where p.id=p_id;
  select coalesce(sum(cash+terminal+owner_card),0) into more_n from private.crm_receipts_v10 where procedure_id=p_id and voided_at is null;
 elsif p_kind='sale' then
  select to_jsonb(s)||jsonb_build_object('kind','sale','at',s.sold_at,'patient',coalesce(pt.full_name,'Без пациента'),'nurse',st.full_name,'services','[]'::jsonb,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'medication_id',m.id,'name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'unit_price',si.unit_price,'line_total',si.line_total) order by m.name,m.id) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]'),
   'own_medications','[]'::jsonb) into a from public.sales s left join public.patients pt on pt.id=s.patient_id join public.staff st on st.id=s.nurse_id where s.id=p_id;
  select coalesce(sum(cash+terminal+owner_card),0) into more_n from private.crm_receipts_v10 where sale_id=p_id and voided_at is null;
 else raise exception 'Неизвестная операция';end if;
 if a is null then raise exception 'Запись не найдена';end if;
 return a||jsonb_build_object('initial_paid_total',(a->>'paid_total')::numeric,'paid_total',(a->>'paid_total')::numeric+more_n,'received_total',(a->>'paid_total')::numeric+more_n,
  'debt_total',greatest((a->>'charge_total')::numeric-(a->>'paid_total')::numeric-more_n,0),
  'payment_pending',coalesce((a->>'payment_pending')::boolean,false) and (a->>'charge_total')::numeric>(a->>'paid_total')::numeric+more_n,'payment_only',not(a->>'stock_deducted')::boolean,
  'medications',a->'items','editable',private.is_manager() or(exists(select 1 from public.shifts sh join public.shift_staff ss on ss.shift_id=sh.id where sh.id=(a->>'shift_id')::uuid and sh.status='open' and ss.staff_id=private.crm_actor_staff_v10())));
end $function$;




-- A voided erroneous receipt does not block a later unpaid draft edit.

CREATE OR REPLACE FUNCTION private.crm_clinical_v10(p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;role_n text;kind_n text:=coalesce(p_payload->>'kind','procedure');id_n uuid;patient_n uuid;req private.warehouse_requests%rowtype;
 original jsonb;updated_n jsonb;data_n jsonb;pay jsonb;result_n jsonb;item record;old_q numeric;new_q numeric;sh uuid;pay_shift uuid;pay_nurse uuid;editable_n boolean;reason_n text;pending_n boolean;
begin
 select id,role into actor,role_n from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_n not in ('owner','admin','nurse') then raise exception 'Нет доступа';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or p_action is null then raise exception 'Проверьте параметры';end if;
 if p_action='patient_treatments' then
  patient_n:=(p_payload->>'patient_id')::uuid;
  if not exists(select 1 from public.patients where id=patient_n and(deleted_at is null or private.is_manager())) then raise exception 'Пациент не найден';end if;
  return jsonb_build_object('procedures',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('procedure',p.id) order by p.visit_at desc,p.id) from public.procedures p where p.patient_id=patient_n),'[]'),
   'sales',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('sale',s.id) order by s.sold_at desc,s.id) from public.sales s where s.patient_id=patient_n),'[]'));
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
 pay:=private.crm_validate_payment_v10(coalesce(p_payload->'payments','{}'));
 if p_action='debt_payment' then
  if(original->>'patient_id') is null then raise exception 'Для оплаты долга нужен пациент';end if;
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
  data_n:=private.crm_prepare_treatment_v10(kind_n,p_payload,original);
  perform private.crm_validate_status_v10(p_payload->>'payment_status',(data_n->>'charge_total')::numeric,(original->>'paid_total')::numeric+(pay->>'total')::numeric);
  if(data_n->>'charge_total')::numeric<(original->>'paid_total')::numeric+(pay->>'total')::numeric then raise exception 'Новая сумма меньше уже полученной оплаты. Нужен отдельный возврат владельца';end if;
  if p_payload->>'payment_status'='pending' and nullif(original->>'patient_id','') is null then
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
    discount_reason=data_n->>'discount_reason',discount_comment=data_n->>'discount_comment',notes=p_payload->>'notes',version=version+1,payment_pending=pending_n where id=id_n;
  else
   update public.sales set list_total=(data_n->>'list_total')::numeric,charge_total=(data_n->>'charge_total')::numeric,discount_amount=(data_n->>'discount_amount')::numeric,discount_percent=(data_n->>'discount_percent')::numeric,
    discount_reason=data_n->>'discount_reason',discount_comment=data_n->>'discount_comment',notes=p_payload->>'notes',version=version+1,payment_pending=pending_n where id=id_n;
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
end $function$;


-- Keep the actual legacy base and its warehouse/payroll calculations intact.

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
 select jsonb_build_object('cash',coalesce(sum(a.cash),0),'terminal',coalesce(sum(a.terminal),0),'owner_card',coalesce(sum(a.owner_card),0),
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
end $function$;


-- Closed/open shifts count only valid receipts.

CREATE OR REPLACE FUNCTION private.crm_build_shift_report_v5(p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a jsonb:=private.crm_build_shift_report_legacy_v9(p_shift);receipts_n jsonb;r jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'procedure_id',x.procedure_id,'sale_id',x.sale_id,'patient_id',coalesce(p.patient_id,s.patient_id),'patient',pt.full_name,'at',x.created_at,'nurse',st.full_name,
  'paid_total',x.cash+x.terminal+x.owner_card,'comment',x.comment,'payments',jsonb_build_object('cash',x.cash,'terminal',x.terminal,'owner_card',x.owner_card,'cash_received',x.cash_received,'change',x.change_amount)) order by x.created_at,x.id),'[]') into receipts_n
  from private.crm_receipts_v10 x left join public.procedures p on p.id=x.procedure_id left join public.sales s on s.id=x.sale_id left join public.patients pt on pt.id=coalesce(p.patient_id,s.patient_id) join public.staff st on st.id=x.nurse_id where x.shift_id=p_shift and x.voided_at is null;
 select jsonb_build_object('cash',coalesce(sum(cash),0),'terminal',coalesce(sum(terminal),0),'owner_card',coalesce(sum(owner_card),0),'total',coalesce(sum(cash+terminal+owner_card),0)) into r from private.crm_receipts_v10 where shift_id=p_shift and voided_at is null;
 return a||jsonb_build_object('procedures',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('procedure',p.id)||jsonb_build_object('paid_total',p.paid_total) order by p.visit_at,p.id) from public.procedures p where p.shift_id=p_shift),'[]'),
  'sales',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('sale',s.id)||jsonb_build_object('paid_total',s.paid_total) order by s.sold_at,s.id) from public.sales s where s.shift_id=p_shift),'[]'),
  'receipts',receipts_n,'debt_receipts_total',(r->>'total')::numeric,
  'cash_total',(a->'revenue'->>'total')::numeric+(r->>'total')::numeric,
  'charge_total',coalesce((select sum(charge_total) from public.procedures where shift_id=p_shift),0)+coalesce((select sum(charge_total) from public.sales where shift_id=p_shift),0),
  'debt_created_total',coalesce((select sum(charge_total-paid_total) from public.procedures where shift_id=p_shift),0)+coalesce((select sum(charge_total-paid_total) from public.sales where shift_id=p_shift),0),
  'debt_total',coalesce((select sum((private.crm_treatment_snapshot_v10('procedure',id)->>'debt_total')::numeric) from public.procedures where shift_id=p_shift),0)+coalesce((select sum((private.crm_treatment_snapshot_v10('sale',id)->>'debt_total')::numeric) from public.sales where shift_id=p_shift),0),
  'revenue',(a->'revenue')||jsonb_build_object('cash',(a->'revenue'->>'cash')::numeric+(r->>'cash')::numeric,'terminal',(a->'revenue'->>'terminal')::numeric+(r->>'terminal')::numeric,'owner_card',(a->'revenue'->>'owner_card')::numeric+(r->>'owner_card')::numeric,'total',(a->'revenue'->>'total')::numeric+(r->>'total')::numeric),
  'cash_after_salary',case when(a->>'payroll_complete')::boolean then(a->'revenue'->>'total')::numeric+(r->>'total')::numeric-(a->>'payroll_total')::numeric end);
end $function$;


-- Period receipts and outstanding debts use the same nonvoid accounting basis.

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
   p.visit_at at,p.list_total,p.charge_total,p.paid_total,p.stock_deducted
  from public.procedures p
  union all
  select 'sale',s.id,s.shift_id,s.nurse_id,s.patient_id,null::uuid,'Продажа препаратов',
   s.sold_at,s.list_total,s.charge_total,s.paid_total,s.stock_deducted from public.sales s
 ), events as (
  select t.*,t.id event_id,false is_receipt,coalesce(a.cash,0) cash,coalesce(a.terminal,0) terminal,
   coalesce(a.owner_card,0) owner_card,case when a.id is null then t.paid_total else 0 end unclassified,
   greatest(0,t.charge_total-t.paid_total) debt_created_total,
   greatest(0,t.charge_total-t.paid_total-coalesce((select sum(r.cash+r.terminal+r.owner_card)
    from private.crm_receipts_v10 r where r.voided_at is null and ((t.kind='procedure' and r.procedure_id=t.id)
     or (t.kind='sale' and r.sale_id=t.id))),0)) debt_total
  from treatments t left join private.crm_payment_allocations a
   on a.voided_at is null and ((t.kind='procedure' and a.procedure_id=t.id) or (t.kind='sale' and a.sale_id=t.id))
  where t.at>=first_day::timestamp at time zone tz and t.at<(last_day+1)::timestamp at time zone tz
  union all
  select t.kind,t.id,r.shift_id,r.nurse_id,t.patient_id,t.service_id,t.service_name,r.created_at,
   t.list_total,0::numeric,r.cash+r.terminal+r.owner_card,t.stock_deducted,
   r.id,true,r.cash,r.terminal,r.owner_card,0::numeric,0::numeric,0::numeric
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
   round(sum(owner_card*share),2) owner_card,round(sum(unclassified*share),2) unclassified,
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
   'owner_card',coalesce(sum(owner_card),0),'unclassified',coalesce(sum(unclassified),0),'total',coalesce(sum(paid_total),0)) from filtered),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',group_id,'label',label,'patients_count',patients_count,
   'procedures_count',procedures_count,'sales_count',sales_count,'quantity',quantity,
   'payment_only_procedures_count',payment_only_procedures_count,'payment_only_sales_count',payment_only_sales_count,
   'charge_total',charge_total,'debt_total',debt_total,'debt_created_total',debt_created_total,
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
end $function$;


-- Refresh monetary cached totals without replacing frozen stock/payroll.

CREATE OR REPLACE FUNCTION private.crm_refresh_closed_report_v10(p_shift uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare fresh jsonb;
begin
 if not exists(select 1 from private.crm_shift_reports where shift_id=p_shift) then return;end if;
 fresh:=private.crm_build_shift_report_v5(p_shift);
 -- Warehouse and the closed payroll snapshot are never replaced by present stock.
 update private.crm_shift_reports set report=report||jsonb_build_object(
  'procedures',fresh->'procedures','sales',fresh->'sales','receipts',fresh->'receipts',
  'procedures_total',fresh->'procedures_total','sales_total',fresh->'sales_total','cash_total',fresh->'cash_total',
  'charge_total',fresh->'charge_total','debt_total',fresh->'debt_total',
  'debt_created_total',fresh->'debt_created_total','debt_receipts_total',fresh->'debt_receipts_total',
  'revenue',fresh->'revenue','cash_after_salary',case when coalesce((report->>'payroll_complete')::boolean,false)
   then(fresh->'revenue'->>'total')::numeric-(report->>'payroll_total')::numeric end) where shift_id=p_shift;
end $function$;

-- This endpoint corrects an entry only after a manager confirms that no money
-- was received. It is not a refund endpoint and never fabricates a cash movement.
create or replace function private.crm_payment_correction_v22(p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
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
 if nullif(original_n->>'patient_id','') is null then
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
 perform 1 from public.patients p where p.id=(original_n->>'patient_id')::uuid for share;
 if not found then raise exception 'Пациент не найден' using errcode='22023';end if;
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
  jsonb_build_object('cash',0,'terminal',0,'owner_card',0,'cash_received',0));
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
end $$;

revoke all on function private.crm_payment_correction_v22(jsonb,uuid) from public,anon,authenticated;
create or replace function public.crm_payment_correction_v22(p_payload jsonb,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.crm_payment_correction_v22(p_payload,p_request_id);
$$;
revoke all on function public.crm_payment_correction_v22(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.crm_payment_correction_v22(jsonb,uuid) to authenticated;

-- Replacing definitions preserves their released execution grants. New helpers
-- are revoked above; existing internal helpers remain inaccessible directly.
notify pgrst,'reload schema';
commit;
