-- Assigned nurses see authorized wages, totals and incomplete-payroll warnings.
-- No real patients or employees are changed; every fixture rolls back.
-- Run after crm-save-recovery-v16 and crm-shift-summary-v17.
begin;
do $$declare owner_user uuid:=gen_random_uuid();nurse_user uuid:=gen_random_uuid();owner_staff uuid;nurse_staff uuid;
 peer_staff uuid;foreign_staff uuid;foreign_peer uuid;cache_peer uuid;own_shift uuid;foreign_shift uuid;cache_shift uuid;
 patient uuid;service uuid;sanitized jsonb;
begin
 insert into auth.users(id,email) values(owner_user,owner_user::text||'@v17.example.invalid'),(nurse_user,nurse_user::text||'@v17.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST summary owner v17','owner',true,owner_user) returning id into owner_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST summary nurse v17','nurse',true,nurse_user) returning id into nurse_staff;
 insert into public.staff(full_name,role,active) values('TEST summary peer v17','nurse',true) returning id into peer_staff;
 insert into public.staff(full_name,role,active) values('TEST summary foreign nurse v17','nurse',true) returning id into foreign_staff;
 insert into public.staff(full_name,role,active) values('TEST summary foreign peer v17','nurse',true) returning id into foreign_peer;
 insert into public.staff(full_name,role,active) values('TEST summary cache peer v17','nurse',true) returning id into cache_peer;
 perform set_config('test.v17.owner',owner_user::text,true);perform set_config('test.v17.nurse',nurse_user::text,true);
 perform set_config('test.v17.owner_staff',owner_staff::text,true);perform set_config('test.v17.nurse_staff',nurse_staff::text,true);
 perform set_config('test.v17.peer_staff',peer_staff::text,true);
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_user,'role','authenticated')::text,true);
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2097-06-01',timestamptz '2097-06-01 08:30+03',timestamptz '2097-06-01 16:00+03','open') returning id into own_shift;
 insert into public.shift_staff(shift_id,staff_id) values(own_shift,nurse_staff),(own_shift,peer_staff);
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2097-06-02',timestamptz '2097-06-02 08:30+03',timestamptz '2097-06-02 16:00+03','open') returning id into foreign_shift;
 insert into public.shift_staff(shift_id,staff_id) values(foreign_shift,foreign_staff),(foreign_shift,foreign_peer);
 -- Establish the cache fixture through the normal two-active-nurse assignment guard.
 update public.staff set role='nurse' where id=owner_staff;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2097-06-03',timestamptz '2097-06-03 08:30+03',timestamptz '2097-06-03 16:00+03','open') returning id into cache_shift;
 insert into public.shift_staff(shift_id,staff_id) values(cache_shift,owner_staff),(cache_shift,cache_peer);
 update public.staff set role='owner' where id=owner_staff;
 insert into public.patients(full_name) values('TEST summary patient v17') returning id into patient;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('TEST summary procedure v17',500,100,true) returning id into service;
 update private.crm_finance_settings set payment_only=true where id;
 perform set_config('test.v17.shift',own_shift::text,true);perform set_config('test.v17.foreign_shift',foreign_shift::text,true);
 perform set_config('test.v17.cache_shift',cache_shift::text,true);perform set_config('test.v17.patient',patient::text,true);perform set_config('test.v17.service',service::text,true);
 -- Explicitly exercise future owner-only cost fields and exact staff projection.
 sanitized:=private.crm_nurse_shift_report_v10(jsonb_build_object('payroll_total',2500,'payroll_unknown',0,'payroll_complete',true,'cash_after_salary',3500,
  'stock','TEST stock secret','used','TEST stock usage secret','untracked','TEST untracked secret','warnings','TEST stock warning','float_amount',50000,
  'purchases',123,'purchase_price',124,'cost',125,'cost_total',126,'profit',127,'profit_total',128,'payroll_open',129,'payroll_closed',130,
  'total_purchase_cost',131,'total_profit',132,
  'staff',jsonb_build_array(jsonb_build_object('id',nurse_staff,'full_name','TEST nurse name','amount',2500,'reason','TEST salary reason secret','email','TEST staff contact secret'))));
 if sanitized ? 'stock' or sanitized ? 'used' or sanitized ? 'untracked' or sanitized ? 'warnings' or sanitized ? 'float_amount'
  or sanitized ? 'purchases' or sanitized ? 'purchase_price' or sanitized ? 'cost' or sanitized ? 'cost_total' or sanitized ? 'profit'
  or sanitized ? 'profit_total' or sanitized ? 'total_purchase_cost' or sanitized ? 'total_profit'
  or sanitized ? 'payroll_open' or sanitized ? 'payroll_closed' then raise exception 'Nurse sanitizer retained owner-only fields';end if;
 if sanitized->'staff'->0 is distinct from jsonb_build_object('id',nurse_staff,'full_name','TEST nurse name','amount',2500)
  or (sanitized->>'payroll_total')::numeric<>2500 or (sanitized->>'cash_after_salary')::numeric<>3500 then raise exception 'Nurse sanitizer lost authorized salary fields';end if;
end $$;

set local role authenticated;
do $$declare result_n jsonb;args jsonb;req uuid:=gen_random_uuid();begin
 perform public.crm_finance_v5('salary',jsonb_build_object('shift_id',current_setting('test.v17.shift'),'staff_id',current_setting('test.v17.nurse_staff'),
  'amount',2500,'reason','TEST owner-only wage reason v17'));
 args:=jsonb_build_object('p_action','close','p_payload',jsonb_build_object('shift_id',current_setting('test.v17.cache_shift')));
 result_n:=public.crm_save_recovery_v16('crm_finance_v5',args,req);
 if not(result_n->'result' ? 'stock') or (result_n->'result'->>'payroll_total')::numeric<>4000 then raise exception 'Cached owner report fixture incomplete';end if;
 perform set_config('test.v17.cache_request',req::text,true);perform set_config('test.v17.cache_args',args::text,true);
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v17.nurse'),true);
set local role authenticated;
do $$declare report_n jsonb;journal_n jsonb;payload jsonb;begin
 payload:=jsonb_build_object('patient_id',current_setting('test.v17.patient'),'shift_id',current_setting('test.v17.shift'),
  'nurse_id',current_setting('test.v17.nurse_staff'),'service_id',current_setting('test.v17.service'),'items','[]'::jsonb,
  'charge_total',600,'paid_total',600,'payment_status','paid','expected_stock_deducted',false,'payments',jsonb_build_object('cash',600,'cash_received',600));
 perform public.record_treatment_v5('procedure',payload,gen_random_uuid());
 report_n:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v17.shift')));
 if (report_n->>'payroll_total')::numeric<>4500 or (report_n->>'payroll_unknown')::integer<>0
  or (report_n->>'payroll_complete')::boolean is distinct from true or (report_n->>'cash_after_salary')::numeric<>-3900 then
  raise exception 'Assigned nurse shift salary/remainder incorrect';end if;
 if not exists(select 1 from jsonb_array_elements(report_n->'staff') member where member->>'id'=current_setting('test.v17.nurse_staff') and (member->>'amount')::numeric=2500)
  or not exists(select 1 from jsonb_array_elements(report_n->'staff') member where member->>'id'=current_setting('test.v17.peer_staff') and (member->>'amount')::numeric=2000) then
  raise exception 'Assigned nurse shift omitted employee wages';end if;
 if report_n ? 'stock' or report_n ? 'used' or report_n ? 'untracked' or report_n ? 'warnings' or report_n ? 'float_amount'
  or report_n ? 'cost' or report_n ? 'profit' or exists(select 1 from jsonb_array_elements(report_n->'staff') member where member ? 'reason') then
  raise exception 'Assigned nurse report leaked stock, cost or salary reasons';end if;
 begin
  perform public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v17.foreign_shift')));
  raise exception 'Foreign-shift salary report unexpectedly authorized';
 exception when others then if sqlerrm='Foreign-shift salary report unexpectedly authorized' then raise;end if;end;
 begin
  perform public.crm_finance_v5('salary',jsonb_build_object('shift_id',current_setting('test.v17.shift'),'staff_id',current_setting('test.v17.nurse_staff'),'amount',9999,'reason','TEST forbidden salary v17'));
  raise exception 'Nurse unexpectedly changed salary';
 exception when others then if sqlerrm='Nurse unexpectedly changed salary' then raise;end if;end;
 begin
  perform public.crm_finance_v5('summary','{}');raise exception 'Nurse unexpectedly accessed owner period report';
 exception when others then if sqlerrm='Nurse unexpectedly accessed owner period report' then raise;end if;end;
 journal_n:=public.crm_shift_journal_v12(date '2097-06-01');
 if journal_n->'reports'->0 ? 'payroll_total' or journal_n->'reports'->0 ? 'cash_after_salary'
  or exists(select 1 from jsonb_array_elements(journal_n->'reports'->0->'staff') member where member ? 'amount' or member ? 'reason') then
  raise exception 'Salary report change broadened journal whitelist';end if;
end $$;
reset role;

-- A historical wage can be unknown. Preserve null amount and the warning.
delete from private.crm_shift_payroll where shift_id=current_setting('test.v17.shift')::uuid and staff_id=current_setting('test.v17.peer_staff')::uuid;
set local role authenticated;
do $$declare report_n jsonb;begin
 report_n:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v17.shift')));
 if (report_n->>'payroll_total')::numeric<>2500 or (report_n->>'payroll_unknown')::integer<>1
  or (report_n->>'payroll_complete')::boolean is distinct from false or report_n->'cash_after_salary' is distinct from 'null'::jsonb then
  raise exception 'Unknown historical wage reported a complete remainder';end if;
 if not exists(select 1 from jsonb_array_elements(report_n->'staff') member where member->>'id'=current_setting('test.v17.peer_staff') and member->'amount'='null'::jsonb) then
  raise exception 'Unknown employee wage lost null amount';end if;
 report_n:=public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v17.shift')));
 if (report_n->>'payroll_unknown')::integer<>1 or (report_n->>'payroll_complete')::boolean is distinct from false then raise exception 'Close hid incomplete wage status';end if;
end $$;
reset role;

-- Returning a previously cached owner reply follows the caller's current role.
select set_config('request.jwt.claim.sub',current_setting('test.v17.owner'),true);
update public.staff set role='nurse' where id=current_setting('test.v17.owner_staff')::uuid;
set local role authenticated;
do $$declare envelope jsonb;report_n jsonb;begin
 envelope:=public.crm_save_recovery_v16('crm_finance_v5',current_setting('test.v17.cache_args')::jsonb,current_setting('test.v17.cache_request')::uuid);
 report_n:=envelope->'result';
 if report_n ? 'stock' or report_n ? 'used' or report_n ? 'warnings' or report_n ? 'float_amount'
  or exists(select 1 from jsonb_array_elements(report_n->'staff') member where member ? 'reason') then raise exception 'Demoted assigned nurse cached report leaked restricted details';end if;
 if (report_n->>'payroll_total')::numeric<>4000 or (report_n->>'cash_after_salary')::numeric<>-4000
  or (report_n->>'payroll_complete')::boolean is distinct from true
  or exists(select 1 from jsonb_array_elements(report_n->'staff') member where (member->>'amount')::numeric is distinct from 2000::numeric) then
  raise exception 'Demoted assigned nurse cached report hid authorized salary';end if;
end $$;
reset role;
do $$begin
 if(select count(*) from private.crm_audit_log where action='salary_changed' and entity_id=current_setting('test.v17.shift')||'/'||current_setting('test.v17.nurse_staff'))<>1 then raise exception 'Salary report reads changed payroll or audit';end if;
 if(select amount from private.crm_shift_payroll where shift_id=current_setting('test.v17.shift')::uuid and staff_id=current_setting('test.v17.nurse_staff')::uuid)<>2500 then raise exception 'Nurse changed payroll';end if;
 if(select count(*) from private.crm_audit_log where action='shift_closed' and entity_id=current_setting('test.v17.cache_shift'))<>1 then raise exception 'Cached role replay repeated close audit';end if;
end $$;
select 'crm-shift-summary-v17 assigned payroll visibility, incomplete wages and cache permissions passed' as result;
rollback;
