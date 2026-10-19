-- Run after v45 and the current v47 payment-channel migration.
-- Read-only invariants over actual procedure/sale snapshots; no test patients,
-- receipts, cash movements or financial history are inserted or rewritten.
begin;
set local statement_timeout='90s';
do $$
declare target_n record;scoped_n jsonb;clinical_n jsonb;initial_n numeric;ordinary_n numeric;
 current_cash_n numeric;current_terminal_n numeric;current_card_n numeric;current_other_n numeric;current_receipts_n numeric;
 initial_cash_n numeric;initial_terminal_n numeric;initial_card_n numeric;initial_other_n numeric;
begin
 for target_n in select 'procedure'::text kind,p.id,p.shift_id,p.paid_total from public.procedures p
  union all select 'sale',s.id,s.shift_id,s.paid_total from public.sales s
 loop
  scoped_n:=private.crm_shift_treatment_snapshot_v29(target_n.kind,target_n.id);
  clinical_n:=private.crm_treatment_snapshot_v10(target_n.kind,target_n.id);
  initial_n:=(clinical_n->>'initial_paid_total')::numeric;
  select coalesce(sum(cash),0),coalesce(sum(terminal),0),coalesce(sum(owner_card),0),coalesce(sum(other_card),0)
   into initial_cash_n,initial_terminal_n,initial_card_n,initial_other_n from private.crm_payment_allocations
   where voided_at is null and((target_n.kind='procedure' and procedure_id=target_n.id)or(target_n.kind='sale' and sale_id=target_n.id));
  select coalesce(sum(cash+terminal+owner_card+other_card+unclassified_amount),0),
   coalesce(sum(cash) filter(where shift_id=target_n.shift_id),0),
   coalesce(sum(terminal) filter(where shift_id=target_n.shift_id),0),
   coalesce(sum(owner_card) filter(where shift_id=target_n.shift_id),0),
   coalesce(sum(other_card) filter(where shift_id=target_n.shift_id),0),
   coalesce(sum(cash+terminal+owner_card+other_card+unclassified_amount) filter(where shift_id=target_n.shift_id),0)
   into ordinary_n,current_cash_n,current_terminal_n,current_card_n,current_other_n,current_receipts_n
   from private.crm_receipts_v10 where voided_at is null and not is_debt_repayment
    and((target_n.kind='procedure' and procedure_id=target_n.id)or(target_n.kind='sale' and sale_id=target_n.id));
  if scoped_n->>'payment_scope_v45' is distinct from 'shift'
   or (scoped_n->>'shift_received_total_v45')::numeric is distinct from initial_n+current_receipts_n
   or (scoped_n->'shift_payments_v45'->>'cash')::numeric is distinct from initial_cash_n+current_cash_n
   or (scoped_n->'shift_payments_v45'->>'terminal')::numeric is distinct from initial_terminal_n+current_terminal_n
   or (scoped_n->'shift_payments_v45'->>'owner_card')::numeric is distinct from initial_card_n+current_card_n
   or (scoped_n->'shift_payments_v45'->>'other_card')::numeric is distinct from initial_other_n+current_other_n
   or (scoped_n->'shift_payments_v45'->>'total')::numeric is distinct from initial_n+current_receipts_n
   or (scoped_n->'shift_payments_v45'->>'unclassified')::numeric is distinct from greatest(initial_n-initial_cash_n-initial_terminal_n-initial_card_n-initial_other_n,0)
   or (scoped_n->>'received_other_shifts_v45')::numeric is distinct from ordinary_n-current_receipts_n
   or (scoped_n->>'received_total')::numeric is distinct from initial_n+ordinary_n
   or scoped_n->'lifetime_received_total' is distinct from clinical_n->'received_total'
   or scoped_n->'paid_total' is distinct from clinical_n->'initial_paid_total'
   or scoped_n->'debt_total' is distinct from clinical_n->'debt_total'
   or scoped_n->'payments' is distinct from clinical_n->'payments'
   or scoped_n->'payment_pending' is distinct from clinical_n->'payment_pending'
  then raise exception 'Shift payment scope invariant failed for % %',target_n.kind,target_n.id;end if;
 end loop;
 if exists(select 1 from pg_proc where oid='private.crm_shift_treatment_snapshot_v29(text,uuid)'::regprocedure and prosecdef)
  or has_function_privilege('anon','private.crm_shift_treatment_snapshot_v29(text,uuid)','execute')
  or has_function_privilege('authenticated','private.crm_shift_treatment_snapshot_v29(text,uuid)','execute')
 then raise exception 'The internal snapshot must retain its private security-invoker boundary';end if;
end $$;
rollback;
