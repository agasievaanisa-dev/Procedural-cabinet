-- Run after both v5 migrations. Every fixture and assertion is rolled back.
-- Only staff login metadata is read; no existing patient records are read.
begin;
select set_config('test.manager',(select auth_user_id::text from public.staff where active and role in ('admin','owner') and auth_user_id is not null limit 1),true);
select set_config('test.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.manager'),'role','authenticated')::text,true);

do $$ declare sh uuid; pt uuid; sv uuid; n uuid; peer uuid; med uuid; day_n date:=date '2091-05-17';
begin
 if nullif(current_setting('test.manager'),'') is null or nullif(current_setting('test.nurse'),'') is null then raise exception 'Tests require one linked manager and nurse account';end if;
 select id into n from public.staff where auth_user_id=current_setting('test.nurse')::uuid and active limit 1;
 insert into public.staff(full_name,role) values('Тест финансов — второй сотрудник','nurse') returning id into peer;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(day_n,now(),now()+interval '8 hours','open') returning id into sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,n),(sh,peer);
 insert into public.patients(full_name,archived,archived_at) values('Тест финансов — архивный пациент',true,now()) returning id into pt;
 perform set_config('test.archived_patient',pt::text,true);
 insert into public.patients(full_name) values('Тест финансов — вымышленный пациент') returning id into pt;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('Тест финансов — услуга',100,50,true) returning id into sv;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
 values('Тест финансов — препарат','амп.',10,100,20,2,1) returning id into med;
 -- A later work batch and an earlier work batch verify FEFO, not insertion order.
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
 values(med,20,20,15,10,current_date+200),(med,10,10,5,10,current_date+100);
 insert into public.stock(medication_id,location,quantity) values(med,'work',20),(med,'reserve',10);
 perform set_config('test.shift',sh::text,true);perform set_config('test.patient',pt::text,true);perform set_config('test.service',sv::text,true);
 perform set_config('test.nurse_id',n::text,true);perform set_config('test.peer',peer::text,true);perform set_config('test.med',med::text,true);
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare payload jsonb; req uuid:=gen_random_uuid(); result_n jsonb; wrong_req uuid; failed boolean; result_report jsonb;
begin
 payload:=jsonb_build_object('shift_id',current_setting('test.shift'),'nurse_id',current_setting('test.nurse_id'),'patient_id',current_setting('test.patient'),
  'service_id',current_setting('test.service'),'paid_total',190,'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.med'),'quantity',2)),
  'payments',jsonb_build_object('cash',90,'terminal',50,'owner_card',50,'cash_received',200));
 result_n:=public.record_treatment_v5('procedure',payload,req);
 if (result_n->'payments'->>'change')::numeric<>110 or(result_n->>'paid_total')::numeric<>190 then raise exception 'Change/revenue wrong: %',result_n;end if;
 if public.record_treatment_v5('procedure',payload,req)<>result_n then raise exception 'Retry is not idempotent';end if;
 perform set_config('test.procedure',result_n->>'id',true);
 failed:=false;
 begin perform public.record_treatment_v5('procedure',payload||jsonb_build_object('patient_id',current_setting('test.archived_patient')),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Archived patient accepted new treatment';end if;
 failed:=false;
 begin perform public.record_treatment_v5('procedure',payload||jsonb_build_object('payments',jsonb_build_object('cash',190)),req);exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Same request accepted a different payment allocation';end if;
 wrong_req:=gen_random_uuid();failed:=false;
 begin perform public.record_treatment_v5('procedure',payload||jsonb_build_object('payments',jsonb_build_object('cash',189)),wrong_req);exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Payment mismatch accepted';end if;
 perform set_config('test.failed_request',wrong_req::text,true);
 failed:=false;
 begin perform public.record_treatment_v5('procedure',payload||jsonb_build_object('paid_total',170,'discount_reason','Акция','payments',jsonb_build_object('cash',170)),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse discount accepted';end if;
 failed:=false;
 begin perform public.record_treatment_v3('procedure',payload||jsonb_build_object('paid_total',170,'discount_reason','Акция'),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Legacy RPC bypasses nurse discount rule';end if;
 failed:=false;
 begin perform public.record_treatment_v5('sale',payload||jsonb_build_object('paid_total',40,'reserve_sale',true,'payments',jsonb_build_object('cash',40)),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse sold from reserve';end if;
 failed:=false;
 begin perform public.crm_finance_v5('summary','{}');exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse financial summary access';end if;
 failed:=false;
 begin perform public.crm_finance_v5('salary',jsonb_build_object('shift_id',current_setting('test.shift'),'staff_id',current_setting('test.nurse_id'),'amount',2500,'reason','Недоступное изменение'));exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse changed salary';end if;
 failed:=false;
 begin perform public.crm_finance_v5('settings_get');exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse settings access';end if;
 result_report:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.shift')));
 if result_report ? 'revenue' or result_report ? 'payroll_total' or result_report->'staff'->0 ? 'amount' or result_report->'procedures'->0 ? 'paid_total' or result_report->'procedures'->0->'items'->0 ? 'line_total' then raise exception 'Nurse report leaks finances: %',result_report;end if;
 if(result_report->>'patients_count')::integer<>1 or(result_report->'used'->0->>'quantity')::numeric<>2 then raise exception 'Nurse operational report wrong';end if;
 result_report:=public.quick_ui_v4('report',jsonb_build_object('shift_id',current_setting('test.shift')));
 if result_report ? 'cash_total' or result_report ? 'revenue' then raise exception 'Legacy quick report leaks';end if;
 result_report:=public.shift_report_detailed_test(current_setting('test.shift')::uuid);
 if result_report ? 'cash_total' then raise exception 'Legacy detailed report leaks';end if;
 result_report:=public.patient_history_v8(current_setting('test.patient')::uuid);
 if result_report->'procedures'->0 ? 'paid_total' or result_report->'procedures'->0->'medications'->0 ? 'line_total' then raise exception 'Patient history leaks finances';end if;
 if exists(select 1 from public.procedures where id=current_setting('test.procedure')::uuid) then raise exception 'Direct nurse table read leaks receipt';end if;
end $$;
reset role;

do $$ begin
 if(select count(*) from public.procedures where shift_id=current_setting('test.shift')::uuid)<>1 then raise exception 'Rollback/idempotency clinical record failure';end if;
 if exists(select 1 from private.warehouse_requests where id=current_setting('test.failed_request')::uuid) then raise exception 'Failed payment left request row';end if;
 if(select quantity from public.stock where medication_id=current_setting('test.med')::uuid and location='work')<>18 then raise exception 'Failed transaction changed stock';end if;
 if(select work_quantity from public.medication_batches where medication_id=current_setting('test.med')::uuid and expiry_date=current_date+100)<>3 then raise exception 'FEFO used wrong batch';end if;
 if(select sum(amount) from private.crm_shift_payroll where shift_id=current_setting('test.shift')::uuid)<>4000 then raise exception 'Default payroll not 2000 per nurse';end if;
 perform private.assert_stock_v3(current_setting('test.med')::uuid);
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare payload jsonb; result_n jsonb; req uuid:=gen_random_uuid(); wrong_req uuid; failed boolean; before_n jsonb; changed_n jsonb; closed_n jsonb; summary_n jsonb; settings_n jsonb;
begin
 -- New allocated sale: revenue counts the price, not the cash tendered.
 payload:=jsonb_build_object('shift_id',current_setting('test.shift'),'nurse_id',current_setting('test.nurse_id'),'patient_id',current_setting('test.patient'),
  'paid_total',400,'reserve_sale',true,'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.med'),'quantity',20)),
  'payments',jsonb_build_object('cash',100,'terminal',200,'owner_card',100,'cash_received',1000));
 -- Legacy history without known payment method stays explicitly unclassified.
 result_n:=public.record_treatment_v3('sale',payload||jsonb_build_object('paid_total',20,'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.med'),'quantity',1))),gen_random_uuid());
 perform set_config('test.legacy_sale',result_n->>'id',true);
 result_n:=public.record_treatment_v5('sale',payload,req);
 if public.record_treatment_v5('sale',payload,req)<>result_n then raise exception 'Reserve sale retry differs';end if;
 perform set_config('test.sale',result_n->>'id',true);
 before_n:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.shift')));
 if before_n->'revenue'<>'{"cash":190,"terminal":250,"owner_card":150,"unclassified":20,"total":610}'::jsonb then raise exception 'Mixed/historical revenue wrong: %',before_n->'revenue';end if;
 if(before_n->>'payroll_total')::numeric<>4000 or(before_n->>'cash_after_salary')::numeric<>-3390 then raise exception 'Salary cash remainder wrong';end if;
 failed:=false;
 begin perform public.crm_finance_v5('salary',jsonb_build_object('shift_id',current_setting('test.shift'),'staff_id',current_setting('test.nurse_id'),'amount',2500));exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Salary changed without reason';end if;
 changed_n:=public.crm_finance_v5('salary',jsonb_build_object('shift_id',current_setting('test.shift'),'staff_id',current_setting('test.nurse_id'),'amount',2500,'reason','Проверка ручной корректировки'));
 if(changed_n->>'payroll_total')::numeric<>4500 then raise exception 'Salary update missing';end if;
 closed_n:=public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.shift')));
 if public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.shift')))<>closed_n then raise exception 'Closed report not idempotent';end if;
 perform set_config('test.closed_report',closed_n::text,true);
 if closed_n->'shift'->>'status'<>'closed' then raise exception 'Shift did not close';end if;
 failed:=false;
 begin perform public.record_treatment_v5('sale',payload,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Closed shift accepted sale';end if;
 -- Closed payroll corrections overlay the audited wage without changing frozen stock.
 changed_n:=public.crm_finance_v5('salary',jsonb_build_object('shift_id',current_setting('test.shift'),'staff_id',current_setting('test.peer'),'amount',2100,'reason','Проверка корректировки после закрытия'));
 if(changed_n->>'payroll_total')::numeric<>4600 or changed_n->'stock'<>closed_n->'stock' or changed_n->'procedures'<>closed_n->'procedures' then raise exception 'Closed salary edit damaged operational snapshot';end if;
 perform set_config('test.closed_report',changed_n::text,true);
 -- Future-dated synthetic shift isolates payroll; synthetic patient isolates receipts.
 summary_n:=public.crm_finance_v5('summary',jsonb_build_object('from',(now() at time zone 'Europe/Moscow')::date,'to',(now() at time zone 'Europe/Moscow')::date,'patient_id',current_setting('test.patient'),'group_by','employee'));
 if(summary_n->'revenue'->>'total')::numeric<>610 or(summary_n->'rows'->0->'revenue'->>'unclassified')::numeric<>20 then raise exception 'Summary receipts wrong: %',summary_n;end if;
 if summary_n->'payroll_total'<>'null'::jsonb or summary_n->'cash_after_salary'<>'null'::jsonb or summary_n->>'payroll_scope'<>'not_applicable_to_entity_filter' then raise exception 'Entity revenue subtracted unrelated period wages';end if;
 summary_n:=public.crm_finance_v5('summary',jsonb_build_object('from',date '2091-05-17','to',date '2091-05-17','group_by','day'));
 if(summary_n->>'payroll_closed')::numeric<>4600 or(summary_n->>'payroll_open')::numeric<>0 or(summary_n->>'days_complete')::boolean then raise exception 'Summary payroll/day completeness wrong: %',summary_n;end if;
 if(summary_n->>'has_open_shifts')::boolean then raise exception 'One closed shift falsely reported open shift';end if;
 summary_n:=public.crm_finance_v5('summary',jsonb_build_object('from',date '2091-05-20','to',date '2091-05-20'));
 if(summary_n->>'has_open_shifts')::boolean or not(summary_n->>'days_complete')::boolean then raise exception 'No activity date reported an unclosed shift';end if;
 failed:=false;
 begin perform public.crm_finance_v5('settings_save','{"time_zone":"UTC"}');exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Timezone inconsistent with stock expiry was accepted';end if;
 settings_n:=public.crm_finance_v5('settings_get');
 perform public.crm_finance_v5('settings_save',jsonb_build_object('float_amount',(settings_n->>'float_amount')::numeric+1000,'time_zone','Europe/Moscow'));
 summary_n:=public.crm_finance_v5('summary',jsonb_build_object('from',(now() at time zone 'Europe/Moscow')::date,'to',(now() at time zone 'Europe/Moscow')::date,'patient_id',current_setting('test.patient')));
 if(summary_n->'revenue'->>'total')::numeric<>610 then raise exception 'Float entered revenue';end if;
 perform public.crm_finance_v5('settings_save',settings_n);
end $$;
reset role;

do $$ declare sh uuid:=current_setting('test.shift')::uuid; med uuid:=current_setting('test.med')::uuid;
begin
 if(select count(*) from private.crm_shift_reports where shift_id=sh)<>1 then raise exception 'Duplicate snapshot';end if;
 if(select count(*) from private.crm_audit_log where entity_type='shift' and entity_id=sh::text and action='shift_closed')<>1 then raise exception 'Duplicate close audit';end if;
 if(select count(*) from private.crm_payment_allocations where procedure_id=current_setting('test.procedure')::uuid or sale_id=current_setting('test.sale')::uuid)<>2 then raise exception 'Duplicate payment allocation';end if;
 if(select count(*) from private.crm_audit_log where entity_type='shift_staff' and entity_id like sh::text||'/%' and action='salary_changed')<>2 then raise exception 'Salary audit missing';end if;
 if(select sum(quantity_remaining) from public.medication_batches where medication_id=med)<>7 then raise exception 'Reserve sale depleted wrong total';end if;
 perform private.assert_stock_v3(med);
 -- Change aggregate stock and its batch consistently; closed report must retain old stock.
 update public.medication_batches set quantity_remaining=quantity_remaining+1,quantity_received=quantity_received+1 where medication_id=med and expiry_date=current_date+200;
 update public.stock set quantity=quantity+1 where medication_id=med and location='reserve';
end $$;
set local role authenticated;
do $$ begin
 if public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.shift')))::text<>current_setting('test.closed_report') then raise exception 'Closed report changed with live stock';end if;
end $$;
reset role;

-- A day permits exactly two separately staffed shifts, serialized by date.
do $$ declare a uuid; b uuid; c uuid; d uuid;
begin
 insert into public.staff(full_name,role) values('Тест слотов A','nurse') returning id into a;
 insert into public.staff(full_name,role) values('Тест слотов B','nurse') returning id into b;
 insert into public.staff(full_name,role) values('Тест слотов C','nurse') returning id into c;
 insert into public.staff(full_name,role) values('Тест слотов D','nurse') returning id into d;
 perform set_config('test.a',a::text,true);perform set_config('test.b',b::text,true);perform set_config('test.c',c::text,true);perform set_config('test.d',d::text,true);
end $$;
set local role authenticated;
do $$ declare s1 uuid;s2 uuid;failed boolean:=false; summary_n jsonb;
begin
 s1:=public.start_shift_v82(date '2091-05-18',now(),now()+interval '8 hours',current_setting('test.a')::uuid,current_setting('test.b')::uuid);
 if public.start_shift_v82(date '2091-05-18',now(),now()+interval '8 hours',current_setting('test.a')::uuid,current_setting('test.b')::uuid)<>s1 then raise exception 'Shift opening retry duplicated slot';end if;
 s2:=public.start_shift_v82(date '2091-05-18',now(),now()+interval '8 hours',current_setting('test.c')::uuid,current_setting('test.d')::uuid);
 perform public.crm_finance_v5('close',jsonb_build_object('shift_id',s1));perform public.crm_finance_v5('close',jsonb_build_object('shift_id',s2));
 begin perform public.start_shift_v82(date '2091-05-18',now(),now()+interval '8 hours',current_setting('test.a')::uuid,current_setting('test.b')::uuid);exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Third daily shift accepted';end if;
 summary_n:=public.crm_finance_v5('summary',jsonb_build_object('from',date '2091-05-18','to',date '2091-05-18'));
 if not(summary_n->>'days_complete')::boolean or(summary_n->>'payroll_total')::numeric<>8000 then raise exception 'Two closed shifts daily result wrong';end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.nurse'),'role','authenticated')::text,true);
do $$ declare report_n jsonb;
begin
 report_n:=public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.shift')));
 if report_n ? 'revenue' or report_n->'stock'->0 ? 'reserve' then raise exception 'Nurse closed snapshot leaks finances/reserve';end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.crm_finance_v5('settings_get');raise exception 'Anonymous financial API allowed';exception when insufficient_privilege then null;end;
 begin perform public.record_treatment_v5('sale','{}',gen_random_uuid());raise exception 'Anonymous payment API allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
