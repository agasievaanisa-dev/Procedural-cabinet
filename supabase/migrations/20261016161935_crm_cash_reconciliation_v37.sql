-- Mandatory, append-only cash reconciliation before closing a shift.
-- Actual salary payouts use the released v30 cash API only after confirmation.
begin;
set local lock_timeout='10s';

do $copies$
declare r record;source_n text;anchor_n text;
begin
 if to_regprocedure('private.crm_cash_drawers_period_v30(jsonb,boolean)') is null
  or to_regprocedure('private.crm_audit_v5(text,text,text,jsonb,jsonb,text)') is null then
  raise exception 'v37: apply the released v30/v36 cash migrations first';
 end if;
 for r in select * from(values
  ('crm_cash_drawer_facts_v30','uuid,numeric'),('crm_cash_drawer_v30','text,jsonb,uuid')
 ) funcs(name,args) loop
  if to_regprocedure('private.'||r.name||'_before_v37('||r.args||')') is null then
   source_n:=pg_get_functiondef(('private.'||r.name||'('||r.args||')')::regprocedure);
   anchor_n:='FUNCTION private.'||r.name||'(';
   if (length(source_n)-length(replace(source_n,anchor_n,'')))/length(anchor_n)<>1 then
    raise exception 'v37: unexpected released function: %',r.name;
   end if;
   execute replace(source_n,anchor_n,'FUNCTION private.'||r.name||'_before_v37(');
  end if;
 end loop;
 if position('salary_auto_total' in pg_get_functiondef('private.crm_cash_drawer_facts_v30_before_v37(uuid,numeric)'::regprocedure))=0 then
  raise exception 'v37: the v36 automatic salary calculation is required';
 end if;
end $copies$;
revoke all on function private.crm_cash_drawer_facts_v30_before_v37(uuid,numeric),
 private.crm_cash_drawer_v30_before_v37(text,jsonb,uuid) from public,anon,authenticated;

create table if not exists private.crm_cash_counts_v37 (
 id uuid primary key,shift_id uuid not null references public.shifts(id),
 counted_cash numeric(14,2) not null check(counted_cash>=0 and counted_cash<=999999999999.99),
 expected_cash numeric(14,2) not null,difference numeric(14,2) not null,
 reason text not null check(length(reason)<=2000),salary_confirmed boolean not null,
 ledger_token text not null check(ledger_token ~ '^[0-9a-f]{32}$'),financial_snapshot jsonb not null,
 staff_id uuid not null references public.staff(id),staff_name text not null,
 created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 check(difference=counted_cash-expected_cash),check(difference=0 or nullif(trim(reason),'') is not null)
);
create index if not exists crm_cash_counts_shift_v37 on private.crm_cash_counts_v37(shift_id,created_at desc,id desc);
alter table private.crm_cash_counts_v37 enable row level security;
revoke all on private.crm_cash_counts_v37 from public,anon,authenticated;

create or replace function private.crm_cash_count_append_only_v37() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Сохранённую сверку нельзя изменять или удалять. Выполните новую сверку';end $$;
revoke all on function private.crm_cash_count_append_only_v37() from public,anon,authenticated;
drop trigger if exists crm_cash_count_append_only_v37 on private.crm_cash_counts_v37;
create trigger crm_cash_count_append_only_v37 before update or delete on private.crm_cash_counts_v37
 for each row execute function private.crm_cash_count_append_only_v37();

-- No call to the augmented facts function here: snapshots cannot recurse or
-- include counts, wall-clock time, or the shift's closed/ended metadata.
create or replace function private.crm_cash_financial_snapshot_v37(p_shift uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'drawer',private.crm_cash_drawer_facts_v30_before_v37(p_shift),
  'opening',(select to_jsonb(o) from private.crm_cash_openings_v30 o where o.shift_id=p_shift),
  'initial_payments',coalesce((select jsonb_agg(to_jsonb(a) order by a.id)
   from private.crm_payment_allocations a left join public.procedures p on p.id=a.procedure_id
    left join public.sales s on s.id=a.sale_id
   where a.voided_at is null and coalesce(p.shift_id,s.shift_id)=p_shift),'[]'),
  'ordinary_receipts',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r
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
$$;
revoke all on function private.crm_cash_financial_snapshot_v37(uuid) from public,anon,authenticated;

create or replace function private.crm_cash_reconciliation_facts_v37(p_shift uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare ledger_n text;latest_n private.crm_cash_counts_v37%rowtype;history_n jsonb;stale_n boolean;editable_n boolean;
begin
 ledger_n:=md5(private.crm_cash_financial_snapshot_v37(p_shift)::text);
 select * into latest_n from private.crm_cash_counts_v37 where shift_id=p_shift order by created_at desc,id desc limit 1;
 stale_n:=latest_n.id is not null and latest_n.ledger_token is distinct from ledger_n;
 select coalesce(jsonb_agg(to_jsonb(c)-'financial_snapshot'-'ledger_token'-'created_by' order by c.created_at desc,c.id desc),'[]')
  into history_n from private.crm_cash_counts_v37 c where c.shift_id=p_shift;
 select exists(select 1 from public.staff st join public.shifts sh on sh.id=p_shift
  where st.auth_user_id=auth.uid() and st.active and (st.role in('owner','admin')
   or(st.role='nurse' and sh.status='open' and exists(select 1 from public.shift_staff ss where ss.shift_id=p_shift and ss.staff_id=st.id)))) into editable_n;
 return jsonb_build_object('required',true,'editable',editable_n,'token',md5(ledger_n||'|'||coalesce(latest_n.id::text,'')),
  'count',case when latest_n.id is not null then to_jsonb(latest_n)-'financial_snapshot'-'ledger_token'-'created_by' else null end,
  'history',history_n,'stale',stale_n,'can_close',latest_n.id is not null and not stale_n);
end $$;
revoke all on function private.crm_cash_reconciliation_facts_v37(uuid) from public,anon,authenticated;

create or replace function private.crm_cash_drawer_facts_v30(p_shift uuid,p_received_cash numeric default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 return private.crm_cash_drawer_facts_v30_before_v37(p_shift,p_received_cash)
  ||jsonb_build_object('reconciliation_v37',private.crm_cash_reconciliation_facts_v37(p_shift));
end $$;
revoke all on function private.crm_cash_drawer_facts_v30(uuid,numeric) from public,anon,authenticated;

create or replace function private.crm_cash_reconciliation_v37(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare drawer_n jsonb;shift_n uuid;status_n text;actor_n uuid;role_n text;name_n text;
 request_n private.crm_cash_requests_v30%rowtype;reason_n text;counted_n numeric;opening_n numeric;
 confirm_n boolean;person_n jsonb;snapshot_n jsonb;ledger_n text;expected_n numeric;difference_n numeric;answer_n jsonb;child_n uuid;before_n jsonb;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or p_action is null then raise exception 'Проверьте параметры сверки кассы';end if;
 shift_n:=nullif(p_payload->>'shift_id','')::uuid;
 -- Reuse the released active-role and shift-membership authorization first.
 drawer_n:=private.crm_cash_drawer_v30_before_v37('status',jsonb_build_object('shift_id',shift_n));
 if p_action='status' then return drawer_n;end if;
 if p_action<>'save' or p_request_id is null then raise exception 'Укажите операцию сверки и её номер';end if;
 select id,role,full_name into actor_n,role_n,name_n from public.staff where auth_user_id=auth.uid() and active limit 1;
 -- The same request -> shift lock order as v30. Replay precedes CAS and returns
 -- the committed receipt even if a newer count or payment has since appeared.
 insert into private.crm_cash_requests_v30(request_id,actor_user,action,payload)
  values(p_request_id,auth.uid(),'count_save_v37',p_payload) on conflict do nothing;
 select * into request_n from private.crm_cash_requests_v30 where request_id=p_request_id for update;
 if request_n.actor_user is distinct from auth.uid() or request_n.action<>'count_save_v37' or request_n.payload is distinct from p_payload then
  raise exception 'Номер операции уже использован';end if;
 if request_n.result is not null then return request_n.result;end if;
 select status into status_n from public.shifts where id=shift_n for update;
 if role_n='nurse' and status_n<>'open' then raise exception 'Закрытую кассу сверяет только администратор' using errcode='42501';end if;
 drawer_n:=private.crm_cash_drawer_facts_v30(shift_n);
 before_n:=drawer_n->'reconciliation_v37';
 if jsonb_typeof(p_payload->'expected_token') is distinct from 'string'
  or p_payload->>'expected_token' is distinct from drawer_n->'reconciliation_v37'->>'token' then
  raise exception 'Касса изменилась. Обновите данные и пересчитайте наличные перед сверкой' using errcode='40001';end if;
 if jsonb_typeof(p_payload->'counted_cash') not in('number','string') then raise exception 'Укажите фактические наличные';end if;
 counted_n:=nullif(p_payload->>'counted_cash','')::numeric;
 if counted_n is null or counted_n::text in('NaN','Infinity','-Infinity') or counted_n<>round(counted_n,2)
  or counted_n<0 or counted_n>999999999999.99 then raise exception 'Наличные должны быть неотрицательной суммой с точностью до копейки';end if;
 if jsonb_typeof(p_payload->'salary_confirmed') is distinct from 'boolean' then raise exception 'Укажите, выплачена ли зарплата из кассы';end if;
 confirm_n:=(p_payload->>'salary_confirmed')::boolean;
 if jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(p_payload->>'reason')>2000 then
  raise exception 'Комментарий к сверке должен быть строкой до 2000 символов';end if;
 reason_n:=trim(p_payload->>'reason');
 if p_payload?'opening_amount' then
  if jsonb_typeof(p_payload->'opening_amount') not in('number','string') then raise exception 'Укажите наличные на начало смены';end if;
  opening_n:=nullif(p_payload->>'opening_amount','')::numeric;
  if opening_n is null or opening_n::text in('NaN','Infinity','-Infinity') or opening_n<>round(opening_n,2)
   or opening_n<0 or opening_n>999999999999.99 then raise exception 'Проверьте наличные на начало смены';end if;
 end if;
 if not(drawer_n->>'opening_confirmed')::boolean then
  if opening_n is null then raise exception 'Укажите фактические наличные на начало смены; ноль нужно подтвердить явно';end if;
  child_n:=md5('crm-count-v37:opening:'||p_request_id::text)::uuid;
  perform private.crm_cash_drawer_v30_before_v37('opening_set',jsonb_build_object('shift_id',shift_n,'amount',opening_n,
   'reason','Начальные наличные подтверждены при сверке кассы'),child_n);
 elsif opening_n is not null and opening_n is distinct from (drawer_n->>'opening')::numeric then
  raise exception 'Начальный остаток уже указан. Исправьте его отдельно и обновите сверку';
 end if;
 drawer_n:=private.crm_cash_drawer_facts_v30_before_v37(shift_n);
 if confirm_n then
  if exists(select 1 from jsonb_array_elements(drawer_n->'salary_auto_payroll') p
   where p->>'source'='default' and (p->>'outstanding')::numeric>0) then
   raise exception 'Для подтверждения выплаты администратор должен сначала назначить зарплату всем медсёстрам смены';end if;
  -- Only current shift members are payable. Historical payroll rows for a
  -- former member must not block confirmation or create an unrelated payout.
  for person_n in select p from jsonb_array_elements(drawer_n->'salary_auto_payroll') p
   where p->>'source'='assigned' and (p->>'outstanding')::numeric>0 order by p->>'staff_id' loop
   child_n:=md5('crm-count-v37:salary:'||p_request_id::text||':'||(person_n->>'staff_id'))::uuid;
   perform private.crm_cash_drawer_v30_before_v37('movement_add',jsonb_build_object('shift_id',shift_n,'type','salary',
    'staff_id',person_n->>'staff_id','amount',(person_n->>'outstanding')::numeric,
    'reason','Выплата зарплаты подтверждена при сверке кассы'),child_n);
  end loop;
 end if;
 snapshot_n:=private.crm_cash_financial_snapshot_v37(shift_n);
 ledger_n:=md5(snapshot_n::text);expected_n:=(snapshot_n->'drawer'->>'balance')::numeric;
 if expected_n is null then raise exception 'Не удалось определить начальный остаток наличных';end if;
 difference_n:=counted_n-expected_n;
 if difference_n<>0 and nullif(reason_n,'') is null then raise exception 'При расхождении укажите комментарий: почему фактические наличные отличаются';end if;
 insert into private.crm_cash_counts_v37(id,shift_id,counted_cash,expected_cash,difference,reason,salary_confirmed,
  ledger_token,financial_snapshot,staff_id,staff_name,created_by)
 values(p_request_id,shift_n,counted_n,expected_n,difference_n,reason_n,confirm_n,ledger_n,snapshot_n,actor_n,name_n,auth.uid());
 answer_n:=private.crm_cash_drawer_facts_v30(shift_n);
 perform private.crm_audit_v5('cash_count_saved_v37','shift',shift_n::text,
  before_n,answer_n->'reconciliation_v37',nullif(reason_n,''));
 update private.crm_cash_requests_v30 set result=answer_n where request_id=p_request_id;
 return answer_n;
end $$;
revoke all on function private.crm_cash_reconciliation_v37(text,jsonb,uuid) from public,anon,authenticated;

-- Extend an existing guarded entry point without adding another privileged
-- authenticated RPC. Its existing OID, owner, and grants are preserved.
create or replace function private.crm_cash_drawer_v30(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_action in('count_status_v37','count_save_v37') then
  return private.crm_cash_reconciliation_v37(case when p_action='count_status_v37' then 'status' else 'save' end,p_payload,p_request_id);
 end if;
 return private.crm_cash_drawer_v30_before_v37(p_action,p_payload,p_request_id);
end $$;

create or replace function public.crm_cash_reconciliation_v37(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$
 select private.crm_cash_drawer_v30(case p_action when 'status' then 'count_status_v37'
  when 'save' then 'count_save_v37' else 'count_invalid_v37' end,p_payload,p_request_id)
$$;
revoke all on function public.crm_cash_reconciliation_v37(text,jsonb,uuid) from public,anon;
grant execute on function public.crm_cash_reconciliation_v37(text,jsonb,uuid) to authenticated;

create or replace function private.crm_require_cash_count_v37() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not(private.crm_cash_reconciliation_facts_v37(new.id)->>'can_close')::boolean then
  raise exception 'Сначала выполните актуальную сверку кассы перед закрытием смены' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.crm_require_cash_count_v37() from public,anon,authenticated;
drop trigger if exists crm_require_cash_count_v37 on public.shifts;
create trigger crm_require_cash_count_v37 before update of status on public.shifts
 for each row when(new.status='closed' and old.status is distinct from 'closed') execute function private.crm_require_cash_count_v37();

do $backup$
declare source_n text;anchor_n text:=$anchor$'crm_cash_requests_v30'$anchor$;entry_n text:=$entry$'crm_cash_counts_v37'$entry$;hits_n integer;
begin
 source_n:=pg_get_functiondef('private.crm_backup_data_v5()'::regprocedure);
 hits_n:=(length(source_n)-length(replace(source_n,entry_n,'')))/length(entry_n);
 if hits_n=1 then return;elsif hits_n<>0 then raise exception 'v37: duplicate reconciliation backup entry';end if;
 hits_n:=(length(source_n)-length(replace(source_n,anchor_n,'')))/length(anchor_n);
 if hits_n<>1 then raise exception 'v37: unexpected cash backup whitelist';end if;
 execute replace(source_n,anchor_n,anchor_n||','||entry_n);
end $backup$;
notify pgrst,'reload schema';
commit;
