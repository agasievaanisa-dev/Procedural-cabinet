-- Clinical v10: bill, actual receipts and debt are separate immutable concepts.
-- Existing paid_total stays the original receipt; no historical cash is fabricated.
begin;
set local lock_timeout='10s';
alter table public.procedures add column if not exists charge_total numeric(12,2);
alter table public.sales add column if not exists charge_total numeric(12,2);
update public.procedures set charge_total=paid_total where charge_total is null;
update public.sales set charge_total=paid_total where charge_total is null;
alter table public.procedures alter column charge_total set not null;
alter table public.sales alter column charge_total set not null;
alter table public.procedures add column if not exists version integer not null default 1;
alter table public.sales add column if not exists version integer not null default 1;
-- Added here as well so either safe deployment order works with patient deletion.
alter table public.patients add column if not exists deleted_at timestamptz;
alter table public.patients add column if not exists deleted_by uuid;

create table if not exists private.crm_treatment_services (
 procedure_id uuid not null references public.procedures(id),position integer not null,
 service_id uuid references public.procedure_services(id),name text not null,
 quantity numeric(12,3) not null check(quantity>0 and quantity=trunc(quantity)),
 work_price numeric(12,2) not null check(work_price>=0),
 consumables_price numeric(12,2) not null check(consumables_price>=0),
 primary key(procedure_id,position),unique(procedure_id,service_id)
);
insert into private.crm_treatment_services(procedure_id,position,service_id,name,quantity,work_price,consumables_price)
 select id,0,service_id,coalesce(procedure_type,'Процедура'),1,work_price,consumables_price from public.procedures
 on conflict(procedure_id,position) do nothing;
create table if not exists private.crm_own_medications (
 kind text not null check(kind in ('procedure','sale')),procedure_id uuid references public.procedures(id),sale_id uuid references public.sales(id),
 position integer not null,name text not null check(length(trim(name)) between 1 and 500),
 quantity numeric(12,3) not null check(quantity>0 and quantity=trunc(quantity)),unit text not null,
 source text not null check(source in ('patient','previously_purchased')),
 check((kind='procedure' and procedure_id is not null and sale_id is null) or(kind='sale' and sale_id is not null and procedure_id is null))
);
create unique index if not exists crm_own_medications_procedure_v10 on private.crm_own_medications(procedure_id,position) where procedure_id is not null;
create unique index if not exists crm_own_medications_sale_v10 on private.crm_own_medications(sale_id,position) where sale_id is not null;
create table if not exists private.crm_receipts_v10 (
 id uuid primary key references private.warehouse_requests(id),kind text not null check(kind in ('procedure','sale')),
 procedure_id uuid references public.procedures(id),sale_id uuid references public.sales(id),
 shift_id uuid not null references public.shifts(id),nurse_id uuid not null references public.staff(id),
 cash numeric(14,2) not null check(cash>=0),terminal numeric(14,2) not null check(terminal>=0),owner_card numeric(14,2) not null check(owner_card>=0),
 cash_received numeric(14,2) not null check(cash_received>=cash),change_amount numeric(14,2) not null check(change_amount=cash_received-cash),
 created_by uuid not null,created_at timestamptz not null default now(),comment text,
 check(cash+terminal+owner_card>0),
 check((kind='procedure' and procedure_id is not null and sale_id is null) or(kind='sale' and sale_id is not null and procedure_id is null))
);
create index if not exists crm_receipts_procedure_v10 on private.crm_receipts_v10(procedure_id) where procedure_id is not null;
create index if not exists crm_receipts_sale_v10 on private.crm_receipts_v10(sale_id) where sale_id is not null;
create index if not exists crm_receipts_shift_v10 on private.crm_receipts_v10(shift_id);
create index if not exists crm_receipts_at_v10 on private.crm_receipts_v10(created_at);
create table if not exists private.crm_stock_returns_v10 (
 id uuid primary key default gen_random_uuid(),movement_id uuid not null references public.stock_movements(id),
 request_id uuid not null references private.warehouse_requests(id),quantity numeric(12,3) not null check(quantity>0),
 unique(movement_id,request_id)
);
create index if not exists procedures_patient_v10 on public.procedures(patient_id);
create index if not exists sales_patient_v10 on public.sales(patient_id) where patient_id is not null;
alter table private.crm_treatment_services enable row level security;
alter table private.crm_own_medications enable row level security;
alter table private.crm_receipts_v10 enable row level security;
alter table private.crm_stock_returns_v10 enable row level security;
revoke all on private.crm_treatment_services,private.crm_own_medications,private.crm_receipts_v10,private.crm_stock_returns_v10 from public,anon,authenticated;

create or replace function private.crm_actor_staff_v10() returns uuid
language sql stable security invoker set search_path='' as $$select id from public.staff where active and auth_user_id=auth.uid() limit 1;$$;

create or replace function private.crm_validate_status_v10(p_status text,p_charge numeric,p_received numeric) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_status is null then return;end if; -- Existing clients predate debt selection.
 if p_status not in ('paid','debt','free') then raise exception 'Выберите состояние оплаты';end if;
 if p_status='paid' and p_received<>p_charge then raise exception 'Для полной оплаты распределите всю сумму';end if;
 if p_status='debt' and p_received>=p_charge then raise exception 'Для оплаты в долг должен остаться долг';end if;
 if p_status='free' and(p_charge<>0 or p_received<>0) then raise exception 'У бесплатной процедуры стоимость и оплата равны нулю';end if;
end $$;

create or replace function private.crm_validate_payment_v10(p_pay jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c numeric;t numeric;o numeric;r numeric;
begin
 if jsonb_typeof(p_pay) is distinct from 'object' then raise exception 'Укажите способы оплаты';end if;
 if exists(select 1 from jsonb_object_keys(p_pay) k where k not in ('cash','terminal','owner_card','cash_received')) then raise exception 'Неизвестный способ оплаты';end if;
 c:=coalesce((p_pay->>'cash')::numeric,0);t:=coalesce((p_pay->>'terminal')::numeric,0);o:=coalesce((p_pay->>'owner_card')::numeric,0);r:=coalesce((p_pay->>'cash_received')::numeric,c);
 if exists(select 1 from unnest(array[c,t,o,r]) n where n<0 or n<>round(n,2) or n::text in ('NaN','Infinity','-Infinity') or n>9999999999.99) then raise exception 'Проверьте суммы оплаты';end if;
 if r<c or(c=0 and r<>0) then raise exception 'Проверьте полученные наличные';end if;
 return jsonb_build_object('cash',c,'terminal',t,'owner_card',o,'cash_received',r,'change',r-c,'total',c+t+o);
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
  'debt_total',greatest((a->>'charge_total')::numeric-(a->>'paid_total')::numeric-more_n,0),'payment_only',not(a->>'stock_deducted')::boolean,
  'medications',a->'items','editable',private.is_manager() or((a->>'nurse_id')::uuid=private.crm_actor_staff_v10() and exists(select 1 from public.shifts sh join public.shift_staff ss on ss.shift_id=sh.id where sh.id=(a->>'shift_id')::uuid and sh.status='open' and ss.staff_id=private.crm_actor_staff_v10())));
end $$;

-- Capture authoritative current prices on creation and captured prices on edit.
create or replace function private.crm_prepare_treatment_v10(p_kind text,p_payload jsonb,p_original jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare items jsonb:=coalesce(p_payload->'items','[]');services jsonb;own_n jsonb:=coalesce(p_payload->'own_medications','[]');
 i jsonb;m public.medications%rowtype;s public.procedure_services%rowtype;old_n jsonb;
 result_items jsonb:='[]';result_services jsonb:='[]';q numeric;price_n numeric;list_n numeric:=0;work_n numeric:=0;consumables_n numeric:=0;charge_n numeric;reason_n text;comment_n text;
begin
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>200 then raise exception 'Проверьте список препаратов';end if;
 for i in select value from jsonb_array_elements(items) loop
  q:=(i->>'quantity')::numeric;
  if nullif(i->>'medication_id','') is null or q is null or q<=0 or q<>trunc(q) or q>1000000 or q::text in ('NaN','Infinity','-Infinity') then raise exception 'Укажите целое количество препарата';end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('medication_id',z.id,'quantity',z.q) order by z.id),'[]') into items from(select (x->>'medication_id')::uuid id,sum((x->>'quantity')::numeric) q from jsonb_array_elements(items) x group by 1) z;
 if p_kind='sale' and jsonb_array_length(items)=0 then raise exception 'Добавьте препарат';end if;
 for i in select value from jsonb_array_elements(items) loop
  select * into m from public.medications where id=(i->>'medication_id')::uuid for update;
  if not found then raise exception 'Препарат не найден';end if;
  select value into old_n from jsonb_array_elements(coalesce(p_original->'items','[]')) where value->>'medication_id'=m.id::text limit 1;
  if not m.active and(old_n is null or(i->>'quantity')::numeric>(old_n->>'quantity')::numeric) then raise exception 'Архивный препарат можно только оставить или уменьшить в исходной записи';end if;
  if old_n is null then
   if not m.active or m.sale_price is null or m.sale_price<=0 or m.sale_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Укажите действующий препарат с ценой';end if;
   price_n:=m.sale_price;
  else price_n:=(old_n->>'unit_price')::numeric;end if;
  q:=(i->>'quantity')::numeric;list_n:=list_n+round(price_n*q,2);
  result_items:=result_items||jsonb_build_array(i||jsonb_build_object('unit_price',price_n,'line_total',round(price_n*q,2)));
 end loop;
 if p_kind='procedure' then
  services:=coalesce(p_payload->'services',jsonb_build_array(jsonb_build_object('service_id',p_payload->>'service_id','quantity',1)));
  if jsonb_typeof(services)<>'array' or jsonb_array_length(services) not between 1 and 100 then raise exception 'Добавьте услугу';end if;
  if exists(select 1 from jsonb_array_elements(services) x group by x->>'service_id' having count(*)>1) then raise exception 'Объедините повторяющиеся услуги';end if;
  for i in select value from jsonb_array_elements(services) loop
   q:=coalesce((i->>'quantity')::numeric,1);
   if nullif(i->>'service_id','') is null or q<=0 or q<>trunc(q) or q>1000 or q::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте услугу и количество';end if;
   select value into old_n from jsonb_array_elements(coalesce(p_original->'services','[]')) where value->>'service_id'=i->>'service_id' limit 1;
   if old_n is null then
    select * into s from public.procedure_services where id=(i->>'service_id')::uuid and active for share;
    if not found then raise exception 'Выберите действующую услугу';end if;
    old_n:=jsonb_build_object('service_id',s.id,'name',s.name,'work_price',s.work_price,'consumables_price',s.consumables_price);
   end if;
   if(old_n->>'work_price')::numeric<0 or(old_n->>'consumables_price')::numeric<0 or(old_n->>'work_price')::numeric::text in ('NaN','Infinity','-Infinity') or(old_n->>'consumables_price')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте цены услуги';end if;
   work_n:=work_n+(old_n->>'work_price')::numeric*q;consumables_n:=consumables_n+(old_n->>'consumables_price')::numeric*q;
   result_services:=result_services||jsonb_build_array(old_n||jsonb_build_object('quantity',q));
  end loop;
 end if;
 if jsonb_typeof(own_n)<>'array' or jsonb_array_length(own_n)>200 or(p_kind='sale' and jsonb_array_length(own_n)>0) then raise exception 'Проверьте препараты пациента';end if;
 for i in select value from jsonb_array_elements(own_n) loop
  q:=(i->>'quantity')::numeric;
  if coalesce(length(trim(i->>'name')),0) not between 1 and 500 or q is null or q<=0 or q<>trunc(q) or q>1000000 or q::text in ('NaN','Infinity','-Infinity') or coalesce(i->>'source','patient') not in ('patient','previously_purchased') or coalesce(length(i->>'unit'),0)>100 then raise exception 'Укажите название и целое количество препарата пациента';end if;
 end loop;
 list_n:=round(list_n+work_n+consumables_n,2);
 if p_payload ? 'charge_total' then charge_n:=(p_payload->>'charge_total')::numeric;
 elsif p_original is not null then charge_n:=list_n-((p_original->>'list_total')::numeric-(p_original->>'charge_total')::numeric);
 elsif p_payload ? 'paid_total' then charge_n:=(p_payload->>'paid_total')::numeric;
 else charge_n:=list_n;end if;
 if charge_n is null or charge_n<0 or charge_n>list_n or charge_n<>round(charge_n,2) or charge_n::text in ('NaN','Infinity','-Infinity') then raise exception 'Сумма к оплате должна быть от нуля до суммы по прайсу';end if;
 reason_n:=nullif(trim(p_payload->>'discount_reason'),'');comment_n:=nullif(trim(p_payload->>'discount_comment'),'');
 if charge_n<>list_n or p_payload->>'payment_status'='free' then
  if reason_n is null or comment_n is null then raise exception 'Укажите причину и обязательный комментарий к скидке или бесплатной процедуре';end if;
 else reason_n:=null;comment_n:=null;end if;
 return jsonb_build_object('items',result_items,'services',result_services,'own_medications',own_n,'list_total',list_n,'charge_total',charge_n,'work_price',work_n,'consumables_price',consumables_n,
  'discount_amount',list_n-charge_n,'discount_percent',case when list_n>0 then round((list_n-charge_n)*100/list_n,2) else 0 end,'discount_reason',reason_n,'discount_comment',comment_n);
end $$;

create or replace function private.crm_save_details_v10(p_kind text,p_id uuid,p_data jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare i jsonb;pos integer:=0;
begin
 if p_kind='procedure' then
  delete from public.procedure_medications where procedure_id=p_id;
  delete from private.crm_treatment_services where procedure_id=p_id;
  delete from private.crm_own_medications where procedure_id=p_id;
  for i in select value from jsonb_array_elements(p_data->'items') loop
   insert into public.procedure_medications(procedure_id,medication_id,quantity,unit_price,line_total) values(p_id,(i->>'medication_id')::uuid,(i->>'quantity')::numeric,(i->>'unit_price')::numeric,(i->>'line_total')::numeric);
  end loop;
  for i in select value from jsonb_array_elements(p_data->'services') loop
   insert into private.crm_treatment_services(procedure_id,position,service_id,name,quantity,work_price,consumables_price) values(p_id,pos,(i->>'service_id')::uuid,i->>'name',(i->>'quantity')::numeric,(i->>'work_price')::numeric,(i->>'consumables_price')::numeric);pos:=pos+1;
  end loop;pos:=0;
  for i in select value from jsonb_array_elements(p_data->'own_medications') loop
   insert into private.crm_own_medications(kind,procedure_id,position,name,quantity,unit,source) values(p_kind,p_id,pos,trim(i->>'name'),(i->>'quantity')::numeric,coalesce(nullif(trim(i->>'unit'),''),'амп.'),coalesce(i->>'source','patient'));pos:=pos+1;
  end loop;
 else
  delete from public.sale_items where sale_id=p_id;
  for i in select value from jsonb_array_elements(p_data->'items') loop
   insert into public.sale_items(sale_id,medication_id,quantity,unit_price,line_total) values(p_id,(i->>'medication_id')::uuid,(i->>'quantity')::numeric,(i->>'unit_price')::numeric,(i->>'line_total')::numeric);
  end loop;
 end if;
end $$;

-- Return only the exact original batches actually consumed by this record.
create or replace function private.crm_return_consumed_v10(p_kind text,p_id uuid,p_med uuid,p_qty numeric,p_req uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare x record;take_n numeric;left_n numeric:=p_qty;
begin
 perform 1 from public.medications where id=p_med for update;
 perform private.assert_stock_v3(p_med);
 for x in select m.id,m.batch_id,m.quantity-coalesce((select sum(r.quantity) from private.crm_stock_returns_v10 r where r.movement_id=m.id),0) available
  from public.stock_movements m where m.medication_id=p_med and m.movement_type=case when p_kind='procedure' then 'procedure_use' else 'sale' end
  and(case when p_kind='procedure' then m.procedure_id=p_id else m.sale_id=p_id end) order by m.created_at desc,m.id desc for update
 loop
  exit when left_n<=0;if x.available<=0 then continue;end if;
  if x.batch_id is null then raise exception 'Для корректировки нужна исходная партия препарата';end if;
  take_n:=least(left_n,x.available);
  update public.medication_batches set quantity_remaining=quantity_remaining+take_n,work_quantity=work_quantity+take_n where id=x.batch_id and medication_id=p_med;
  if not found then raise exception 'Исходная партия не найдена';end if;
  insert into private.crm_stock_returns_v10(movement_id,request_id,quantity) values(x.id,p_req,take_n);
  insert into public.stock_movements(medication_id,batch_id,movement_type,quantity,from_location,to_location,comment,procedure_id,sale_id)
   values(p_med,x.batch_id,'correction',take_n,null,'work','Возврат исходной партии при исправлении процедуры',case when p_kind='procedure' then p_id end,case when p_kind='sale' then p_id end);
  left_n:=left_n-take_n;
 end loop;
 if left_n>0 then raise exception 'Количество возврата превышает исходное списание';end if;
 insert into public.stock(medication_id,location,quantity) values(p_med,'work',p_qty) on conflict(medication_id,location) do update set quantity=public.stock.quantity+excluded.quantity,updated_at=now();
 perform private.assert_stock_v3(p_med);
end $$;

-- The old trigger must not interpret an unpaid bill as a discount.
create or replace function private.crm_no_nurse_discount_v5() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.charge_total is null then new.charge_total:=new.paid_total;end if;
 if new.charge_total<0 or new.charge_total>new.list_total or new.paid_total<0 or new.paid_total>new.charge_total then raise exception 'Проверьте сумму и оплату';end if;
 if new.charge_total<>new.list_total and(nullif(trim(new.discount_reason),'') is null or nullif(trim(new.discount_comment),'') is null) then raise exception 'Укажите причину и обязательный комментарий к скидке';end if;
 return new;
end $$;

create or replace function private.crm_record_treatment_v10(p_kind text,p_payload jsonb,p_request_id uuid,p_allocated boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;role_n text;req private.warehouse_requests%rowtype;sh uuid;nurse uuid;patient uuid;data_n jsonb;pay jsonb;paid_n numeric;id_n uuid;stock_n boolean;reserve_n boolean;item jsonb;available_n numeric;missing_n numeric;answer jsonb;
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
 if paid_n<(data_n->>'charge_total')::numeric and patient is null then raise exception 'Для оплаты в долг выберите пациента';end if;
 if p_kind='procedure' then
  insert into public.procedures(patient_id,shift_id,nurse_id,service_id,procedure_type,work_price,consumables_price,list_total,charge_total,discount_amount,discount_percent,discount_reason,discount_comment,paid_total,notes,stock_deducted)
   values(patient,sh,nurse,(data_n->'services'->0->>'service_id')::uuid,data_n->'services'->0->>'name',(data_n->>'work_price')::numeric,(data_n->>'consumables_price')::numeric,(data_n->>'list_total')::numeric,(data_n->>'charge_total')::numeric,(data_n->>'discount_amount')::numeric,(data_n->>'discount_percent')::numeric,data_n->>'discount_reason',data_n->>'discount_comment',paid_n,p_payload->>'notes',stock_n) returning id into id_n;
 else
  insert into public.sales(shift_id,nurse_id,patient_id,list_total,charge_total,discount_amount,discount_percent,discount_reason,discount_comment,paid_total,notes,stock_deducted)
   values(sh,nurse,patient,(data_n->>'list_total')::numeric,(data_n->>'charge_total')::numeric,(data_n->>'discount_amount')::numeric,(data_n->>'discount_percent')::numeric,data_n->>'discount_reason',data_n->>'discount_comment',paid_n,p_payload->>'notes',stock_n) returning id into id_n;
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
create or replace function private.record_treatment_v5(p_kind text,p_payload jsonb,p_request_id uuid) returns jsonb
language sql security definer set search_path='' as $$ select private.crm_record_treatment_v10(p_kind,p_payload,p_request_id,true);$$;
create or replace function private.record_treatment_v3(p_kind text,p_payload jsonb,p_request_id uuid) returns jsonb
language sql security definer set search_path='' as $$ select private.crm_record_treatment_v10(p_kind,p_payload,p_request_id,false);$$;

create or replace function private.crm_add_receipt_v10(p_kind text,p_id uuid,p_shift uuid,p_nurse uuid,p_pay jsonb,p_request uuid,p_comment text) returns void
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=private.crm_actor_staff_v10();p jsonb:=private.crm_validate_payment_v10(p_pay-'total'-'change');
begin
 if(p->>'total')::numeric<=0 then raise exception 'Укажите положительную сумму оплаты долга';end if;
 perform 1 from public.shifts where id=p_shift and status='open' for update;
 if not found then raise exception 'Для приёма оплаты выберите открытую смену';end if;
 if not private.is_manager() and not exists(select 1 from public.shift_staff where shift_id=p_shift and staff_id=actor) then raise exception 'Нет доступа к смене оплаты';end if;
 if not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=p_shift and ss.staff_id=p_nurse and st.active and st.role='nurse') then raise exception 'Выберите медсестру смены оплаты';end if;
 insert into private.crm_receipts_v10(id,kind,procedure_id,sale_id,shift_id,nurse_id,cash,terminal,owner_card,cash_received,change_amount,created_by,comment)
 values(p_request,p_kind,case when p_kind='procedure' then p_id end,case when p_kind='sale' then p_id end,p_shift,p_nurse,(p->>'cash')::numeric,(p->>'terminal')::numeric,(p->>'owner_card')::numeric,(p->>'cash_received')::numeric,(p->>'change')::numeric,auth.uid(),nullif(trim(p_comment),''));
end $$;

create or replace function private.crm_clinical_v10(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;role_n text;kind_n text:=coalesce(p_payload->>'kind','procedure');id_n uuid;patient_n uuid;req private.warehouse_requests%rowtype;
 original jsonb;updated_n jsonb;data_n jsonb;pay jsonb;result_n jsonb;item record;old_q numeric;new_q numeric;sh uuid;pay_shift uuid;pay_nurse uuid;editable_n boolean;reason_n text;
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
  if kind_n='procedure' then update public.procedures set version=version+1 where id=id_n;
  else update public.sales set version=version+1 where id=id_n;end if;
 else
  reason_n:=nullif(trim(p_payload->>'edit_reason'),'');
  if reason_n is null then raise exception 'Укажите, что изменили и почему';end if;
  editable_n:=(original->>'editable')::boolean;
  if not editable_n then raise exception 'Редактировать можно свою процедуру в открытой смене. Другие записи исправляет владелец';end if;
  if nullif(p_payload->>'expected_version','') is null or(p_payload->>'expected_version')::integer<>(original->>'version')::integer then raise exception 'Запись уже изменена. Откройте её заново';end if;
  if jsonb_typeof(p_payload->'expected_stock_deducted') is distinct from 'boolean' or(p_payload->>'expected_stock_deducted')::boolean<>(original->>'stock_deducted')::boolean then raise exception 'Режим исходной процедуры не совпадает';end if;
  if(p_payload ? 'patient_id' and(p_payload->>'patient_id') is distinct from(original->>'patient_id')) or(p_payload ? 'shift_id' and(p_payload->>'shift_id') is distinct from(original->>'shift_id')) or(p_payload ? 'nurse_id' and(p_payload->>'nurse_id') is distinct from(original->>'nurse_id')) then raise exception 'Пациент, смена и медсестра исходной записи не меняются';end if;
  perform 1 from public.medications where id in(select(x->>'medication_id')::uuid from jsonb_array_elements(original->'items') x union select(x->>'medication_id')::uuid from jsonb_array_elements(coalesce(p_payload->'items','[]')) x) order by id for update;
  data_n:=private.crm_prepare_treatment_v10(kind_n,p_payload,original);
  perform private.crm_validate_status_v10(p_payload->>'payment_status',(data_n->>'charge_total')::numeric,(original->>'paid_total')::numeric+(pay->>'total')::numeric);
  if(data_n->>'charge_total')::numeric<(original->>'paid_total')::numeric+(pay->>'total')::numeric then raise exception 'Новая сумма меньше уже полученной оплаты. Нужен отдельный возврат владельца';end if;
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
    discount_reason=data_n->>'discount_reason',discount_comment=data_n->>'discount_comment',notes=p_payload->>'notes',version=version+1 where id=id_n;
  else
   update public.sales set list_total=(data_n->>'list_total')::numeric,charge_total=(data_n->>'charge_total')::numeric,discount_amount=(data_n->>'discount_amount')::numeric,discount_percent=(data_n->>'discount_percent')::numeric,
    discount_reason=data_n->>'discount_reason',discount_comment=data_n->>'discount_comment',notes=p_payload->>'notes',version=version+1 where id=id_n;
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
create or replace function public.crm_clinical_v10(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$select private.crm_clinical_v10(p_action,p_payload,p_request_id);$$;

-- Preserve the established warehouse/payroll calculations and overlay clinical v10.
do $$begin
 if to_regprocedure('private.crm_build_shift_report_legacy_v9(uuid)') is null then
  alter function private.crm_build_shift_report_v5(uuid) rename to crm_build_shift_report_legacy_v9;
 end if;
end $$;
create or replace function private.crm_build_shift_report_v5(p_shift uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a jsonb:=private.crm_build_shift_report_legacy_v9(p_shift);receipts_n jsonb;r jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'procedure_id',x.procedure_id,'sale_id',x.sale_id,'patient_id',coalesce(p.patient_id,s.patient_id),'patient',pt.full_name,'at',x.created_at,'nurse',st.full_name,
  'paid_total',x.cash+x.terminal+x.owner_card,'comment',x.comment,'payments',jsonb_build_object('cash',x.cash,'terminal',x.terminal,'owner_card',x.owner_card,'cash_received',x.cash_received,'change',x.change_amount)) order by x.created_at,x.id),'[]') into receipts_n
  from private.crm_receipts_v10 x left join public.procedures p on p.id=x.procedure_id left join public.sales s on s.id=x.sale_id left join public.patients pt on pt.id=coalesce(p.patient_id,s.patient_id) join public.staff st on st.id=x.nurse_id where x.shift_id=p_shift;
 select jsonb_build_object('cash',coalesce(sum(cash),0),'terminal',coalesce(sum(terminal),0),'owner_card',coalesce(sum(owner_card),0),'total',coalesce(sum(cash+terminal+owner_card),0)) into r from private.crm_receipts_v10 where shift_id=p_shift;
 return a||jsonb_build_object('procedures',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('procedure',p.id)||jsonb_build_object('paid_total',p.paid_total) order by p.visit_at,p.id) from public.procedures p where p.shift_id=p_shift),'[]'),
  'sales',coalesce((select jsonb_agg(private.crm_treatment_snapshot_v10('sale',s.id)||jsonb_build_object('paid_total',s.paid_total) order by s.sold_at,s.id) from public.sales s where s.shift_id=p_shift),'[]'),
  'receipts',receipts_n,'debt_receipts_total',(r->>'total')::numeric,
  'charge_total',coalesce((select sum(charge_total) from public.procedures where shift_id=p_shift),0)+coalesce((select sum(charge_total) from public.sales where shift_id=p_shift),0),
  'debt_created_total',coalesce((select sum(charge_total-paid_total) from public.procedures where shift_id=p_shift),0)+coalesce((select sum(charge_total-paid_total) from public.sales where shift_id=p_shift),0),
  'debt_total',coalesce((select sum((private.crm_treatment_snapshot_v10('procedure',id)->>'debt_total')::numeric) from public.procedures where shift_id=p_shift),0)+coalesce((select sum((private.crm_treatment_snapshot_v10('sale',id)->>'debt_total')::numeric) from public.sales where shift_id=p_shift),0),
  'revenue',(a->'revenue')||jsonb_build_object('cash',(a->'revenue'->>'cash')::numeric+(r->>'cash')::numeric,'terminal',(a->'revenue'->>'terminal')::numeric+(r->>'terminal')::numeric,'owner_card',(a->'revenue'->>'owner_card')::numeric+(r->>'owner_card')::numeric,'total',(a->'revenue'->>'total')::numeric+(r->>'total')::numeric),
  'cash_after_salary',case when(a->>'payroll_complete')::boolean then(a->'revenue'->>'total')::numeric+(r->>'total')::numeric-(a->>'payroll_total')::numeric end);
end $$;

create or replace function private.crm_refresh_closed_report_v10(p_shift uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare fresh jsonb;
begin
 if not exists(select 1 from private.crm_shift_reports where shift_id=p_shift) then return;end if;
 fresh:=private.crm_build_shift_report_v5(p_shift);
 -- Warehouse and the closed payroll snapshot are never replaced by present stock.
 update private.crm_shift_reports set report=report||jsonb_build_object(
  'procedures',fresh->'procedures','sales',fresh->'sales','receipts',fresh->'receipts',
  'charge_total',fresh->'charge_total','debt_total',fresh->'debt_total',
  'debt_created_total',fresh->'debt_created_total','debt_receipts_total',fresh->'debt_receipts_total',
  'revenue',fresh->'revenue','cash_after_salary',case when coalesce((report->>'payroll_complete')::boolean,false)
   then(fresh->'revenue'->>'total')::numeric-(report->>'payroll_total')::numeric end) where shift_id=p_shift;
end $$;

create or replace function private.crm_nurse_shift_report_v10(p_report jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
select(p_report-'stock'-'used'-'untracked'-'warnings'-'float_amount'-'payroll_total'-'payroll_closed'-'payroll_open'-'payroll_unknown'-'payroll_complete'-'cash_after_salary')||jsonb_build_object('staff',coalesce((select jsonb_agg(x-'amount'-'reason') from jsonb_array_elements(coalesce(p_report->'staff','[]')) x),'[]'));
$$;

CREATE OR REPLACE FUNCTION private.crm_finance_v5(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; role_name text; sh uuid; staff_n uuid; wage numeric; old_n jsonb; new_n jsonb; answer jsonb; settings_n private.crm_finance_settings%rowtype; reason_n text; payroll_n numeric; unknown_n integer;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Проверьте параметры';end if;
 if p_action='accounting_mode' then
  select * into settings_n from private.crm_finance_settings where id;
  if not found then raise exception 'Настройки финансов не найдены';end if;
  return jsonb_build_object('payment_only',settings_n.payment_only,'stock_deducted',not settings_n.payment_only);
 end if;
 if p_action='summary' then return private.crm_finance_summary_v5(p_payload);end if;
 if p_action in ('settings_get','settings_save') then
  if role_name='nurse' then raise exception 'Настройки доступны только владельцу';end if;
  select * into settings_n from private.crm_finance_settings where id for update;
  old_n:=to_jsonb(settings_n)-'updated_by'-'updated_at'-'id';
  if not found then raise exception 'Настройки финансов не найдены';end if;
  if p_action='settings_save' then
   if p_payload ? 'payment_only' and jsonb_typeof(p_payload->'payment_only') is distinct from 'boolean' then
    raise exception 'Режим учёта должен быть включён или выключен';
   end if;
   wage:=coalesce((p_payload->>'float_amount')::numeric,settings_n.float_amount);
   if wage<0 or wage<>round(wage,2) or wage::text in ('NaN','Infinity','-Infinity') or wage>999999999999.99 then raise exception 'Проверьте разменный фонд';end if;
   if coalesce(p_payload->>'time_zone',settings_n.time_zone)<>'Europe/Moscow' then raise exception 'Учёт смен и сроков годности ведётся по московскому времени';end if;
   update private.crm_finance_settings set float_amount=wage,time_zone=coalesce(p_payload->>'time_zone',time_zone),payment_only=case when p_payload ? 'payment_only' then (p_payload->>'payment_only')::boolean else payment_only end,updated_by=auth.uid(),updated_at=now() where id returning * into settings_n;
   new_n:=to_jsonb(settings_n)-'updated_by'-'updated_at'-'id';
   insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,before_data,after_data)
   values(auth.uid(),actor,'finance_settings_changed','settings','finance',old_n,new_n);
  end if;
  return to_jsonb(settings_n)-'updated_by'-'updated_at'-'id';
 end if;
 if p_action not in ('shift_report','close','salary') or p_action is null then raise exception 'Неизвестная операция';end if;
 sh:=nullif(p_payload->>'shift_id','')::uuid;
 perform 1 from public.shifts where id=sh for update;
 if not found then raise exception 'Смена не найдена';end if;
 if role_name='nurse' and not exists(select 1 from public.shift_staff where shift_id=sh and staff_id=actor) then raise exception 'Нет доступа к смене';end if;
 if p_action='salary' then
  if role_name='nurse' then raise exception 'Зарплату изменяет только владелец';end if;
  staff_n:=(p_payload->>'staff_id')::uuid;wage:=(p_payload->>'amount')::numeric;reason_n:=nullif(trim(p_payload->>'reason'),'');
  if wage is null or wage<0 or wage<>round(wage,2) or wage::text in ('NaN','Infinity','-Infinity') or wage>999999999999.99 or reason_n is null then raise exception 'Укажите сумму зарплаты и причину изменения';end if;
  if not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=sh and ss.staff_id=staff_n and st.role='nurse') then raise exception 'Сотрудник не относится к смене';end if;
  select to_jsonb(w) into old_n from private.crm_shift_payroll w where shift_id=sh and staff_id=staff_n for update;
  insert into private.crm_shift_payroll(shift_id,staff_id,amount,reason,updated_by) values(sh,staff_n,wage,reason_n,auth.uid())
  on conflict(shift_id,staff_id) do update set amount=excluded.amount,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now() returning to_jsonb(crm_shift_payroll) into new_n;
  insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,before_data,after_data,reason)
  values(auth.uid(),actor,'salary_changed','shift_staff',sh::text||'/'||staff_n::text,old_n,new_n,reason_n);
  -- Keep stock and activity frozen; overlay explicitly audited payroll corrections only.
  select coalesce(sum(amount),0) into payroll_n from private.crm_shift_payroll where shift_id=sh;
  select count(*) into unknown_n from public.shift_staff ss join public.staff st on st.id=ss.staff_id
   left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=sh and st.role='nurse' and w.shift_id is null;
  update private.crm_shift_reports r set report=report||jsonb_build_object('staff',(select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name,'amount',w.amount,'reason',w.reason) order by st.full_name)
   from public.shift_staff ss join public.staff st on st.id=ss.staff_id left join private.crm_shift_payroll w on w.shift_id=ss.shift_id and w.staff_id=ss.staff_id where ss.shift_id=sh),
   'payroll_total',payroll_n,'payroll_unknown',unknown_n,'payroll_complete',unknown_n=0,'cash_after_salary',case when unknown_n=0 then (report->'revenue'->>'total')::numeric-payroll_n end) where shift_id=sh;
 elsif p_action='close' then
  if not exists(select 1 from private.crm_shift_reports where shift_id=sh) then
   update public.shifts set status='closed',ended_at=coalesce(ended_at,now()) where id=sh;
   answer:=private.crm_build_shift_report_v5(sh);
   insert into private.crm_shift_reports(shift_id,report,closed_by) values(sh,answer,auth.uid());
   insert into private.crm_audit_log(actor_user,actor_staff,action,entity_type,entity_id,after_data)
   values(auth.uid(),actor,'shift_closed','shift',sh::text,jsonb_build_object('status','closed'));
  end if;
 end if;
 perform private.crm_refresh_closed_report_v10(sh);
 select report into answer from private.crm_shift_reports where shift_id=sh;
 if not found then answer:=private.crm_build_shift_report_v5(sh);end if;
 if role_name='nurse' then return private.crm_nurse_shift_report_v10(answer);end if;
 return answer;
end $function$
;

revoke all on function private.crm_actor_staff_v10(),private.crm_validate_status_v10(text,numeric,numeric),private.crm_refresh_closed_report_v10(uuid),private.crm_validate_payment_v10(jsonb),private.crm_treatment_snapshot_v10(text,uuid),private.crm_prepare_treatment_v10(text,jsonb,jsonb),private.crm_save_details_v10(text,uuid,jsonb),private.crm_return_consumed_v10(text,uuid,uuid,numeric,uuid),private.crm_add_receipt_v10(text,uuid,uuid,uuid,jsonb,uuid,text),private.crm_build_shift_report_v5(uuid),private.crm_build_shift_report_legacy_v9(uuid),private.crm_nurse_shift_report_v10(jsonb) from public,anon,authenticated;
revoke all on function private.crm_record_treatment_v10(text,jsonb,uuid,boolean),private.crm_clinical_v10(text,jsonb,uuid),public.crm_clinical_v10(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.crm_clinical_v10(text,jsonb,uuid),public.crm_clinical_v10(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
