-- Shift visit payments use the same receipt scope as the shift's cash totals.
-- Existing clinical/lifetime fields and payment records remain unchanged.
begin;
set local lock_timeout='10s';
do $$begin
 if to_regprocedure('private.crm_shift_treatment_snapshot_v29(text,uuid)') is null
  or to_regprocedure('private.crm_treatment_snapshot_v10_before_v34(text,uuid)') is null then
  raise exception 'Apply the released v29/v34 payment migrations first';
 end if;
end $$;

create or replace function private.crm_shift_treatment_snapshot_v29(p_kind text,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare answer_n jsonb;ordinary_n numeric;shift_n uuid;initial_n numeric;
 cash_n numeric;terminal_n numeric;card_n numeric;unknown_n numeric;shift_receipts_n numeric;
 receipt_cash_n numeric;receipt_terminal_n numeric;receipt_card_n numeric;receipt_unknown_n numeric;
begin
 answer_n:=private.crm_treatment_snapshot_v10(p_kind,p_id);
 shift_n:=nullif(answer_n->>'shift_id','')::uuid;
 initial_n:=coalesce((answer_n->>'initial_paid_total')::numeric,0);
 select coalesce(sum(a.cash),0),coalesce(sum(a.terminal),0),coalesce(sum(a.owner_card),0)
  into cash_n,terminal_n,card_n from private.crm_payment_allocations a
  where a.voided_at is null and((p_kind='procedure' and a.procedure_id=p_id)or(p_kind='sale' and a.sale_id=p_id));
 -- An old paid record without an allocation has an unknown method, never cash.
 unknown_n:=greatest(initial_n-cash_n-terminal_n-card_n,0);
 select coalesce(sum(r.cash+r.terminal+r.owner_card+r.unclassified_amount),0),
  coalesce(sum(r.cash) filter(where r.shift_id=shift_n),0),
  coalesce(sum(r.terminal) filter(where r.shift_id=shift_n),0),
  coalesce(sum(r.owner_card) filter(where r.shift_id=shift_n),0),
  coalesce(sum(r.unclassified_amount) filter(where r.shift_id=shift_n),0)
  into ordinary_n,receipt_cash_n,receipt_terminal_n,receipt_card_n,receipt_unknown_n
  from private.crm_receipts_v10 r where r.voided_at is null and not r.is_debt_repayment
   and((p_kind='procedure' and r.procedure_id=p_id)or(p_kind='sale' and r.sale_id=p_id));
 shift_receipts_n:=receipt_cash_n+receipt_terminal_n+receipt_card_n+receipt_unknown_n;
 return answer_n||jsonb_build_object(
  'lifetime_received_total',answer_n->'received_total','paid_total',answer_n->'initial_paid_total',
  'received_total',initial_n+ordinary_n,
  'payment_scope_v45','shift','shift_received_total_v45',initial_n+shift_receipts_n,
  'shift_payments_v45',jsonb_build_object('cash',cash_n+receipt_cash_n,'terminal',terminal_n+receipt_terminal_n,
   'owner_card',card_n+receipt_card_n,'unclassified',unknown_n+receipt_unknown_n,'total',initial_n+shift_receipts_n),
  'received_other_shifts_v45',ordinary_n-shift_receipts_n);
end $$;
revoke all on function private.crm_shift_treatment_snapshot_v29(text,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
