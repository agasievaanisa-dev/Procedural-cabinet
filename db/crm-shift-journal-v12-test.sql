-- Genuine assigned-shift and clinical-detail fixtures. All data/role changes roll back.
begin;
select set_config('test.journal.manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null limit 1),true);
select set_config('test.journal.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.journal.manager'),true);
do $$declare n uuid;peer uuid;own_open uuid;other_shift uuid;own_closed uuid;own_later uuid;
 patient_id_value uuid;service_id_value uuid;injection_id uuid;med_id uuid;procedure_id_value uuid;sale_id_value uuid;closed_procedure uuid;
begin
 if nullif(current_setting('test.journal.manager'),'') is null or nullif(current_setting('test.journal.nurse'),'') is null then
  raise exception 'Tests require active linked manager and nurse';end if;
 select id into n from public.staff where auth_user_id=current_setting('test.journal.nurse')::uuid;
 insert into public.staff(full_name,role) values('Journal v12 co-nurse rollback','nurse') returning id into peer;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-12-01',timestamptz '2096-12-01 08:00:00+03',timestamptz '2096-12-01 16:00:00+03','open') returning id into own_open;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-12-01',timestamptz '2096-12-01 16:00:00+03',timestamptz '2096-12-01 23:00:00+03','open') returning id into other_shift;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-12-02',timestamptz '2096-12-02 08:00:00+03',timestamptz '2096-12-02 16:00:00+03','open') returning id into own_closed;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-12-02',timestamptz '2096-12-02 16:00:00+03',timestamptz '2096-12-02 23:00:00+03','open') returning id into own_later;
 insert into public.shift_staff(shift_id,staff_id) values(own_open,n),(own_open,peer),(other_shift,peer),(own_closed,n),(own_closed,peer),(own_later,n),(own_later,peer);
 insert into public.patients(full_name) values('Journal v12 patient rollback') returning id into patient_id_value;
 insert into public.procedure_services(name,work_price,consumables_price)
  values('Journal v12 капельница rollback',100,10) returning id into service_id_value;
 insert into public.procedure_services(name,work_price,consumables_price)
  values('Journal v12 в/м rollback',50,0) returning id into injection_id;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('Journal v12 препарат rollback','амп.',10,10,20,0,0) returning id into med_id;
 -- Work by the co-nurse must appear in the signed-in nurse's assigned shift.
 insert into public.procedures(patient_id,shift_id,nurse_id,service_id,procedure_type,visit_at,list_total,work_price,consumables_price,charge_total,paid_total,discount_reason,discount_comment,notes,stock_deducted)
  values(patient_id_value,own_open,peer,service_id_value,'Journal v12 капельница rollback',timestamptz '2096-12-01 09:00:00+03',200,150,10,180,100,'Скидка от владельца','Тестовая скидка журнала','Журнал: примечание',false)
  returning id into procedure_id_value;
 insert into private.crm_treatment_services(procedure_id,position,service_id,name,quantity,work_price,consumables_price)
  values(procedure_id_value,0,service_id_value,'Journal v12 капельница rollback',1,100,10),(procedure_id_value,1,injection_id,'Journal v12 в/м rollback',1,50,0);
 insert into public.procedure_medications(procedure_id,medication_id,quantity,unit_price,line_total)
  values(procedure_id_value,med_id,2,20,40);
 insert into private.crm_own_medications(kind,procedure_id,position,name,quantity,unit,source)
  values('procedure',procedure_id_value,0,'Ранее купленный препарат',1,'фл.','previously_purchased');
 insert into public.sales(patient_id,shift_id,nurse_id,sold_at,list_total,charge_total,paid_total,notes,stock_deducted)
  values(patient_id_value,own_open,n,timestamptz '2096-12-01 08:30:00+03',20,20,20,'Продажа в журнале',false) returning id into sale_id_value;
 insert into public.sale_items(sale_id,medication_id,quantity,unit_price,line_total) values(sale_id_value,med_id,1,20,20);
 insert into public.procedures(patient_id,shift_id,nurse_id,service_id,procedure_type,visit_at,list_total,work_price,charge_total,paid_total,stock_deducted)
  values(patient_id_value,own_closed,n,service_id_value,'Journal v12 closed procedure',timestamptz '2096-12-02 09:00:00+03',110,100,110,110,false)
  returning id into closed_procedure;
 insert into private.crm_treatment_services(procedure_id,position,service_id,name,quantity,work_price,consumables_price)
  values(closed_procedure,0,service_id_value,'Journal v12 капельница rollback',1,100,10);
 update public.shifts set status='closed',ended_at=timestamptz '2096-12-02 16:00:00+03' where id=own_closed;
 insert into private.crm_shift_reports(shift_id,report,closed_by)
  values(own_closed,private.crm_build_shift_report_v5(own_closed),current_setting('test.journal.manager')::uuid);
 perform set_config('test.journal.nurse_id',n::text,true);perform set_config('test.journal.peer',peer::text,true);
 perform set_config('test.journal.open',own_open::text,true);perform set_config('test.journal.other',other_shift::text,true);
 perform set_config('test.journal.closed',own_closed::text,true);perform set_config('test.journal.later',own_later::text,true);
 perform set_config('test.journal.procedure',procedure_id_value::text,true);perform set_config('test.journal.sale',sale_id_value::text,true);
 perform set_config('test.journal.closed_snapshot',(select report::text from private.crm_shift_reports where shift_id=own_closed),true);
 perform set_config('test.journal.before_writes',(select coalesce(jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)),'{}'::jsonb)::text from pg_stat_xact_user_tables where schemaname in ('public','private')),true);
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.journal.nurse'),true);
set local role authenticated;
do $$declare answer jsonb;report_row jsonb;entry jsonb;default_answer jsonb;begin
 answer:=public.crm_shift_journal_v12(date '2096-12-01');
 if answer->>'date'<>'2096-12-01' or answer->>'time_zone'<>'Europe/Moscow' or jsonb_array_length(answer->'reports')<>1 then raise exception 'Working-day filter failed';end if;
 report_row:=answer->'reports'->0;
 if report_row->'shift'->>'id'<>current_setting('test.journal.open') or report_row->'shift'->>'status'<>'open' then raise exception 'Wrong assigned shift returned';end if;
 if (report_row->>'procedures_count')::integer<>1 or (report_row->>'sales_count')::integer<>1 or (report_row->>'patients_count')::integer<>1 then raise exception 'Journal counts failed';end if;
 entry:=report_row->'procedures'->0;
 if entry->>'id'<>current_setting('test.journal.procedure') or entry->>'patient'<>'Journal v12 patient rollback'
  or entry->>'nurse_id'<>current_setting('test.journal.peer') or entry->>'notes'<>'Журнал: примечание'
  or (entry->>'at')::timestamptz<>timestamptz '2096-12-01 09:00:00+03' then raise exception 'Patient/time/co-nurse/notes detail lost';end if;
 if jsonb_array_length(entry->'services')<>2 or (entry->'services'->1->>'quantity')::numeric<>1
  or entry->'services'->1->>'name'<>'Journal v12 в/м rollback' or (entry->'services'->0->>'work_price')::numeric<>100 then raise exception 'Full service detail lost';end if;
 if (entry->'items'->0->>'quantity')::numeric<>2 or entry->'items'->0->>'unit'<>'амп.'
  or entry->'items'->0->>'name'<>'Journal v12 препарат rollback' then raise exception 'Medication quantity/unit/name lost';end if;
 if entry->'own_medications'->0->>'source'<>'previously_purchased' or (entry->'own_medications'->0->>'quantity')::numeric<>1 then raise exception 'Own medicine detail lost';end if;
 if (entry->>'charge_total')::numeric<>180 or (entry->>'paid_total')::numeric<>100 or (entry->>'debt_total')::numeric<>80 then raise exception 'Allowed nurse payment data lost';end if;
 if report_row->'sales'->0->>'id'<>current_setting('test.journal.sale') or (report_row->'sales'->0->'items'->0->>'quantity')::numeric<>1 then raise exception 'Sale detail lost';end if;
 if (report_row->'revenue'->>'total')::numeric<>120 then raise exception 'Journal finance summary lost';end if;
 perform set_config('test.journal.open_result',answer::text,true);
 answer:=public.crm_shift_journal_v12(date '2096-12-02');
 if jsonb_array_length(answer->'reports')<>2 or answer->'reports'->0->'shift'->>'id'<>current_setting('test.journal.closed')
  or answer->'reports'->1->'shift'->>'id'<>current_setting('test.journal.later') or answer->'reports'->0->'shift'->>'status'<>'closed'
  or jsonb_array_length(answer->'reports'->0->'procedures')<>1 then raise exception 'Closed/open own shifts missing or unordered';end if;
 if answer is distinct from public.crm_shift_journal_v12(date '2096-12-02') then raise exception 'Read-only journal replay changed';end if;
 for report_row in select value from jsonb_array_elements(answer->'reports') loop
  if report_row ?| array['stock','used','untracked','warnings','payroll_total','payroll_closed','payroll_open','payroll_complete','payroll_unknown','float_amount','cash_after_salary'] then raise exception 'Journal exposed warehouse/payroll';end if;
  if exists(select 1 from jsonb_array_elements(report_row->'staff') s where s ?| array['amount','reason']) then raise exception 'Journal exposed staff salaries';end if;
 end loop;
 default_answer:=public.crm_shift_journal_v12();
 if default_answer->>'date'<>(now() at time zone 'Europe/Moscow')::date::text then raise exception 'Journal default day is not Moscow today';end if;
 if jsonb_array_length(public.crm_shift_journal_v12(date '2096-12-03')->'reports')<>0 then raise exception 'Empty day not empty';end if;
 if has_function_privilege('anon','public.crm_shift_journal_v12(date)','EXECUTE')
  or has_function_privilege('authenticated','private.crm_shift_journal_v12(date)','EXECUTE') then raise exception 'Journal private/anonymous privilege exposed';end if;
end $$;
reset role;
do $$declare after_writes text;begin
 select coalesce(jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)),'{}'::jsonb)::text into after_writes from pg_stat_xact_user_tables where schemaname in ('public','private');
 if after_writes::jsonb is distinct from current_setting('test.journal.before_writes')::jsonb then raise exception 'Journal performed table writes';end if;
 if (select report from private.crm_shift_reports where shift_id=current_setting('test.journal.closed')::uuid) is distinct from current_setting('test.journal.closed_snapshot')::jsonb then raise exception 'Journal changed closed snapshot';end if;
end $$;

-- Owner/admin privileges do not widen a journal to unassigned shifts or add salaries/stock.
update public.staff set role='owner' where auth_user_id=current_setting('test.journal.nurse')::uuid;
set local role authenticated;
do $$declare answer jsonb;report_row jsonb;begin
 answer:=public.crm_shift_journal_v12(date '2096-12-01');report_row:=answer->'reports'->0;
 if jsonb_array_length(answer->'reports')<>1 or report_row->'shift'->>'id'<>current_setting('test.journal.open') then raise exception 'Owner journal widened actor scope';end if;
 if report_row ?| array['stock','used','untracked','warnings','payroll_total','float_amount','cash_after_salary']
  or exists(select 1 from jsonb_array_elements(report_row->'staff') s where s ?| array['amount','reason']) then raise exception 'Owner journal exposed hidden fields';end if;
end $$;
reset role;
update public.staff set role='admin' where auth_user_id=current_setting('test.journal.nurse')::uuid;
set local role authenticated;
do $$declare answer jsonb;begin
 answer:=public.crm_shift_journal_v12(date '2096-12-02');
 if jsonb_array_length(answer->'reports')<>2 or answer->'reports'->0 ? 'stock' or answer->'reports'->0 ? 'payroll_total' then raise exception 'Admin journal scope/redaction failed';end if;
end $$;
reset role;
update public.staff set role='nurse',active=false where auth_user_id=current_setting('test.journal.nurse')::uuid;
set local role authenticated;
do $$begin
 begin perform public.crm_shift_journal_v12(date '2096-12-01');raise exception 'Inactive employee read journal';
 exception when others then if sqlerrm<>'Нет доступа к журналу смен' then raise;end if;end;
end $$;
reset role;
update public.staff set role='mentor',active=true where auth_user_id=current_setting('test.journal.nurse')::uuid;
set local role authenticated;
do $$begin
 begin perform public.crm_shift_journal_v12(date '2096-12-01');raise exception 'Mentor read journal';
 exception when others then if sqlerrm<>'Нет доступа к журналу смен' then raise;end if;end;
end $$;
reset role;
update public.staff set role='nurse' where auth_user_id=current_setting('test.journal.nurse')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.journal.manager'),true);
set local role authenticated;
do $$begin
 if jsonb_array_length(public.crm_shift_journal_v12(date '2096-12-01')->'reports')<>0 then raise exception 'Unassigned owner saw another employee journal';end if;
end $$;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$begin
 begin perform public.crm_shift_journal_v12(date '2096-12-01');raise exception 'Unlinked account read journal';
 exception when others then if sqlerrm<>'Нет доступа к журналу смен' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 begin perform public.crm_shift_journal_v12(date '2096-12-01');raise exception 'Anonymous account read journal';
 exception when others then if sqlerrm<>'Войдите в программу' then raise;end if;end;
end $$;
reset role;
select 'shift journal v12: assigned open/closed day scope, full clinical details, co-nurse work, financial totals, no warehouse/payroll or writes, active role authorization passed' as result;
rollback;
