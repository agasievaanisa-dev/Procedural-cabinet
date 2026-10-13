-- Synthetic identities and records only; every fixture and write rolls back.
begin;
do $$
declare owner_user uuid:=gen_random_uuid();admin_user uuid:=gen_random_uuid();nurse_user uuid:=gen_random_uuid();
 owner_staff uuid;admin_staff uuid;nurse_staff uuid;patient_ids uuid[]:='{}';patient_id uuid;procedure_id uuid;
 first_procedure uuid;second_procedure uuid;old_debt uuid;previous_shift uuid;today_shift uuid;next_shift uuid;
 sale_id uuid;request_id uuid;paid numeric;result jsonb;calendar jsonb;working jsonb;i integer;
 baseline_audit bigint;baseline_requests bigint;baseline_reports bigint;
begin
 insert into auth.users(id,email) values(owner_user,owner_user::text||'@v25.example.invalid'),
  (admin_user,admin_user::text||'@v25.example.invalid'),(nurse_user,nurse_user::text||'@v25.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST dashboard owner v25','owner',true,owner_user) returning id into owner_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST dashboard administrator v25','admin',true,admin_user) returning id into admin_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST dashboard nurse v25','nurse',true,nurse_user) returning id into nurse_staff;
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 for i in 1..19 loop
  insert into public.patients(full_name) values('TEST dashboard patient v25 '||i) returning id into patient_id;
  patient_ids:=array_append(patient_ids,patient_id);
 end loop;
 insert into public.shifts(shift_date,started_at,status) values('2087-11-01','2087-11-01 08:30+03','open') returning id into previous_shift;
 insert into public.shifts(shift_date,started_at,status) values('2087-11-02','2087-11-02 08:30+03','open') returning id into today_shift;
 insert into public.shifts(shift_date,started_at,status) values('2087-11-03','2087-11-03 08:30+03','open') returning id into next_shift;
 insert into public.shift_staff(shift_id,staff_id) values(previous_shift,nurse_staff),(today_shift,nurse_staff),(next_shift,nurse_staff);
 update private.crm_shift_payroll set amount=4000 where shift_id=today_shift;

 for i in 1..18 loop
  paid:=case i when 1 then 0 when 2 then 50 else case when i>14 then 50 else 100 end end;
  insert into public.procedures(patient_id,shift_id,nurse_id,procedure_type,visit_at,arrival_at,
   list_total,charge_total,paid_total,stock_deducted)
  values(patient_ids[case when i>14 then i-14 else i end],today_shift,nurse_staff,'TEST dashboard procedure v25',
   '2087-11-02 12:00+03','2087-11-01 10:25+03',case when i>14 then 50 else 100 end,
   case when i>14 then 50 else 100 end,paid,false) returning id into procedure_id;
  if i=1 then first_procedure:=procedure_id;elsif i=2 then second_procedure:=procedure_id;end if;
  request_id:=gen_random_uuid();
  insert into private.warehouse_requests(id,staff_user,action,payload) values(request_id,owner_user,'TEST dashboard allocation v25','{}');
  insert into private.crm_payment_allocations(id,kind,procedure_id,cash,terminal,owner_card,cash_received,change_amount,created_by,created_at)
   values(request_id,'procedure',procedure_id,paid,0,0,paid,0,owner_user,'2087-11-02 12:00+03');
 end loop;
 -- Four records saved after midnight belong to yesterday's shift.
 for i in 15..18 loop
  insert into public.procedures(patient_id,shift_id,nurse_id,procedure_type,visit_at,list_total,charge_total,paid_total,stock_deducted)
   values(patient_ids[i],previous_shift,nurse_staff,'TEST previous-shift late save v25','2087-11-02 00:10+03',200,200,200,false) returning id into procedure_id;
  request_id:=gen_random_uuid();
  insert into private.warehouse_requests(id,staff_user,action,payload) values(request_id,owner_user,'TEST dashboard allocation v25','{}');
  insert into private.crm_payment_allocations(id,kind,procedure_id,cash,terminal,owner_card,cash_received,change_amount,created_by,created_at)
   values(request_id,'procedure',procedure_id,0,200,0,0,0,owner_user,'2087-11-02 00:10+03');
 end loop;
 insert into public.procedures(patient_id,shift_id,nurse_id,procedure_type,visit_at,list_total,charge_total,paid_total,stock_deducted)
  values(patient_ids[19],previous_shift,nurse_staff,'TEST old bill repaid today v25','2087-11-01 15:00+03',300,300,0,false) returning id into old_debt;
 insert into public.sales(patient_id,shift_id,nurse_id,sold_at,list_total,charge_total,paid_total,stock_deducted)
  values(null,today_shift,nurse_staff,'2087-11-02 15:00+03',25,25,25,false) returning id into sale_id;
 -- The historical sale has no payment-method allocation; it stays unclassified.
 for i in 1..5 loop
  request_id:=gen_random_uuid();
  insert into private.warehouse_requests(id,staff_user,action,payload) values(request_id,owner_user,'TEST dashboard receipt v25','{}');
  insert into private.crm_receipts_v10(id,kind,procedure_id,shift_id,nurse_id,cash,terminal,owner_card,
   cash_received,change_amount,created_by,created_at,voided_at,voided_by,void_reason,void_request_id)
  values(request_id,'procedure',case i when 1 then first_procedure when 2 then second_procedure when 4 then first_procedure else old_debt end,
   case when i=4 then next_shift else today_shift end,nurse_staff,
   case i when 1 then 70 when 2 then 50 when 4 then 30 when 5 then 999 else 200 end,0,0,
   case i when 1 then 70 when 2 then 50 when 4 then 30 when 5 then 999 else 200 end,0,owner_user,
   case when i=4 then timestamptz '2087-11-03 09:00+03' else timestamptz '2087-11-02 13:00+03' end,
   case when i=5 then timestamptz '2087-11-02 14:00+03' end,case when i=5 then owner_staff end,
   case when i=5 then 'TEST incorrect receipt voided' end,case when i=5 then request_id end);
 end loop;
 -- A corrected phantom initial payment must not contribute revenue.
 request_id:=gen_random_uuid();
 insert into private.warehouse_requests(id,staff_user,action,payload) values(request_id,owner_user,'TEST dashboard voided allocation v25','{}');
 insert into private.crm_payment_allocations(id,kind,procedure_id,cash,terminal,owner_card,cash_received,change_amount,created_by,created_at,voided_at,voided_by,void_reason,void_request_id)
  values(request_id,'procedure',old_debt,999,0,0,999,0,owner_user,'2087-11-02 13:00+03','2087-11-02 14:00+03',owner_staff,'TEST incorrect initial payment voided',request_id);
 select count(*) into baseline_audit from private.crm_audit_log;
 select count(*) into baseline_requests from private.warehouse_requests;
 select count(*) into baseline_reports from private.crm_shift_reports;
 result:=public.crm_dashboard_day_v25('2087-11-02');working:=result->'working_day';calendar:=result->'receipts_day';
 if(result->>'time_zone')<>'Europe/Moscow' or(working->>'basis')<>'shift_date'
  or(working->>'patients_count')::integer<>14 or(working->>'procedures_count')::integer<>18
  or(working->>'sales_count')::integer<>1 or(working->>'charge_total')::numeric<>1625
  or(working->>'debt_total')::numeric<>0 or(working->>'debt_created_total')::numeric<>150 then
  raise exception 'Working-day patients, repeat procedures, unknown sale or debt incorrect: %',result;
 end if;
 if(working->'revenue'->>'total')::numeric<>1795 or(working->'revenue'->>'cash')::numeric<>1770
  or(working->'revenue'->>'unclassified')::numeric<>25 or(working->>'debt_payments_total')::numeric<>320
  or(working->>'debt_payments_count')::integer<>3 or(working->>'payroll_total')::numeric<>4000
  or(working->>'cash_after_salary')::numeric<>-2205 then
  raise exception 'Shift revenue, payroll, voided payments or receipts recounted: %',result;
 end if;
 if(calendar->'revenue'->>'total')::numeric<>2595 or(calendar->'revenue'->>'terminal')::numeric<>800
  or(calendar->'breakdown'->'previous_day_shifts'->>'total')::numeric<>800
  or(calendar->'breakdown'->'current_day_shifts'->>'total')::numeric<>1795
  or(calendar->>'debt_payments_total')::numeric<>320 then
  raise exception 'Calendar receipts lose late shift payments or duplicate old debt settlement: %',result;
 end if;
 if(calendar->'revenue') is distinct from(private.crm_finance_summary_v5(jsonb_build_object('from','2087-11-02','to','2087-11-02'))->'revenue') then
  raise exception 'Existing finance period basis changed';
 end if;
 result:=public.crm_dashboard_day_v25('2087-11-03');
 if(result->'working_day'->>'patients_count')::integer<>0 or(result->'working_day'->>'procedures_count')::integer<>0
  or(result->'receipts_day'->'revenue'->>'total')::numeric<>30 then raise exception 'Receipt alone adds a patient/visit: %',result;end if;
 delete from private.crm_shift_payroll where shift_id=today_shift;
 result:=public.crm_dashboard_day_v25('2087-11-02');
 if(result->'working_day'->>'payroll_complete')::boolean or(result->'working_day'->'cash_after_salary')<>'null'::jsonb then
  raise exception 'Unknown payroll produces a misleading balance: %',result;
 end if;
 if(select count(*)from private.crm_audit_log)<>baseline_audit or(select count(*)from private.warehouse_requests)<>baseline_requests
  or(select count(*)from private.crm_shift_reports)<>baseline_reports then raise exception 'Dashboard read mutated report/history/request tables';end if;
 perform set_config('request.jwt.claim.sub',admin_user::text,true);
 if(public.crm_dashboard_day_v25('2087-11-02')->'working_day'->>'patients_count')::integer<>14 then raise exception 'Administrator dashboard access failed';end if;
 update public.staff set active=false where id=admin_staff;
 begin
  perform public.crm_dashboard_day_v25('2087-11-02');raise exception 'Inactive administrator dashboard access unexpectedly allowed';
 exception when others then if sqlerrm='Inactive administrator dashboard access unexpectedly allowed' then raise;end if;end;
 perform set_config('test.v25.owner',owner_user::text,true);perform set_config('test.v25.nurse',nurse_user::text,true);
end $$;

set local role authenticated;
do $$begin
 perform set_config('request.jwt.claim.sub',current_setting('test.v25.owner'),true);
 perform public.crm_dashboard_day_v25('2087-11-02');
 begin
  perform private.crm_dashboard_day_v25('2087-11-02');raise exception 'Direct private API access unexpectedly allowed';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',current_setting('test.v25.nurse'),true);
 begin
  perform public.crm_dashboard_day_v25('2087-11-02');raise exception 'Nurse dashboard access unexpectedly allowed';
 exception when others then if sqlerrm='Nurse dashboard access unexpectedly allowed' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.crm_dashboard_day_v25('2087-11-02');raise exception 'Unauthenticated dashboard access unexpectedly allowed';
 exception when others then if sqlerrm='Unauthenticated dashboard access unexpectedly allowed' then raise;end if;end;
end $$;
reset role;
rollback;
