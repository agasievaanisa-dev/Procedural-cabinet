-- Save replay, original validation and access checks against real RPCs.
-- Every auth user, staff member, patient, medicine, course and request is synthetic.
-- All writes are in this transaction and are rolled back.
begin;
do $$declare manager_user uuid:=gen_random_uuid();other_user uuid:=gen_random_uuid();nurse_user uuid:=gen_random_uuid();
 manager_staff uuid;other_staff uuid;nurse_staff uuid;peer_staff uuid;patient uuid;service uuid;
begin
 insert into auth.users(id,email) values(manager_user,manager_user::text||'@v16.example.invalid'),
  (other_user,other_user::text||'@v16.example.invalid'),(nurse_user,nurse_user::text||'@v16.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST save recovery manager v16','admin',true,manager_user) returning id into manager_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST save recovery other manager v16','owner',true,other_user) returning id into other_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST save recovery nurse v16','nurse',true,nurse_user) returning id into nurse_staff;
 insert into public.staff(full_name,role,active) values('TEST save recovery peer nurse v16','nurse',true) returning id into peer_staff;
 perform set_config('test.v16.manager',manager_user::text,true);perform set_config('test.v16.other',other_user::text,true);
 perform set_config('test.v16.nurse',nurse_user::text,true);perform set_config('test.v16.manager_staff',manager_staff::text,true);
 perform set_config('test.v16.nurse_staff',nurse_staff::text,true);perform set_config('test.v16.peer_staff',peer_staff::text,true);
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_user,'role','authenticated')::text,true);
 insert into public.patients(full_name) values('TEST save recovery patient v16') returning id into patient;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST save recovery service v16',500,100,true) returning id into service;
 perform set_config('test.v16.patient',patient::text,true);perform set_config('test.v16.service',service::text,true);
end $$;

set local role authenticated;
do $$declare args jsonb;answer jsonb;req uuid:=gen_random_uuid();invalid_req uuid:=gen_random_uuid();med uuid;
begin
 -- Medication cards stay on the validated warehouse API, not its revoked prototype.
 args:=jsonb_build_object('id',null,'name','TEST save recovery medicine v16','country','TEST',
  'unit','амп.','units_per_package',10,'purchase_price',100,
  'sale_price',200,'min_total_stock',0,'work_threshold',0,'lead_time_days',3);
 answer:=public.warehouse_v5('save',args,req);med:=(answer->>'id')::uuid;
 if med is null or public.warehouse_v5('save',args,req) is distinct from answer then
  raise exception 'Validated medicine create/replay result mismatch';end if;
 perform set_config('test.v16.med',med::text,true);perform set_config('test.v16.med_request',req::text,true);
 perform set_config('test.v16.med_args',args::text,true);perform set_config('test.v16.med_result',answer::text,true);
 begin
  perform public.crm_save_recovery_v16('manager_set_medication_test','{}',gen_random_uuid());
  raise exception 'Intentionally revoked medication prototype unexpectedly reachable';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.warehouse_v5('save',args||jsonb_build_object('name',' '),invalid_req);
  raise exception 'Validated medicine name validation unexpectedly bypassed';
 exception when others then if sqlerrm='Validated medicine name validation unexpectedly bypassed' then raise;end if;end;
 perform set_config('test.v16.invalid_request',invalid_req::text,true);
 begin
  perform public.warehouse_v5('save',args||jsonb_build_object('sale_price',-1),gen_random_uuid());
  raise exception 'Negative medicine price unexpectedly accepted';
 exception when others then if sqlerrm='Negative medicine price unexpectedly accepted' then raise;end if;end;
 begin
  perform public.warehouse_v5('save',args||jsonb_build_object('units_per_package',1.5),gen_random_uuid());
  raise exception 'Fractional medicine package unexpectedly accepted';
 exception when others then if sqlerrm='Fractional medicine package unexpectedly accepted' then raise;end if;end;
 -- UUID and void results retain the original shape inside the envelope.
 args:=jsonb_build_object('p_id',med,'p_search_name','TEST save search','p_dosage','TEST 2 ml','p_photo_path',null);
 req:=gen_random_uuid();answer:=public.crm_save_recovery_v16('manager_medication_details_photo_v1',args,req);
 if answer is distinct from '{"result":null}'::jsonb
  or public.crm_save_recovery_v16('manager_medication_details_photo_v1',args,req) is distinct from answer then
  raise exception 'Void medication metadata result/replay mismatch';end if;
 -- Editing later must not be undone when an older lost response is replayed.
 args:=current_setting('test.v16.med_args')::jsonb||jsonb_build_object('id',med,'sale_price',300);
 perform public.warehouse_v5('save',args,gen_random_uuid());
 if public.warehouse_v5('save',current_setting('test.v16.med_args')::jsonb,
  current_setting('test.v16.med_request')::uuid) is distinct from current_setting('test.v16.med_result')::jsonb then
  raise exception 'Old create response changed after later edit';end if;

 args:=jsonb_build_object('p_action','staff_save','p_payload',jsonb_build_object('full_name','TEST replay-created staff v16','role','nurse','active',true));
 req:=gen_random_uuid();answer:=public.crm_save_recovery_v16('crm_management_v5',args,req);
 if public.crm_save_recovery_v16('crm_management_v5',args,req) is distinct from answer then raise exception 'Staff replay mismatch';end if;
 perform set_config('test.v16.created_staff',answer->'result'->>'id',true);
 perform set_config('test.v16.staff_request',req::text,true);perform set_config('test.v16.staff_args',args::text,true);
 begin
  perform public.crm_save_recovery_v16('crm_management_v5',args||jsonb_build_object('p_payload',jsonb_build_object('full_name','Changed save args v16')),req);
  raise exception 'Changed save args unexpectedly replayed';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.crm_save_recovery_v16('crm_management_v5',args||jsonb_build_object('unexpected',true),gen_random_uuid());
  raise exception 'Unknown save args unexpectedly accepted';
 exception when invalid_parameter_value then null;end;
 invalid_req:=gen_random_uuid();perform set_config('test.v16.failed_ledger_request',invalid_req::text,true);
 begin
  perform public.crm_save_recovery_v16('crm_management_v5',jsonb_build_object('p_action','staff_save','p_payload',jsonb_build_object('full_name',' ')),invalid_req);
  raise exception 'Original staff validation unexpectedly bypassed';
 exception when others then if sqlerrm='Original staff validation unexpectedly bypassed' then raise;end if;end;

 args:=jsonb_build_object('p_action','template_save','p_payload',jsonb_build_object('name','TEST save recovery template v16',
  'service_id',current_setting('test.v16.service'),'items',jsonb_build_array(jsonb_build_object('medication_id',med,'quantity',2))));
 req:=gen_random_uuid();answer:=public.crm_save_recovery_v16('crm_management_v5',args,req);
 if public.crm_save_recovery_v16('crm_management_v5',args,req) is distinct from answer then raise exception 'Template replay mismatch';end if;
 perform set_config('test.v16.template',answer->'result'->>'id',true);
 begin
  perform public.crm_save_recovery_v16('crm_management_v5',args||jsonb_build_object('p_payload',jsonb_build_object('name','TEST invalid template v16',
   'items',jsonb_build_array(jsonb_build_object('medication_id',med,'quantity',0.5)))),gen_random_uuid());
  raise exception 'Original template validation unexpectedly bypassed';
 exception when others then if sqlerrm='Original template validation unexpectedly bypassed' then raise;end if;end;

 args:=jsonb_build_object('p_action','patient_archive','p_payload',jsonb_build_object('id',current_setting('test.v16.patient'),'archived',true));
 req:=gen_random_uuid();answer:=public.crm_save_recovery_v16('crm_management_v5',args,req);
 if (answer->'result'->>'archived')::boolean is distinct from true or
  public.crm_save_recovery_v16('crm_management_v5',args,req) is distinct from answer then raise exception 'Patient archive replay mismatch';end if;
 args:=jsonb_build_object('p_action','patient_archive','p_payload',jsonb_build_object('id',current_setting('test.v16.patient'),'archived',false));
 perform public.crm_save_recovery_v16('crm_management_v5',args,gen_random_uuid());

 args:=jsonb_build_object('p_action','settings_save','p_payload',jsonb_build_object('float_amount',12345,'time_zone','Europe/Moscow'));
 req:=gen_random_uuid();answer:=public.crm_save_recovery_v16('crm_finance_v5',args,req);
 if (answer->'result'->>'float_amount')::numeric is distinct from 12345::numeric or
  public.crm_save_recovery_v16('crm_finance_v5',args,req) is distinct from answer then raise exception 'Finance settings replay mismatch';end if;
 perform set_config('test.v16.settings_request',req::text,true);
 begin
  perform public.crm_save_recovery_v16('crm_finance_v5',jsonb_build_object('p_action','settings_save','p_payload',jsonb_build_object('time_zone','UTC')),gen_random_uuid());
  raise exception 'Original finance validation unexpectedly bypassed';
 exception when others then if sqlerrm='Original finance validation unexpectedly bypassed' then raise;end if;end;
 begin
  perform public.crm_save_recovery_v16('crm_management_v5','{"p_action":"audit_list","p_payload":{}}',gen_random_uuid());
  raise exception 'Read action unexpectedly accepted by save dispatcher';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.crm_save_recovery_v16('crm_backup_data_v5','{}',gen_random_uuid());
  raise exception 'Unknown RPC unexpectedly accepted by save dispatcher';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.crm_save_recovery_v16('quick_ui_v4','[]',gen_random_uuid());raise exception 'Array args unexpectedly accepted';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.crm_save_recovery_v16('quick_ui_v4','{"p_action":"favorite"}',null);raise exception 'Missing request unexpectedly accepted';
 exception when invalid_parameter_value then null;end;
 if has_table_privilege('authenticated','private.crm_save_requests_v16','SELECT')
  or has_table_privilege('authenticated','private.crm_save_requests_v16','INSERT')
  or has_table_privilege('authenticated','private.crm_save_requests_v16','UPDATE')
  or has_table_privilege('authenticated','private.crm_save_requests_v16','DELETE')
  or has_function_privilege('authenticated','private.crm_save_recovery_v16(text,jsonb,uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.manager_set_medication_test(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,integer)','EXECUTE')
  or has_function_privilege('anon','public.crm_save_recovery_v16(text,jsonb,uuid)','EXECUTE') then
  raise exception 'Replay ledger or private dispatcher directly exposed';end if;
end $$;
reset role;
do $$begin
 if(select count(*) from public.medications where name='TEST save recovery medicine v16')<>1 then raise exception 'Create retry duplicated medicine';end if;
 if(select sale_price from public.medications where id=current_setting('test.v16.med')::uuid)<>300 then raise exception 'Old receipt overwrote newer price';end if;
 if(select count(*) from private.crm_audit_log where entity_type='medications' and entity_id=current_setting('test.v16.med') and action='insert')<>1 then raise exception 'Medicine create retry duplicated audit';end if;
 if(select count(*) from private.crm_audit_log where entity_type='medications' and entity_id=current_setting('test.v16.med') and action='update')<>1 then raise exception 'Medicine price edit/replay audit wrong';end if;
 if(select count(*) from private.crm_audit_log where entity_type='staff' and entity_id=current_setting('test.v16.created_staff'))<>1 then raise exception 'Staff replay duplicated audit';end if;
 if(select count(*) from private.crm_audit_log where entity_type='procedure_templates' and entity_id=current_setting('test.v16.template'))<>1 then raise exception 'Template replay duplicated audit';end if;
 if exists(select 1 from private.crm_save_requests_v16 where request_id=current_setting('test.v16.failed_ledger_request')::uuid)
  or exists(select 1 from private.warehouse_requests where id=current_setting('test.v16.invalid_request')::uuid) then raise exception 'Failed original validation left a receipt';end if;
 if(select count(*) from private.crm_audit_log where actor_user=current_setting('test.v16.manager')::uuid and action='finance_settings_changed')<>1 then raise exception 'Settings replay duplicated audit';end if;
end $$;

-- Other managers cannot reuse the first actor's request UUID either.
select set_config('request.jwt.claim.sub',current_setting('test.v16.other'),true);
set local role authenticated;
do $$begin
 begin
  perform public.crm_save_recovery_v16('crm_management_v5',current_setting('test.v16.staff_args')::jsonb,current_setting('test.v16.staff_request')::uuid);
  raise exception 'Other actor unexpectedly read cached save result';
 exception when invalid_parameter_value then null;end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v16.nurse'),true);
set local role authenticated;
do $$declare args jsonb;answer jsonb;req uuid:=gen_random_uuid();course uuid;shift uuid;route text;
begin
 args:=jsonb_build_object('p_patient_id',current_setting('test.v16.patient'),'p_title','TEST saved course v16','p_start','2097-05-01',
  'p_end','2097-05-10','p_plan','TEST plan','p_notes','TEST nurse note');
 answer:=public.crm_save_recovery_v16('add_patient_course_test',args,req);course:=(answer->>'result')::uuid;
 if course is null or public.crm_save_recovery_v16('add_patient_course_test',args,req) is distinct from answer then raise exception 'Nurse course replay mismatch';end if;
 perform set_config('test.v16.course',course::text,true);perform set_config('test.v16.course_request',req::text,true);
 perform set_config('test.v16.course_args',args::text,true);
 begin
  perform public.crm_save_recovery_v16('set_course_status_test',jsonb_build_object('p_course_id',course,'p_status','completed'),req);
  raise exception 'Request UUID unexpectedly reused for different RPC';
 exception when invalid_parameter_value then null;end;
 args:=jsonb_build_object('p_course_id',course,'p_status','completed');req:=gen_random_uuid();
 answer:=public.crm_save_recovery_v16('set_course_status_test',args,req);
 if answer is distinct from '{"result":null}'::jsonb or public.crm_save_recovery_v16('set_course_status_test',args,req) is distinct from answer then raise exception 'Nurse status void replay mismatch';end if;
 args:=jsonb_build_object('p_action','favorite','p_payload',jsonb_build_object('id',current_setting('test.v16.med'),'selected',true));
 req:=gen_random_uuid();answer:=public.crm_save_recovery_v16('quick_ui_v4',args,req);
 if (answer->'result'->>'selected')::boolean is distinct from true or public.crm_save_recovery_v16('quick_ui_v4',args,req) is distinct from answer then raise exception 'Nurse favorite replay mismatch';end if;
 args:=jsonb_build_object('p_shift_date','2097-05-01','p_started_at','2097-05-01T08:30:00+03','p_planned_end_at','2097-05-01T16:00:00+03',
  'p_nurse1',current_setting('test.v16.nurse_staff'),'p_nurse2',current_setting('test.v16.peer_staff'));
 req:=gen_random_uuid();answer:=public.crm_save_recovery_v16('start_shift_v82',args,req);shift:=(answer->>'result')::uuid;
 if shift is null or public.crm_save_recovery_v16('start_shift_v82',args,req) is distinct from answer then raise exception 'Nurse shift replay mismatch';end if;
 perform set_config('test.v16.shift',shift::text,true);perform set_config('test.v16.shift_args',args::text,true);
 perform set_config('test.v16.shift_request',req::text,true);
 foreach route in array array['staff_save','patient_archive'] loop
  begin
   perform public.crm_save_recovery_v16('crm_management_v5',jsonb_build_object('p_action',route,'p_payload','{}'::jsonb),gen_random_uuid());
   raise exception 'Nurse unexpectedly authorized for manager save';
  exception when insufficient_privilege then null;end;
 end loop;
 foreach route in array array['settings_save','salary'] loop
  begin
   perform public.crm_save_recovery_v16('crm_finance_v5',jsonb_build_object('p_action',route,'p_payload','{}'::jsonb),gen_random_uuid());
   raise exception 'Nurse unexpectedly authorized for manager finance save';
  exception when insufficient_privilege then null;end;
 end loop;
 begin
  perform public.warehouse_v5('save',current_setting('test.v16.med_args')::jsonb,gen_random_uuid());
  raise exception 'Nurse unexpectedly changed medicine prices';
 exception when others then if sqlerrm='Nurse unexpectedly changed medicine prices' then raise;end if;end;
 begin
  perform public.crm_save_recovery_v16('manager_medication_details_photo_v1',jsonb_build_object('p_id',current_setting('test.v16.med')),gen_random_uuid());
  raise exception 'Nurse unexpectedly changed medication metadata';
 exception when insufficient_privilege then null;end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v16.manager'),true);
set local role authenticated;
do $$declare args jsonb;answer jsonb;req uuid:=gen_random_uuid();begin
 args:=jsonb_build_object('p_action','salary','p_payload',jsonb_build_object('shift_id',current_setting('test.v16.shift'),
  'staff_id',current_setting('test.v16.nurse_staff'),'amount',2500,'reason','TEST manager payroll v16'));
 answer:=public.crm_save_recovery_v16('crm_finance_v5',args,req);
 if public.crm_save_recovery_v16('crm_finance_v5',args,req) is distinct from answer then raise exception 'Payroll replay mismatch';end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v16.nurse'),true);
set local role authenticated;
do $$declare args jsonb;answer jsonb;req uuid:=gen_random_uuid();begin
 args:=jsonb_build_object('p_action','close','p_payload',jsonb_build_object('shift_id',current_setting('test.v16.shift')));
 answer:=public.crm_save_recovery_v16('crm_finance_v5',args,req);
 if answer->'result'->'shift'->>'status' is distinct from 'closed' or public.crm_save_recovery_v16('crm_finance_v5',args,req) is distinct from answer then raise exception 'Assigned nurse close replay mismatch';end if;
 perform set_config('test.v16.close_request',req::text,true);perform set_config('test.v16.close_args',args::text,true);
end $$;
reset role;
-- Cache a full manager report and later demote that same assigned actor.
-- Trusted fixtures change assignment only while the synthetic shift is open.
-- The production two-active-nurse assignment guard is left fully enabled.
update public.shifts set status='open' where id=current_setting('test.v16.shift')::uuid;
delete from public.shift_staff where shift_id=current_setting('test.v16.shift')::uuid
 and staff_id=current_setting('test.v16.peer_staff')::uuid;
update public.staff set role='nurse' where id=current_setting('test.v16.manager_staff')::uuid;
insert into public.shift_staff(shift_id,staff_id)
 values(current_setting('test.v16.shift')::uuid,current_setting('test.v16.manager_staff')::uuid);
update public.staff set role='admin' where id=current_setting('test.v16.manager_staff')::uuid;
update public.shifts set status='closed' where id=current_setting('test.v16.shift')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.v16.manager'),true);
set local role authenticated;
do $$declare args jsonb:=current_setting('test.v16.close_args')::jsonb;answer jsonb;req uuid:=gen_random_uuid();begin
 answer:=public.crm_save_recovery_v16('crm_finance_v5',args,req);
 if not(answer->'result' ? 'stock') or not(answer->'result' ? 'payroll_total') then raise exception 'Manager close fixture lacks restricted report data';end if;
 perform set_config('test.v16.manager_close_request',req::text,true);
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v16.nurse'),true);
do $$begin
 if(select count(*) from public.patient_treatment_courses where id=current_setting('test.v16.course')::uuid and status='completed')<>1 then raise exception 'Course/status retry lost record';end if;
 if(select count(*) from public.shifts where id=current_setting('test.v16.shift')::uuid)<>1 then raise exception 'Shift retry duplicated record';end if;
 if(select count(*) from private.crm_shift_reports where shift_id=current_setting('test.v16.shift')::uuid)<>1 then raise exception 'Shift close retry duplicated report';end if;
 if(select count(*) from private.crm_audit_log where action='shift_closed' and entity_id=current_setting('test.v16.shift'))<>1 then raise exception 'Shift close retry duplicated audit';end if;
 if(select count(*) from private.crm_audit_log where action='salary_changed' and entity_id=current_setting('test.v16.shift')||'/'||current_setting('test.v16.nurse_staff'))<>1 then raise exception 'Salary replay duplicated audit';end if;
 -- Current assignment changes must affect cached close access too.
 update public.shifts set status='open' where id=current_setting('test.v16.shift')::uuid;
 delete from public.shift_staff where shift_id=current_setting('test.v16.shift')::uuid and staff_id=current_setting('test.v16.nurse_staff')::uuid;
 update public.shifts set status='closed' where id=current_setting('test.v16.shift')::uuid;
end $$;
set local role authenticated;
do $$begin
 begin
  perform public.crm_save_recovery_v16('crm_finance_v5',current_setting('test.v16.close_args')::jsonb,current_setting('test.v16.close_request')::uuid);
  raise exception 'Formerly assigned nurse unexpectedly obtained cached shift report';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.staff set active=false where id=current_setting('test.v16.nurse_staff')::uuid;
set local role authenticated;
do $$begin
 begin
  perform public.crm_save_recovery_v16('add_patient_course_test',current_setting('test.v16.course_args')::jsonb,current_setting('test.v16.course_request')::uuid);
  raise exception 'Inactive nurse unexpectedly obtained cached course result';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v16.manager'),true);
update public.staff set role='nurse' where id=current_setting('test.v16.manager_staff')::uuid;
set local role authenticated;
do $$declare answer jsonb;begin
 begin
  perform public.crm_save_recovery_v16('crm_management_v5',current_setting('test.v16.staff_args')::jsonb,current_setting('test.v16.staff_request')::uuid);
  raise exception 'Demoted manager unexpectedly obtained cached manager save result';
 exception when insufficient_privilege then null;end;
 answer:=public.crm_save_recovery_v16('crm_finance_v5',current_setting('test.v16.close_args')::jsonb,current_setting('test.v16.manager_close_request')::uuid);
 if answer->'result' ? 'stock' or answer->'result' ? 'used' or answer->'result' ? 'float_amount'
  or exists(select 1 from jsonb_array_elements(answer->'result'->'staff') member where member ? 'reason') then
  raise exception 'Assigned demoted manager replay leaked manager shift data';end if;
 if not(answer->'result' ? 'payroll_total') or not(answer->'result' ? 'payroll_complete')
  or not(answer->'result' ? 'payroll_unknown') or not(answer->'result' ? 'cash_after_salary')
  or exists(select 1 from jsonb_array_elements(answer->'result'->'staff') member where not(member ? 'amount')) then
  raise exception 'Assigned demoted manager replay hid authorized shift payroll';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
do $$begin
 begin
  perform public.crm_save_recovery_v16('quick_ui_v4','{"p_action":"favorite","p_payload":{}}',gen_random_uuid());
  raise exception 'Missing auth unexpectedly authorized';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$begin
 begin
  perform public.crm_save_recovery_v16('quick_ui_v4','{}',gen_random_uuid());raise exception 'Anonymous save unexpectedly authorized';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'crm-save-recovery-v16 original RPC replay, audit, rollback and access tests passed' as result;
rollback;
