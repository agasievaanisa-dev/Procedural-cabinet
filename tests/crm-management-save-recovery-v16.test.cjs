const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const {webcrypto}=require('node:crypto');

function setup(){
  const elements=new Map(),notices=[],calls=[];
  const el=id=>{
    if(!elements.has(id)){
      const classes=new Set(['staffV5','templatesV5','settingsV5','services'].includes(id)?['active']:[]);
      elements.set(id,{id,value:'',innerHTML:'',checked:false,disabled:false,textContent:'',
        classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},
        querySelector(selector){return selector.includes('saveSettingsV5()')?el('settingsSaveV5'):selector.includes('button')?el(selector):null},querySelectorAll(){return []},
        closest(){return {lastChild:{textContent:''},querySelectorAll(){return []}}},
        setAttribute(name){if(name==='disabled')this.disabled=true},scrollIntoView(){},remove(){classes.clear()}});
    }
    return elements.get(id);
  };
  const controls={staffV5:['staffEditNameV5','staffEditRoleV5','staffEditActiveV5','staffCreateNameV5','staffCreateEmailV5','staffCreatePasswordV5'],
    templatesV5:['templateNameV5','templateServiceV5','templateNotesV5','templateActiveV5'],settingsV5:['settingsFloatV5','settingsPaymentOnlyV5','settingsSaveV5']};
  for(const [id,ids] of Object.entries(controls))el(id).querySelectorAll=()=>ids.map(el);
  el('staffEditV5').querySelectorAll=()=>controls.staffV5.slice(0,3).map(el);
  el('templateEditV5').querySelectorAll=()=>controls.templatesV5.map(el);
  el('services').querySelector=()=>el('serviceSaveButton');
  const c={console,Number,String,Date,Intl,Set,Map,JSON,Math,Error,Promise,Blob,setTimeout,crypto:webcrypto,$:el,
    currentStaff:{id:'owner1',role:'owner'},services:[{id:'service1',name:'Капельница',work_price:500,consumables_price:100}],serviceRows:[],serviceSaving:false,
    meds:[{id:'m1',name:'Самыр',active:true,consumption_unit:'амп.'}],inventory:[],warehouseBusy:false,
    esc:s=>String(s??''),qty:v=>String(v),unit:m=>m.consumption_unit||'ед.',num:v=>Number(v||0),rub:v=>v+' ₽',normalizeSearch:s=>String(s||'').toLowerCase(),
    isManager(){return ['owner','admin'].includes(c.currentStaff?.role)},message(id,value,success){notices.push({id,value,success})},
    show(id){for(const section of ['staffV5','templatesV5','settingsV5','services','workspace'])el(section).classList.remove('active');el(id).classList.add('active')},
    loadNurses:async()=>{},loadServices:async()=>{},loadMeds:async()=>{},loadInventory:async()=>{},crmFinanceRpcV5:async()=>({payment_only:true,float_amount:50000}),
    signOut:async()=>{c.currentStaff=null},prepareTreatment4:async()=>true,warehouseRpc:async()=>[],loadStockDetails:async()=>{},openMedForm(){},
    localDateValue:()=>'2026-10-12',calcProcedure(){},recalc(){},addMedRow(){},matchesMedication(){},
    db:{rpc:async(name,args,options)=>{calls.push({name,args:JSON.parse(JSON.stringify(args)),options});return {data:[],error:null}},
      functions:{invoke:async(name,args)=>{calls.push({name,args});return {data:{staff:{id:'newstaff',full_name:'Нина',auth_user_id:'auth-new',role:'nurse'}},error:null}}}}};
  vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../crm-management-v5.js','utf8'),c);
  function form(kind){
    if(kind==='staff'){el('staffEditIdV5').value='n1';el('staffEditNameV5').value='Нина';el('staffEditRoleV5').value='nurse';el('staffEditActiveV5').checked=true}
    if(kind==='template'){el('templateIdV5').value='';el('templateNameV5').value='Шаблон без препаратов';el('templateServiceV5').value='service1';el('templateNotesV5').value='Сохранить комментарий';el('templateActiveV5').checked=true}
    if(kind==='settings'){vm.runInContext('managementSettingsLoadedV5=true',c);el('settingsFloatV5').value='45000';el('settingsPaymentOnlyV5').checked=true}
    if(kind==='account'){el('staffCreateNameV5').value='Нина';el('staffCreateEmailV5').value='nina@example.com';el('staffCreatePasswordV5').value='private-first-password'}
  }
  return {c,el,notices,calls,form,value:code=>vm.runInContext(code,c)};
}
const clone=value=>JSON.parse(JSON.stringify(value));

test('confirmed staff save remains successful when both list refreshes fail',async()=>{
  const {c,el,form,notices,value}=setup();form('staff');c.loadNurses=async()=>{throw Error('Load failed')};
  c.db.rpc=async(_name,args)=>args.p_action==='staff_save'?{data:{...args.p_payload,id:'n1'}}:{error:{message:'Load failed',uncertain:true}};
  await c.saveStaffV5();assert.equal(el('staffEditV5').classList.contains('hidden'),true);
  assert.equal(value('managementStaffV5[0].full_name'),'Нина');assert.equal(value('managementDraftsV16.staff'),null);
  assert.match(notices.at(-1).value,/сохранены.*Список пока не обновился/);assert.equal(notices.at(-1).success,true);
});

test('confirmed template creation survives malformed refresh without losing saved cache or inviting another create',async()=>{
  const {c,form,notices,value}=setup();form('template');let mutations=0;
  c.db.rpc=async(_name,args)=>args.p_action==='template_save'?{data:{...args.p_payload,id:'template-'+(++mutations)}}:{data:null};
  await c.saveTemplateV5();assert.equal(mutations,1);assert.equal(value('managementTemplatesV5.length'),1);
  assert.equal(value('managementTemplatesV5[0].name'),'Шаблон без препаратов');assert.equal(value('managementDraftsV16.template'),null);
  assert.match(notices.at(-1).value,/Шаблон сохранён.*Повторно создавать шаблон не нужно/);assert.equal(notices.at(-1).success,true);
});

test('lost template receipt freezes composition and manual retry reuses one UUID and original payload',async()=>{
  const {c,el,form,calls,value}=setup();form('template');const receipts=new Map();let lost=true,mutations=0;
  c.db.rpc=async(name,args,options)=>{
    calls.push({name,args:clone(args),options:clone(options)});
    if(args.p_action==='templates_list')return {data:[...receipts.values()]};
    if(!receipts.has(options.saveRequestIdV16))receipts.set(options.saveRequestIdV16,{...clone(args.p_payload),id:'t'+(++mutations)});
    if(lost){lost=false;return {error:{message:'Ответ потерян',uncertain:true}}}
    return {data:receipts.get(options.saveRequestIdV16)};
  };
  await c.saveTemplateV5();assert.equal(el('templateNameV5').disabled,true);assert.equal(value('managementDraftsV16.template.uncertain'),true);
  assert.equal(value('Object.isFrozen(managementDraftsV16.template.payload.items)'),true);
  el('templateNameV5').value='Не должно попасть в повтор';c.editTemplateV5(-1);await c.saveTemplateV5();
  const writes=calls.filter(call=>call.args.p_action==='template_save');assert.equal(writes.length,2);assert.deepEqual(writes[1],writes[0]);
  assert.match(writes[0].options.saveRequestIdV16,/^[a-f0-9-]{36}$/i);assert.equal(mutations,1);assert.equal(value('managementTemplatesV5[0].name'),'Шаблон без препаратов');
});

test('staff draft retains uncertainty across a subsequent definitive rejection and resolves with the same request',async()=>{
  const {c,el,form,calls,value}=setup();form('staff');let attempt=0;
  c.db.rpc=async(name,args,options)=>{
    if(args.p_action==='staff_list')return {data:[{id:'n1',full_name:'Нина',role:'nurse'}]};
    calls.push({name,args:clone(args),options:clone(options)});++attempt;
    return attempt===1?{error:{message:'Load failed',uncertain:true}}:attempt===2?{error:{message:'Нет доступа',code:'42501'}}:{data:{...args.p_payload,id:'n1'}};
  };
  await c.saveStaffV5();await c.saveStaffV5();assert.equal(value('managementDraftsV16.staff.uncertain'),true);assert.equal(el('staffEditNameV5').disabled,true);
  await c.saveStaffV5();assert.equal(calls.length,3);assert.deepEqual(calls[1],calls[0]);assert.deepEqual(calls[2],calls[0]);assert.equal(value('managementDraftsV16.staff'),null);
});

test('settings retry freezes original values and a dashboard refresh failure preserves confirmed success',async()=>{
  const {c,el,form,calls,notices,value}=setup();form('settings');let attempt=0,accounting;
  c.setAccountingModeV5=data=>{accounting=clone(data)};c.refreshOwnerDashboardV5=async()=>{throw Error('Load failed')};
  c.db.rpc=async(name,args,options)=>{calls.push({name,args:clone(args),options:clone(options)});return ++attempt===1?{error:{message:'Load failed',uncertain:true}}:{data:{...args.p_payload}}};
  await c.saveSettingsV5();assert.equal(el('settingsFloatV5').disabled,true);assert.equal(el('settingsSaveV5').disabled,false);
  el('settingsFloatV5').value='1';el('settingsPaymentOnlyV5').checked=false;await c.saveSettingsV5();
  assert.deepEqual(calls[1],calls[0]);assert.equal(accounting.float_amount,45000);assert.equal(accounting.payment_only,true);assert.equal(value('managementDraftsV16.settings'),null);
  assert.match(notices.at(-1).value,/Настройки сохранены.*Главный экран пока не обновился/);assert.equal(notices.at(-1).success,true);
});

test('confirmed Edge account creation clears password and stays successful when staff reload fails',async()=>{
  const {c,el,form,calls,notices}=setup();form('account');c.loadNurses=async()=>{throw Error('Load failed')};c.db.rpc=async()=>({data:null});
  await c.createStaffAccountV5();assert.equal(calls.filter(call=>call.name==='crm-admin').length,1);assert.equal(el('staffCreatePasswordV5').value,'');
  assert.match(notices.at(-1).value,/Учётная запись создана.*Повторно создавать доступ не нужно/);assert.equal(notices.at(-1).success,true);
});

test('ambiguous Edge account response is verified by email before any further create',async()=>{
  const {c,el,form,notices,value}=setup();form('account');let creates=0,found=false;
  const saved={id:'n-new',full_name:'Нина',role:'nurse',email:'nina@example.com',auth_user_id:'auth-new'};
  c.db.functions.invoke=async()=>{++creates;return {error:{name:'FunctionsFetchError',message:'Failed to send a request to the Edge Function'}}};
  c.db.rpc=async()=>({data:found?[saved]:[]});
  await c.createStaffAccountV5();assert.equal(el('staffCreateEmailV5').disabled,true);assert.equal(value('managementDraftsV16.account.uncertain'),true);
  await c.createStaffAccountV5();assert.equal(creates,1);assert.match(notices.at(-1).value,/пока не получено/);
  found=true;await c.createStaffAccountV5();assert.equal(creates,1);assert.equal(el('staffCreatePasswordV5').value,'');assert.equal(value('managementDraftsV16.account'),null);
  assert.match(notices.at(-1).value,/Учётная запись создана/);
});

test('malformed service reads cannot wipe confirmed price list and catalog caches',async()=>{
  const {c,el,notices}=setup();c.serviceRows=[{id:'old',name:'Старая услуга'}];const catalogBefore=clone(c.services);
  c.db.rpc=async(name,args)=>name==='crm_service_save_v11'?{data:{...args.p_payload,id:'new-service'}}:{data:name==='nurse_service_catalog'?{}:null};
  const loaded=await c.loadServicesAdmin();assert.equal(loaded,false);assert.equal(c.serviceRows[0].id,'old');
  el('serviceName').value='Новая услуга';el('serviceWork').value='100';el('serviceConsumables').value='0';el('serviceCommentV5').value='';el('serviceActive').checked=true;
  await c.saveService();assert.equal(c.serviceRows.some(row=>row.id==='new-service'),true);assert.equal(c.serviceRows.some(row=>row.id==='old'),true);
  assert.equal(c.services.some(row=>row.id==='new-service'),true);assert.equal(c.services.some(row=>row.id===catalogBefore[0].id),true);
  assert.match(notices.at(-1).value,/Услуга сохранена.*Повторно создавать услугу не нужно/);assert.equal(notices.at(-1).success,true);
});

test('service recovery delegates classification and does not multiply central retries',async()=>{
  const {c}=setup();let requests=0,classified=0;
  c.SaveRecoveryV16={isRetryable:()=>{++classified;return true}};
  c.db.rpc=async()=>{++requests;return {error:{message:'Transient',recoveryAttemptedV16:true},status:503}};
  await assert.rejects(c.serviceRequestV11('crm_service_save_v11',{}),/ответ от сервера/);assert.equal(requests,1);assert.ok(classified>0);
});

test('late staff response from a prior session cannot paint or clear the current login',async()=>{
  const {c,form,el,value}=setup();form('staff');let release;
  c.db.rpc=()=>new Promise(resolve=>{release=()=>resolve({data:{id:'n1',full_name:'Старый ответ',role:'nurse'}})});
  const pending=c.saveStaffV5();await c.signOut();c.currentStaff={id:'owner1',role:'owner'};
  el('staffEditNameV5').value='Новый черновик';release();await pending;
  assert.equal(el('staffEditNameV5').value,'Новый черновик');assert.equal(value('managementDraftsV16.staff'),null);assert.equal(value('managementStaffV5.length'),0);
});
