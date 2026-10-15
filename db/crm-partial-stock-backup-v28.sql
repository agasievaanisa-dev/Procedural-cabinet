-- Include the partial-inventory policy, per-record ledger and retry receipts in
-- both scheduled backups and the established manager-only download action.
-- Patch only the explicit private-table whitelist; preserve function identity,
-- privileges, security mode, snapshot construction and backup format.
begin;
set local lock_timeout='10s';

do $backup$
declare
 source_n text;anchor_n text:=$anchor$'crm_stock_returns_v10','crm_patient_delete_requests_v10'$anchor$;
 added_n text:=$added$,'crm_partial_stock_tracking_v28','crm_partial_stock_records_v28','crm_partial_stock_lines_v28','crm_partial_stock_requests_v28'$added$;
 table_n text;matches_n integer;present_n integer:=0;
begin
 source_n:=pg_get_functiondef('private.crm_backup_data_v5()'::regprocedure);
 foreach table_n in array array[
  'crm_partial_stock_tracking_v28','crm_partial_stock_records_v28',
  'crm_partial_stock_lines_v28','crm_partial_stock_requests_v28'
 ] loop
  if to_regclass('private.'||table_n) is null then
   raise exception 'Install the partial inventory ledger before its backup coverage: %',table_n;
  end if;
  matches_n:=(length(source_n)-length(replace(source_n,quote_literal(table_n),'')))/length(quote_literal(table_n));
  if matches_n>1 then raise exception 'Unexpected duplicate backup table: %',table_n;end if;
  if matches_n=1 then present_n:=present_n+1;end if;
 end loop;
 -- A successful reapplication leaves the released definition untouched.
 if present_n=4 then return;end if;
 if present_n<>0 then raise exception 'Partial inventory backup whitelist is incomplete';end if;
 matches_n:=(length(source_n)-length(replace(source_n,anchor_n,'')))/length(anchor_n);
 if matches_n<>1 then raise exception 'Expected exactly one released clinical backup whitelist, found %',matches_n;end if;
 execute replace(source_n,anchor_n,anchor_n||added_n);
end $backup$;

commit;
