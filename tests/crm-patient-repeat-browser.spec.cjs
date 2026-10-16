const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'});

async function boot(page,role='nurse'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-15T08:25:13Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  const actor={id:'staff-a',full_name:'Текущая медсестра',role,active:true};
  const staff=[{id:'staff-a',full_name:'Текущая медсестра'},{id:'staff-b',full_name:'Другая медсестра'}];
  const opened={id:'shift-current',date:'2026-10-15',started_at:'2026-10-15T05:30:00Z',planned_end_at:'2026-10-15T13:00:00Z',status:'open',staff};
  patients=[{id:'patient-a',full_name:'Анна',sex:'female'},{id:'patient-b',full_name:'Борис',sex:'male'}];nurses=staff;
  meds=[{id:'med-mg',name:'Мунджаро',consumption_unit:'мг',sale_price:1300,work_qty:100,active:true},{id:'med-vial',name:'Физраствор',consumption_unit:'фл.',sale_price:200,work_qty:100,active:true}];
  services=[{id:'service-infusion',name:'Капельница',work_price:100,consumables_price:50,active:true},{id:'service-shot',name:'Внутримышечный укол',work_price:50,consumables_price:25,active:true}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:100,units_per_package:5,purchase_price:0}));
  window.__repeatSource={id:'old-procedure',kind:'procedure',patient_id:'patient-a',patient:'Анна',nurse_id:'staff-past',nurse:'Прошлая медсестра',shift_id:'closed-past-shift',editable:false,version:8,service_id:'service-infusion',procedure_type:'Капельница',at:'2026-08-01T06:10:49Z',arrival_at:'2026-08-01T06:10:49Z',visit_at:'2026-08-01T06:20:49Z',recorded_at:'2026-08-01T06:20:49Z',services:[{service_id:'service-infusion',name:'Капельница',quantity:2,unit_price:600,line_total:1200},{service_id:'service-shot',name:'Внутримышечный укол',quantity:3,unit_price:100,line_total:300}],items:[{medication_id:'med-mg',name:'Мунджаро',quantity:2.5,dose:'2,5 мг по назначению',unit:'мг',unit_price:2000,line_total:5000},{medication_id:'med-vial',name:'Физраствор',quantity:2,dose:'100 мл',unit:'фл.',unit_price:100,line_total:200}],own_medications:[{name:'Свой B12',quantity:2,unit:'амп.',source:'previously_purchased',dose:'500 мкг'}],list_total:6700,charge_total:6500,paid_total:1000,received_total:1000,initial_paid_total:1000,debt_total:5500,payment_pending:false,payment_status:'debt',stock_deducted:true,payments:{cash:1000,terminal:0,owner_card:0},discount_reason:'Постоянная скидка',discount_comment:'Старая договорённость',notes:'Старый комментарий не повторять'};
  window.__repeatCalls=[];window.__repeatWrites=[];window.__repeatGets=0;window.__repeatLose=false;window.__repeatHold=false;window.__repeatReadError=null;window.__repeatReplays=new Map();window.__repeatQuickSource=null;window.__repeatPrepareHold=false;
  db.from=()=>{const query={select(){return query},eq(){return query},order(){return query},maybeSingle:async()=>({data:actor})};return query};
  db.rpc=async(name,args={})=>{
   __repeatCalls.push({name,args:clone(args)});
   if(name==='record_treatment_v5'){
    if(__repeatReplays.has(args.p_request_id))return {data:clone(__repeatReplays.get(args.p_request_id))};
    const data={...clone(args.p_payload),id:'new-procedure',kind:'procedure',editable:true,version:1,received_total:args.p_payload.paid_total,debt_total:args.p_payload.charge_total-args.p_payload.paid_total};
    __repeatWrites.push({name,args:clone(args)});__repeatReplays.set(args.p_request_id,clone(data));
    if(__repeatLose){__repeatLose=false;throw new TypeError('Load failed')}
    return {data};
   }
   if(name==='crm_clinical_v10'){
    if(args.p_action==='treatment_get'){
     ++__repeatGets;const data=clone(__repeatSource);if(__repeatHold){__repeatHold=false;await new Promise(resolve=>window.__releaseRepeat=resolve)}
     return __repeatReadError?{error:__repeatReadError}:{data};
    }
    if(args.p_action==='patient_treatments')return {data:{procedures:args.p_payload.patient_id==='patient-a'?[clone(__repeatSource)]:[],sales:[{id:'old-sale',patient_id:'patient-a',at:'2026-08-01T07:00:00Z',items:[],charge_total:100,paid_total:100,debt_total:0,editable:false}]}};
    return {data:[]};
   }
   if(name==='crm_management_v5'&&args.p_action==='patient_list')return {data:clone(patients)};
   if(name==='crm_finance_v5')return {data:args.p_action==='accounting_mode'?{payment_only:true,stock_deducted:false}:{shift:opened,staff,procedures:[],sales:[],receipts:[],revenue:{cash:0,terminal:0,owner_card:0,total:0}}};
   if(name==='quick_ui_v4'){
    if(args.p_action==='last_procedure'){
     const data=clone(__repeatQuickSource);
     if(__repeatPrepareHold){__repeatPrepareHold=false;await new Promise(resolve=>window.__releaseRepeatPreparation=resolve)}
     return {data};
    }
    return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   }
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};
   if(name==='crm_shift_journal_v12')return {data:{date:'2026-10-15',time_zone:'Europe/Moscow',reports:[{shift:opened,staff,procedures:[],sales:[]}]}};
   if(name.includes('warehouse'))return {data:inventory};return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'mock-auth'});shift={id:'shift-current',aId:'staff-a',a:'Текущая медсестра',bId:'staff-b',b:'Другая медсестра',type:'08:30–16:00'};
  await openPatient('patient-a');
 },role);
 await expect(page.locator('#patientCard')).toBeVisible();return errors;
}
async function repeat(page){await page.locator('#patientClinicalV10 [data-repeat-procedure-v33]').click();await expect(page.locator('#procedure')).toBeVisible()}
const writes=page=>page.evaluate(()=>__repeatWrites);

test('a nurse sees a closed-shift procedure performed by another nurse and can repeat it without being allowed to edit it',async({page})=>{
 const errors=await boot(page);await expect(page.locator('#patientCardOpenV20')).toHaveText('История процедур');
 for(const text of ['Капельница','Внутримышечный укол','Мунджаро','2,5 мг по назначению','Свой B12','500 мкг'])await expect(page.locator('#patientClinicalV10')).toContainText(text);
 await expect(page.locator('#patientClinicalV10 [data-repeat-procedure-v33]')).toHaveCount(1);await expect(page.locator('#patientClinicalV10 button[onclick*="editTreatmentV10"]')).toHaveCount(0);
 await repeat(page);await expect(page.locator('#procPatient')).toHaveValue('patient-a');await expect(page.locator('#procNurse')).toHaveValue('staff-a');await expect(page.locator('#procedure h1')).toHaveText('Новая процедура');
 expect(await page.evaluate(()=>__repeatGets)).toBe(1);expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

for(const role of ['nurse','admin'])test(role+' repeats complete composition into a fresh draft with current prices, nurse, shift and time',async({page})=>{
 const errors=await boot(page,role);const original=await page.evaluate(()=>JSON.stringify(__repeatSource));await repeat(page);
 await expect(page.locator('#procMeds .medrow')).toHaveCount(2);await expect(page.locator('#procMeds [data-medication-id="med-mg"] .medqty')).toHaveValue('2.5');await expect(page.locator('#procMeds [data-medication-id="med-mg"] .meddose-v24')).toHaveValue('2,5 мг по назначению');
 await expect(page.locator('#procAdditionalServicesV10 .clinical-service-v10')).toHaveCount(2);await expect(page.locator('#procOwnMedsV10 .own-name-v10')).toHaveValue('Свой B12');await expect(page.locator('#procOwnMedsV10 .own-quantity-v10')).toHaveValue('2');await expect(page.locator('#procOwnMedsV10 .own-dose-v24')).toHaveValue('500 мкг');await expect(page.locator('#procOwnMedsV10 .own-source-v10')).toHaveValue('previously_purchased');
 await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('4175.00');await expect(page.locator('#procNotes')).toHaveValue('');await expect(page.locator('#procDiscountComment')).toHaveValue('');await expect(page.locator('#procDiscountReason')).toHaveValue('');await expect(page.locator('#procPayConfirmed')).not.toBeChecked();await expect(page.locator('#procVisitDateV23')).toHaveValue('2026-10-15');await expect(page.locator('#procVisitTimeV23')).toHaveValue('11:25');
 expect(await page.evaluate(()=>CrmClinicalV10.templateState().editing)).toBe(false);expect(await writes(page)).toEqual([]);
 await page.fill('#procMeds [data-medication-id="med-mg"] .medqty','7,5');await page.click('#procSavePendingV14');await expect(page.locator('#workspace')).toBeVisible();
 const saved=(await writes(page))[0];expect(saved.name).toBe('record_treatment_v5');expect(saved.args.p_payload).toMatchObject({shift_id:'shift-current',nurse_id:'staff-a',patient_id:'patient-a',service_id:'service-infusion',arrival_at:'2026-10-15T08:25:00.000Z',services:[{service_id:'service-infusion',quantity:2},{service_id:'service-shot',quantity:3}],items:[{medication_id:'med-mg',quantity:7.5,dose:'2,5 мг по назначению'},{medication_id:'med-vial',quantity:2,dose:'100 мл'}],own_medications:[{name:'Свой B12',quantity:2,unit:'амп.',source:'previously_purchased',dose:'500 мкг'}],charge_total:10675,paid_total:0,payment_status:'pending',notes:null,discount_comment:null,payments:{cash:0,terminal:0,owner_card:0,cash_received:0}});
 for(const key of ['id','expected_version','edit_reason','payment_shift_id'])expect(saved.args.p_payload).not.toHaveProperty(key);
 expect(await page.evaluate(()=>JSON.stringify(__repeatSource))).toBe(original);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

test('the full chronological card repeats from a fresh authorized source and keeps every repeat control out of print',async({page})=>{
 const errors=await boot(page);await page.click('#patientCardOpenV20');await expect(page.locator('#patientMedicalCardBodyV20 [data-card-event]')).toHaveCount(2);
 await expect(page.locator('[data-card-event="old-procedure"] [data-card-repeat-v33]')).toHaveCount(1);await expect(page.locator('[data-card-event="old-sale"] [data-card-repeat-v33]')).toHaveCount(0);
 await page.locator('[data-card-event="old-procedure"] [data-card-repeat-v33]').click();await expect(page.locator('#procedure')).toBeVisible();expect(await page.evaluate(()=>__repeatGets)).toBe(1);await expect(page.locator('#procMeds .medrow')).toHaveCount(2);expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('a mismatched treatment patient is rejected before creating or modifying a draft',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>__repeatSource.patient_id='patient-b');await page.locator('#patientClinicalV10 [data-repeat-procedure-v33]').click();
 await expect(page.locator('#patientCard')).toBeVisible();await expect(page.locator('#patientCardMessageV5')).not.toHaveText('');await expect(page.locator('#procedure')).toBeHidden();expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('late repeat responses cannot replace the patient opened during loading',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__repeatHold=true;void repeatPatientProcedureV33('patient-a','old-procedure')});await page.waitForFunction(()=>typeof __releaseRepeat==='function');
 await page.evaluate(async()=>{await openPatient('patient-b');__releaseRepeat()});await expect(page.locator('#patientCardName')).toHaveText('Борис');await expect(page.locator('#procedure')).toBeHidden();expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('a repeat response from a signed-out user cannot populate the next nurse session',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__repeatHold=true;void repeatPatientProcedureV33('patient-a','old-procedure')});await page.waitForFunction(()=>typeof __releaseRepeat==='function');
  await page.evaluate(async()=>{const knownPatients=structuredClone(patients);await signOut();patients=knownPatients;currentStaff={id:'staff-b',full_name:'Другая медсестра',role:'nurse',active:true};await openPatient('patient-b');message('patientCardMessageV5','Новая сессия');__releaseRepeat()});
 await expect(page.locator('#patientCardName')).toHaveText('Борис');await expect(page.locator('#patientCardMessageV5')).toHaveText('Новая сессия');await expect(page.locator('#procedure')).toBeHidden();expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('an archived medicine and retired service remain visible with a warning and cannot silently disappear from a repeated procedure',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{meds=meds.filter(m=>m.id!=='med-vial');services=services.filter(s=>s.id!=='service-shot')});await repeat(page);
 await expect(page.locator('#procMeds [data-medication-id="med-vial"]')).toContainText('Физраствор');await expect(page.locator('#procAdditionalServicesV10 select')).toHaveCount(2);await expect(page.locator('#procAdditionalServicesV10 select').last()).toHaveValue('service-shot');
 await expect(page.locator('#procedureMessage')).toContainText(/недоступ|архив|замен|проверь/i);await page.click('#procSavePendingV14');await expect(page.locator('#procedure')).toBeVisible();expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('a failed source read never builds a partially repeated draft or writes a procedure',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>__repeatReadError={code:'P0001',message:'История временно недоступна'});await page.locator('#patientClinicalV10 [data-repeat-procedure-v33]').click();
 await expect(page.locator('#patientCardMessageV5')).toContainText('История временно недоступна');await expect(page.locator('#procedure')).toBeHidden();expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('repeating another record cannot replace an unconfirmed save or change its exact retry payload',async({page})=>{
 const errors=await boot(page);await repeat(page);await page.evaluate(()=>__repeatLose=true);await page.click('#procSavePendingV14');await expect(page.locator('#procedureMessage')).toContainText('Черновик сохранён');
 const gets=await page.evaluate(()=>__repeatGets);await page.evaluate(()=>repeatPatientProcedureV33('patient-a','old-procedure'));await expect(page.locator('#procedure')).toBeVisible();expect(await page.evaluate(()=>__repeatGets)).toBe(gets);await expect(page.locator('#procMeds .medqty').first()).toBeDisabled();
 await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();const calls=await page.evaluate(()=>__repeatCalls.filter(call=>call.name==='record_treatment_v5'));expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('repeat cannot overwrite a draft while its save is still in progress',async({page})=>{
 const errors=await boot(page);await repeat(page);const gets=await page.evaluate(()=>__repeatGets);
 await page.evaluate(()=>{clinicalBusy=true});await page.evaluate(()=>repeatPatientProcedureV33('patient-a','old-procedure'));expect(await page.evaluate(()=>__repeatGets)).toBe(gets);await expect(page.locator('#procMeds .medrow')).toHaveCount(2);expect(await writes(page)).toEqual([]);await page.evaluate(()=>clinicalBusy=false);expect(errors).toEqual([]);
});

test('a repeated draft stays inert until preparation finishes and refuses saves or templates while waiting',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__repeatPrepareHold=true;window.__repeatPreparationDone=false;void repeatPatientProcedureV33('patient-a','old-procedure').then(()=>__repeatPreparationDone=true)});
 await page.waitForFunction(()=>typeof __releaseRepeatPreparation==='function');await expect(page.locator('#procedure')).toBeVisible();await expect(page.locator('#procedure')).toHaveAttribute('aria-busy','true');await expect(page.locator('#procedure')).toHaveJSProperty('inert',true);await expect(page.locator('#procMeds .medrow')).toHaveCount(0);
 expect(await page.evaluate(()=>CrmClinicalV10.templateState().locked)).toBe(true);
 expect(await page.evaluate(()=>{try{CrmClinicalV10.applyTemplate({active:true,service_id:'service-infusion',items:[{medication_id:'med-mg',quantity:1,dose:'1 мг'}]});return null}catch(error){return error.message}})).toContain('загрузки');
 await page.evaluate(()=>saveProcedure());expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>__repeatPreparationDone)).toBe(false);await expect(page.locator('#procMeds .medrow')).toHaveCount(0);
 await page.evaluate(()=>__releaseRepeatPreparation());await page.waitForFunction(()=>__repeatPreparationDone);
 await expect(page.locator('#procedure')).toHaveJSProperty('inert',false);await expect(page.locator('#procedure')).not.toHaveAttribute('aria-busy');await expect(page.locator('#procMeds .medrow')).toHaveCount(2);await expect(page.locator('#procAdditionalServicesV10 .clinical-service-v10')).toHaveCount(2);await expect(page.locator('#procOwnMedsV10 .own-name-v10')).toHaveValue('Свой B12');await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('4175.00');expect(await page.evaluate(()=>CrmClinicalV10.templateState().locked)).toBe(false);expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('leaving the patient while a repeated draft prepares prevents late composition and releases its inert lock',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__repeatPrepareHold=true;window.__repeatPreparationDone=false;void repeatPatientProcedureV33('patient-a','old-procedure').then(()=>__repeatPreparationDone=true)});
 await page.waitForFunction(()=>typeof __releaseRepeatPreparation==='function');await expect(page.locator('#procedure')).toHaveJSProperty('inert',true);
 await page.evaluate(()=>openPatient('patient-b'));await expect(page.locator('#patientCardName')).toHaveText('Борис');await page.evaluate(()=>__releaseRepeatPreparation());await page.waitForFunction(()=>__repeatPreparationDone);
 await expect(page.locator('#patientCard')).toBeVisible();await expect(page.locator('#procedure')).toBeHidden();await expect(page.locator('#procedure')).toHaveJSProperty('inert',false);await expect(page.locator('#procedure')).not.toHaveAttribute('aria-busy');await expect(page.locator('#procMeds .medrow')).toHaveCount(0);await expect(page.locator('#procOwnMedsV10 .clinical-own-v10')).toHaveCount(0);await expect(page.locator('#procAdditionalServicesV10 .clinical-service-v10')).toHaveCount(0);expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('the existing last-procedure shortcut fetches the authoritative record and repeats additional services and own medicines',async({page})=>{
 const errors=await boot(page);await page.evaluate(async()=>{__repeatQuickSource={id:'old-procedure',service_id:'service-infusion',service_name:'Капельница',at:__repeatSource.at,items:[]};await openPatient('patient-a')});
 await expect(page.locator('#patientRepeatV5')).toBeVisible();await page.locator('#patientRepeatV5').click();await expect(page.locator('#procedure')).toBeVisible();await expect(page.locator('#procedure')).toHaveJSProperty('inert',false);
 expect(await page.evaluate(()=>__repeatGets)).toBe(1);await expect(page.locator('#procMeds .medrow')).toHaveCount(2);await expect(page.locator('#procAdditionalServicesV10 .clinical-service-v10')).toHaveCount(2);await expect(page.locator('#procOwnMedsV10 .own-name-v10')).toHaveValue('Свой B12');await expect(page.locator('#procOwnMedsV10 .own-dose-v24')).toHaveValue('500 мкг');await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('4175.00');expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});
