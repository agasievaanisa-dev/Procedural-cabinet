-- Synthetic rows only. Exercises actual receipt dates, collectors and debt without changing real records.
begin;
do $$
declare owner_user uuid; owner_staff uuid; nurse_staff uuid;
 patient_id uuid:=gen_random_uuid(); medication_id uuid:=gen_random_uuid();
 service_one uuid:=gen_random_uuid(); service_two uuid:=gen_random_uuid();
 first_shift uuid:=gen_random_uuid(); second_shift uuid:=gen_random_uuid();
 procedure_id uuid:=gen_random_uuid(); sale_id uuid:=gen_random_uuid(); free_id uuid:=gen_random_uuid();
 request_id uuid:=gen_random_uuid(); initial_request uuid:=gen_random_uuid(); result jsonb; row_n jsonb;
begin
 select auth_user_id,id into owner_user,owner_staff from public.staff
  where active and role in ('owner','admin') and auth_user_id is not null order by id limit 1;
 select id into nurse_staff from public.staff where active and role='nurse' order by id limit 1;
 if owner_user is null or nurse_staff is null then raise exception 'Test needs an active owner and nurse';end if;
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 insert into public.patients(id,full_name) values(patient_id,'TEST synthetic finance v10');
 insert into public.medications(id,name,consumption_unit,units_per_package,sale_price)
  values(medication_id,'TEST synthetic medicine v10','ampoule',10,30);
 insert into public.procedure_services(id,name,work_price,consumables_price)
  values(service_one,'TEST first service v10',100,0),(service_two,'TEST extra service v10',50,0);
 insert into public.shifts(id,shift_date,started_at,ended_at,status,daily_slot)
  values(first_shift,'2050-01-10','2050-01-10 05:30+00','2050-01-10 13:00+00','open',1),
   (second_shift,'2050-01-12','2050-01-12 05:30+00','2050-01-12 13:00+00','open',1);
 insert into public.shift_staff(shift_id,staff_id) values(first_shift,nurse_staff),(second_shift,nurse_staff);
 update public.shifts set status='closed' where id in (first_shift,second_shift);
 insert into public.procedures(id,patient_id,shift_id,nurse_id,service_id,procedure_type,visit_at,
  work_price,list_total,charge_total,paid_total,discount_amount,discount_reason,discount_comment,stock_deducted)
  values(procedure_id,patient_id,first_shift,nurse_staff,service_one,'TEST first service v10','2050-01-10 06:00+00',
   150,180,150,40,30,'Постоянный пациент','TEST agreed discount',false),
   (free_id,patient_id,first_shift,nurse_staff,service_one,'TEST free service v10','2050-01-10 07:00+00',
   100,100,0,0,100,'Бесплатно','TEST owner decision',false);
 insert into private.crm_treatment_services(procedure_id,position,service_id,name,quantity,work_price,consumables_price)
  values(procedure_id,0,service_one,'TEST first service v10',1,100,0),
   (procedure_id,1,service_two,'TEST extra service v10',1,50,0),
   (free_id,0,service_one,'TEST first service v10',1,100,0);
 insert into public.procedure_medications(procedure_id,medication_id,quantity,unit_price,line_total)
  values(procedure_id,medication_id,1,30,30);
 insert into public.sales(id,patient_id,shift_id,nurse_id,sold_at,list_total,charge_total,paid_total,stock_deducted)
  values(sale_id,patient_id,first_shift,nurse_staff,'2050-01-10 08:00+00',90,90,0,false);
 insert into public.sale_items(sale_id,medication_id,quantity,unit_price,line_total)
  values(sale_id,medication_id,3,30,90);
 insert into private.warehouse_requests(id,staff_user,action,payload)
  values(initial_request,owner_user,'TEST initial finance v10','{}');
 insert into private.crm_payment_allocations(id,kind,procedure_id,cash,terminal,owner_card,cash_received,change_amount,created_by)
  values(initial_request,'procedure',procedure_id,20,20,0,20,0,owner_user);
 insert into private.warehouse_requests(id,staff_user,action,payload)
  values(request_id,owner_user,'TEST receipt finance v10','{}');
 insert into private.crm_receipts_v10(id,kind,procedure_id,shift_id,nurse_id,cash,terminal,owner_card,
  cash_received,change_amount,created_by,created_at,comment)
  values(request_id,'procedure',procedure_id,second_shift,owner_staff,0,60,0,0,0,owner_user,'2050-01-12 06:00+00','TEST debt settlement');

 result:=private.crm_finance_summary_v5(jsonb_build_object('from','2050-01-10','to','2050-01-10','patient_id',patient_id));
 if (result->'revenue'->>'total')::numeric<>40 or (result->>'charge_total')::numeric<>240
  or (result->>'debt_created_total')::numeric<>200 or (result->>'debt_total')::numeric<>140
  or (result->>'procedures_count')::integer<>2 or (result->>'sales_count')::integer<>1 then
  raise exception 'Original period mixes debt with cash or loses free records: %',result;
 end if;
 result:=private.crm_finance_summary_v5(jsonb_build_object('from','2050-01-12','to','2050-01-12','patient_id',patient_id));
 if (result->'revenue'->>'total')::numeric<>60 or (result->'revenue'->>'terminal')::numeric<>60
  or (result->>'charge_total')::numeric<>0 or (result->>'debt_payments_total')::numeric<>60
  or (result->>'procedures_count')::integer<>0 or (result->>'sales_count')::integer<>0 then
  raise exception 'Settlement must belong to actual receipt period without another bill: %',result;
 end if;
 result:=private.crm_finance_summary_v5(jsonb_build_object('from','2050-01-10','to','2050-01-12','patient_id',patient_id,'group_by','employee'));
 select value into row_n from jsonb_array_elements(result->'rows') where value->>'id'=owner_staff::text;
 if row_n is null or (row_n->'revenue'->>'total')::numeric is distinct from 60::numeric
  or (row_n->>'procedures_count')::integer is distinct from 0 then
  raise exception 'Receipt belongs to collecting employee: %',result;
 end if;
 result:=private.crm_finance_summary_v5(jsonb_build_object('from','2050-01-10','to','2050-01-12','patient_id',patient_id,'group_by','medication'));
 if (result->'rows'->0->>'quantity')::numeric is distinct from 4::numeric then raise exception 'Receipt duplicates medicine quantity: %',result;end if;
 result:=private.crm_finance_summary_v5(jsonb_build_object('from','2050-01-10','to','2050-01-12','patient_id',patient_id,'group_by','service','service_id',service_two));
 if (result->>'procedures_count')::integer<>1 or (result->'revenue'->>'total')::numeric<>100
  or (result->'rows'->0->>'quantity')::numeric<>1 then raise exception 'Extra service absent or recounted during repayment: %',result;end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform private.crm_finance_summary_v5('{}');
  raise exception 'Anonymous finance access unexpectedly allowed';
 exception when others then
  if sqlerrm='Anonymous finance access unexpectedly allowed' then raise;end if;
 end;
end $$;
rollback;
