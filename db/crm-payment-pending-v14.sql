-- Clinical v14: deferred payment and edits by colleagues on the same open shift.
-- Money remains represented solely by the original allocation and actual receipts.
-- Existing public APIs and request identities remain unchanged.
begin;
set local lock_timeout='10s';
alter table public.procedures add column if not exists payment_pending boolean not null default false;
alter table public.sales add column if not exists payment_pending boolean not null default false;

create or replace function private.crm_validate_status_v10(p_status text,p_charge numeric,p_received numeric) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_status is null then return;end if; -- Existing clients predate debt selection.
 if p_status not in ('paid','debt','free','pending') then raise exception 'Выберите состояние оплаты';end if;
 if p_status='paid' and p_received<>p_charge then raise exception 'Для полной оплаты распределите всю сумму';end if;
 if p_status='debt' and p_received>=p_charge then raise exception 'Для оплаты в долг должен остаться долг';end if;
 if p_status='pending' and p_received>=p_charge then raise exception 'Для оплаты после процедуры должен остаться неоплаченный остаток';end if;
 if p_status='free' and(p_charge<>0 or p_received<>0) then raise exception 'У бесплатной процедуры стоимость и оплата равны нулю';end if;
end $$;

create or replace function private.crm_treatment_snapshot_v10(p_kind text,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a jsonb;more_n numeric;
begin
 if p_kind='procedure' then
  select to_jsonb(p)||jsonb_build_object('kind','procedure','at',p.visit_at,'patient',pt.full_name,'nurse',st.full_name,
   'services',coalesce((select jsonb_agg(jsonb_build_object('service_id',s.service_id,'name',s.name,'quantity',s.quantity,'work_price',s.work_price,'consumables_price',s.consumables_price,'line_total',round((s.work_price+s.consumables_price)*s.quantity,2)) order by s.position) from private.crm_treatment_services s where s.procedure_id=p.id),'[]'),
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'medication_id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'unit_price',pm.unit_price,'line_total',pm.line_total) order by m.name,m.id) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]'),
   'own_medications',coalesce((select jsonb_agg(jsonb_build_object('name',x.name,'quantity',x.quantity,'unit',x.unit,'source',x.source) order by x.position) from private.crm_own_medications x where x.procedure_id=p.id),'[]')) into a
   from public.procedures p join public.patients pt on pt.id=p.patient_id join public.staff st on st.id=p.nurse_id where p.id=p_id;
  select coalesce(sum(cash+terminal+owner_card),0) into more_n from private.crm_receipts_v10 where procedure_id=p_id;
 elsif p_kind='sale' then
  select to_jsonb(s)||jsonb_build_object('kind','sale','at',s.sold_at,'patient',coalesce(pt.full_name,'Без пациента'),'nurse',st.full_name,'services','[]'::jsonb,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'medication_id',m.id,'name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'unit_price',si.unit_price,'line_total',si.line_total) order by m.name,m.id) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]'),
   'own_medications','[]'::jsonb) into a from public.sales s left join public.patients pt on pt.id=s.patient_id join public.staff st on st.id=s.nurse_id where s.id=p_id;
  select coalesce(sum(cash+terminal+owner_card),0) into more_n from private.crm_receipts_v10 where sale_id=p_id;
 else raise exception 'Неизвестная операция';end if;
 if a is null then raise exception 'Запись не найдена';end if;
 return a||jsonb_build_object('initial_paid_total',(a->>'paid_total')::numeric,'paid_total',(a->>'paid_total')::numeric+more_n,'received_total',(a->>'paid_total')::numeric+more_n,
  'debt_total',greatest((a->>'charge_total')::numeric-(a->>'paid_total')::numeric-more_n,0),
  'payment_pending',coalesce((a->>'payment_pending')::boolean,false) and (a->>'charge_total')::numeric>(a->>'paid_total')::numeric+more_n,'payment_only',not(a->>'stock_deducted')::boolean,
  'medications',a->'items','editable',private.is_manager() or(exists(select 1 from public.shifts sh join public.shift_staff ss on ss.shift_id=sh.id where sh.id=(a->>'shift_id')::uuid and sh.status='open' and ss.staff_id=private.crm_actor_staff_v10())));
end $$;

create or replace function private.crm_record_treatment_v10(p_kind text,p_payload jsonb,p_request_id uuid,p_allocated boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;role_n text;req private.warehouse_requests%rowtype;sh uuid;nurse uuid;patient uuid;data_n jsonb;pay jsonb;paid_n numeric;id_n uuid;stock_n boolean;reserve_n boolean;item jsonb;available_n numeric;missing_n numeric;answer jsonb;pending_n boolean;
begin
 select id,role into actor,role_n from public.staff where active and auth_user_id=auth.uid() limit 1;
 if auth.uid() is null or actor is null or role_n not in ('owner','admin','nurse') then raise exception 'Нет доступа';end if;
 if p_kind is null or p_kind not in ('procedure','sale') or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Проверьте операцию';end if;
 insert into private.warehouse_requests(id,staff_user,action,payload) values(p_request_id,auth.uid(),'clinical_'||p_kind,p_payload) on conflict do nothing;
 select * into req from private.warehouse_requests where id=p_request_id for update;
 if req.staff_user<>auth.uid() or req.action<>'clinical_'||p_kind or req.payload<>p_payload then raise exception 'Номер операции уже использован';end if;
 if req.result is not null then return req.result;end if;
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
 if paid_n<(data_n->>'charge_total')::numeric and patient is null then raise exception 'Для оплаты в долг выберите пациента';end if;
 if p_kind='procedure' then
  insert into public.procedures(patient_id,shift_id,nurse_id,service_id,procedure_type,work_price,consumables_price,list_total,charge_total,discount_amount,discount_percent,discount_reason,discount_comment,paid_total,notes,stock_deducted,payment_pending)
   values(patient,sh,nurse,(data_n->'services'->0->>'service_id')::uuid,data_n->'services'->0->>'name',(data_n->>'work_price')::numeric,(data_n->>'consumables_price')::numeric,(data_n->>'list_total')::numeric,(data_n->>'charge_total')::numeric,(data_n->>'discount_amount')::numeric,(data_n->>'discount_percent')::numeric,data_n->>'discount_reason',data_n->>'discount_comment',paid_n,p_payload->>'notes',stock_n,pending_n) returning id into id_n;
 else
  insert into public.sales(shift_id,nurse_id,patient_id,list_total,charge_total,discount_amount,discount_percent,discount_reason,discount_comment,paid_total,notes,stock_deducted,payment_pending)
   values(sh,nurse,patient,(data_n->>'list_total')::numeric,(data_n->>'charge_total')::numeric,(data_n->>'discount_amount')::numeric,(data_n->>'discount_percent')::numeric,data_n->>'discount_reason',data_n->>'discount_comment',paid_n,p_payload->>'notes',stock_n,pending_n) returning id into id_n;
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
  insert into private.crm_payment_allocations(id,kind,procedure_id,sale_id,cash,terminal,owner_card,cash_received,change_amount,created_by) values(p_request_id,p_kind,case when p_kind='procedure' then id_n end,case when p_kind='sale' then id_n end,(pay->>'cash')::numeric,(pay->>'terminal')::numeric,(pay->>'owner_card')::numeric,(pay->>'cash_received')::numeric,(pay->>'change')::numeric,auth.uid());
 end if;
 answer:=private.crm_treatment_snapshot_v10(p_kind,id_n)||jsonb_build_object('payments',pay);
 update private.warehouse_requests set result=answer where id=p_request_id;
 insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,after_data) values(auth.uid(),actor,'treatment_recorded_v10',p_kind,id_n::text,answer);
 return answer;
end $$;

create or replace function private.crm_clinical_v10(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
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
end $$;

-- Keep the existing execution boundaries; internal helpers are never exposed directly.
revoke all on function private.crm_validate_status_v10(text,numeric,numeric),private.crm_treatment_snapshot_v10(text,uuid),private.crm_record_treatment_v10(text,jsonb,uuid,boolean) from public,anon,authenticated;
revoke all on function private.crm_clinical_v10(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.crm_clinical_v10(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
