/* Repeat only reads or receipt-protected mutations. Unknown outcomes keep the
   original request identity; confirmed saves are never inferred from a timeout. */
(function(root){
 'use strict';
 function isRetryable(error,status){
  if(error?.retryable!==undefined)return !!error.retryable;
  const code=String(error?.code||''),message=String(error?.message||error||'');
  if(/^[0-9A-Z]{5}$/.test(code))return /^08/.test(code)||/^57P0[123]$/.test(code);
  if(/^PGRST/.test(code))return /^PGRST00[0-3]$/.test(code);
  // The pinned SDK returns malformed success JSON as an error containing the
  // raw response body. A 2xx status with no database error code is unconfirmed.
  if(Number(status||error?.status)>=200&&Number(status||error?.status)<300)return true;
  if([408,429,500,502,503,504].includes(Number(status||error?.status)))return true;
  if(Number(status||error?.status)>=400)return false;
  return /load failed|failed to fetch|fetch failed|network|connection|timed?\s*out|timeout|abort|unexpected.*(?:json|token|end)|json.*(?:parse|invalid)|missing response|invalid response/i.test(message)||error?.name==='SyntaxError'||error?.name==='AbortError';
 }
 function isDefinitive(error,status){return !error?.uncertain&&!isRetryable(error,status)&&(/^[0-9A-Z]{5}$/.test(error?.code||'')||/^PGRST/.test(error?.code||'')||Number(status||error?.status)>=400);}
 function legacy(name,args){
  const action=args?.p_action;
  return name==='crm_management_v5'&&['staff_save','template_save','patient_archive'].includes(action)||
   name==='crm_finance_v5'&&['settings_save','salary','close'].includes(action)||
   name==='quick_ui_v4'&&action==='favorite'||
   ['start_shift_v82','manager_medication_details_photo_v1','add_patient_course_test','set_course_status_test'].includes(name);
 }
 function readOnly(name,args){
  const action=args?.p_action;
  if(name==='crm_management_v5')return ['patient_list','services_list','staff_list','templates_list','audit_list'].includes(action);
  if(name==='crm_finance_v5')return ['summary','settings_get','accounting_mode','shift_report'].includes(action);
  if(name==='crm_clinical_v10')return ['patient_treatments','treatment_get','debts'].includes(action);
  if(name==='warehouse_v5')return ['list','batches','history'].includes(action);
  if(name==='quick_ui_v4')return ['context','last_procedure'].includes(action);
  return ['nurse_service_catalog','work_catalog_v2','patient_files_v8','patient_courses_test','patient_history_v8','crm_shift_journal_v12','get_my_open_shift_v82','mentor_patients_test','mentor_patient_history_test','crm_warehouse_report_v5','crm_backup_status_v5'].includes(name);
 }
 function validData(name,args,data){
  const action=args?.p_action;
  if(['start_shift_v82','manager_set_medication_test','add_patient_course_test'].includes(name))return typeof data==='string'&&!!data;
  if(name==='crm_management_v5'&&['staff_save','template_save','patient_archive'].includes(action))return !!data&&typeof data.id==='string';
  if(name==='crm_finance_v5'&&['settings_save','salary','close'].includes(action))return !!data&&typeof data==='object'&&!Array.isArray(data);
  if(name==='crm_patient_delete_v10')return !!data&&typeof data==='object';
  if(['crm_patient_save_v11','crm_service_save_v11'].includes(name)){const row=data?.patient||data?.service||data;return !!row&&typeof row.id==='string';}
  if(/^record_treatment_v[35]$/.test(name)||name==='crm_clinical_v10'&&['treatment_edit','debt_payment','treatment_get'].includes(action))return !!data&&typeof data.id==='string';
  if(name==='warehouse_v5'&&action==='save')return !!data&&typeof data.id==='string';
  if(['nurse_service_catalog','work_catalog_v2','patient_files_v8','patient_courses_test','mentor_patients_test'].includes(name)||name==='crm_management_v5'&&['patient_list','services_list','staff_list','templates_list','audit_list'].includes(action)||name==='warehouse_v5'&&['list','batches','history'].includes(action))return Array.isArray(data);
  if(readOnly(name,args)&&name!=='get_my_open_shift_v82'&&!(name==='quick_ui_v4'&&action==='last_procedure'))return !!data&&typeof data==='object';
  if(args?.p_request_id)return data!==null&&data!==undefined;
  return true;
 }
 function install(client,getActor,configuration={}){
  const original=client.rpc.bind(client),pending=new Map();let epoch=0,lastUser=null;
  const uuid=configuration.uuid||(()=>root.crypto.randomUUID()),pause=configuration.pause||(()=>new Promise(resolve=>setTimeout(resolve,350)));
  const timeout=configuration.timeoutMs??12000;
  const actor=()=>JSON.stringify([getActor?.(),epoch]);
  client.auth?.onAuthStateChange?.((event,session)=>{
   const next=session?.user?.id||null;
   if(event==='SIGNED_OUT'||event==='SIGNED_IN'&&next!==lastUser){epoch++;pending.clear();}
   if(event==='SIGNED_IN'||event==='INITIAL_SESSION'||event==='SIGNED_OUT')lastUser=next;
  });
  async function send(name,args,options){
   if(!timeout)return original(name,args,options);
   let timer;
   try{return await Promise.race([Promise.resolve().then(()=>original(name,args,options)),new Promise(resolve=>{timer=setTimeout(()=>resolve({data:null,error:{message:'Request timeout',retryable:true},status:0}),timeout)})]);}
   finally{clearTimeout(timer);}
  }
  client.rpc=async function(name,args={},options={}){
   const identity=actor(),isLegacy=legacy(name,args),read=readOnly(name,args);
   const safe=isLegacy||read||!!args?.p_request_id||name==='crm_patient_delete_v10'&&!!args?.p_payload?.request_id||name==='register_patient_file_v8'&&!!args?.p_storage_path;
   const key=JSON.stringify([identity,name,args]),callOptions={...options};delete callOptions.saveRequestIdV16;
   let entry=pending.get(key);
   if(!entry){entry={requestId:options.saveRequestIdV16||uuid(),uncertain:false};if(isLegacy||safe&&!read)pending.set(key,entry);}
   const actualName=isLegacy?'crm_save_recovery_v16':name;
   const actualArgs=isLegacy?{p_rpc:name,p_args:JSON.parse(JSON.stringify(args)),p_request_id:entry.requestId}:JSON.parse(JSON.stringify(args));
   for(let attempt=0;attempt<(safe?2:1);attempt++){
    if(actor()!==identity)return {data:null,error:{message:'Учётная запись изменилась. Откройте форму заново.',code:'CRM_SESSION_CHANGED',uncertain:entry.uncertain},status:0};
    let response;
    try{response=await send(actualName,actualArgs,callOptions);}catch(error){response={data:null,error,status:0};}
    if(actor()!==identity)return {data:null,error:{message:'Учётная запись изменилась. Откройте форму заново.',code:'CRM_SESSION_CHANGED',uncertain:!read},status:0};
    let error=response?.error;
    if(!error){
     const envelope=response?.data;
     const validEnvelope=!isLegacy||envelope&&typeof envelope==='object'&&Object.prototype.hasOwnProperty.call(envelope,'result');
     const data=isLegacy?envelope?.result:envelope;
     if(response&&validEnvelope&&validData(name,args,data)){
      if(pending.get(key)===entry)pending.delete(key);
      return {...response,data};
     }
     error={message:'Invalid response from server',retryable:true};
    }
    const retryable=isRetryable(error,response?.status);
    if(retryable&&!read)entry.uncertain=true;
    if(retryable&&safe&&attempt===0){await pause();continue;}
    if(!entry.uncertain&&pending.get(key)===entry)pending.delete(key);
    const normalized={...error,message:error.message||String(error),code:error.code||'',details:error.details||'',hint:error.hint||'',status:response?.status||error.status||0,retryable,uncertain:entry.uncertain,recoveryAttemptedV16:true};
    if(retryable)normalized.message=read?'Не удалось загрузить данные. Проверьте интернет и повторите.':'Ответ о сохранении не получен. Данные сохранены в форме. Нажмите «Повторить сохранение», чтобы проверить исходную запись.';
    return {...response,data:null,error:normalized,status:normalized.status};
   }
  };
  return {clear(){epoch++;pending.clear();}};
 }
 const api={isRetryable,isDefinitive,install};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.SaveRecoveryV16=api;
})(typeof window==='undefined'?globalThis:window);
