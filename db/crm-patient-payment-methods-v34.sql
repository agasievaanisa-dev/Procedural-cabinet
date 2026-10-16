-- Patient/shift snapshots: actual payment channels, with true debt receipts separate.
-- Read-only enrichment only. No historical payment, stock or report is rewritten.
begin;
set local lock_timeout='10s';

alter function private.crm_treatment_snapshot_v10(text,uuid)
 rename to crm_treatment_snapshot_v10_before_v34;

create function private.crm_treatment_snapshot_v10(p_kind text,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare answer_n jsonb;cash_n numeric;terminal_n numeric;card_n numeric;
 initial_classified_n numeric;initial_unknown_n numeric;debt_n numeric;ordinary_n numeric;
begin
 -- Preserve all existing role/editability, pending, partial-stock and lifetime totals.
 answer_n:=private.crm_treatment_snapshot_v10_before_v34(p_kind,p_id);
 select coalesce(sum(a.cash),0),coalesce(sum(a.terminal),0),coalesce(sum(a.owner_card),0)
 into cash_n,terminal_n,card_n
 from private.crm_payment_allocations a where a.voided_at is null and
  ((p_kind='procedure' and a.procedure_id=p_id)or(p_kind='sale' and a.sale_id=p_id));
 initial_classified_n:=cash_n+terminal_n+card_n;
 -- Older paid records may have no channel allocation. Never guess that this was cash.
 initial_unknown_n:=greatest(coalesce((answer_n->>'initial_paid_total')::numeric,0)-initial_classified_n,0);
 select cash_n+coalesce(sum(r.cash) filter(where not r.is_debt_repayment),0),
  terminal_n+coalesce(sum(r.terminal) filter(where not r.is_debt_repayment),0),
  card_n+coalesce(sum(r.owner_card) filter(where not r.is_debt_repayment),0),
  initial_unknown_n+coalesce(sum(r.unclassified_amount) filter(where not r.is_debt_repayment),0),
  coalesce(sum(r.cash+r.terminal+r.owner_card+r.unclassified_amount) filter(where r.is_debt_repayment),0)
 into cash_n,terminal_n,card_n,initial_unknown_n,debt_n
 from private.crm_receipts_v10 r where r.voided_at is null and
  ((p_kind='procedure' and r.procedure_id=p_id)or(p_kind='sale' and r.sale_id=p_id));
 ordinary_n:=cash_n+terminal_n+card_n+initial_unknown_n;
 return answer_n||jsonb_build_object('payments_complete',true,
  'payments',jsonb_build_object('cash',cash_n,'terminal',terminal_n,'owner_card',card_n,
   'unclassified',initial_unknown_n,'total',ordinary_n),
  'debt_repayments_total',debt_n);
end $$;

-- Only the existing authorized SECURITY DEFINER RPCs may call these private helpers.
revoke all on function private.crm_treatment_snapshot_v10(text,uuid),
 private.crm_treatment_snapshot_v10_before_v34(text,uuid) from public,anon,authenticated;
commit;
