const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';

async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);
 await page.evaluate(async role=>{
  currentStaff={id:'visit-owner',full_name:'Администратор',role,active:true};
  window.__visitPatients=[{id:'visit-known',full_name:'Известное посещение',first_visit_at:'2026-10-13T07:25:41.125Z',updated_at:'2026-10-13T12:00:00Z'},{id:'visit-unknown',full_name:'Старая карточка',created_at:'2026-10-13T12:00:00Z',updated_at:'2026-10-13T12:00:00Z'}];
  window.__visitSaveCalls=[];window.__visitWrites=[];window.__visitReceipts=new Map();window.__visitLost=0;window.__visitHold=false;window.__visitPrints=0;window.print=()=>{++__visitPrints};
  db.rpc=async(name,args={})=>{
   if(name==='crm_patient_save_v11'){
    __visitSaveCalls.push(structuredClone(args));let saved=__visitReceipts.get(args.p_request_id);
    if(!saved){
     const payload=structuredClone(args.p_payload);let row=__visitPatients.find(item=>item.id===payload.id);
     if(!row){row={id:'visit-created-'+(__visitWrites.length+1)};__visitPatients.push(row)}
     Object.assign(row,payload);saved={patient:structuredClone(row)};__visitReceipts.set(args.p_request_id,saved);__visitWrites.push(payload);
    }
    if(__visitHold){__visitHold=false;await new Promise(resolve=>window.__releaseVisitSave=resolve)}
    if(__visitLost>0){--__visitLost;throw new TypeError('Load failed')}
    return {data:structuredClone(saved),error:null};
   }
   if(name==='crm_management_v5'&&args.p_action==='patient_list')return {data:structuredClone(__visitPatients),error:null};
   if(name==='patient_history_v8'||name==='crm_clinical_v10')return {data:{procedures:[{id:'visit-procedure',at:'2026-10-13T08:05:00Z',visit_at:'2026-10-13T18:45:00Z',procedure_type:'Капельница',items:[],medications:[],list_total:600,charge_total:600,paid_total:600}],sales:[]},error:null};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[]}:null,error:null};
   return {data:[],error:null};
  };
  await loadPatients();goNewPatient();
 },role);
 await expect(page.locator('#newPatient')).toBeVisible();return errors;
}
const save=page=>page.locator('#newPatient button[onclick="addPatient()"]');
async function enter(page,name='Пациент 10:25'){
 await page.fill('#pname',name);await page.fill('#pVisitDateV23','2026-10-13');await page.fill('#pVisitTimeV23','10:25');
}

test('new patient starts with Moscow time, saves entered 10:25 and seeds only the first procedure',async({page})=>{
 const errors=await boot(page,'nurse');
 const displayed=await page.evaluate(()=>({date:$('pVisitDateV23').value,time:$('pVisitTimeV23').value,now:CrmVisitTimeV23.nowParts()}));
 expect({date:displayed.date,time:displayed.time}).toEqual(displayed.now);
 await enter(page);await save(page).click();await expect(page.locator('#patientCardName')).toHaveText('Пациент 10:25');
 expect(await page.evaluate(()=>__visitWrites[0].first_visit_at)).toBe('2026-10-13T07:25:00.000Z');
 await expect(page.locator('#patientCardInfo')).toContainText('Первое посещение · Москва');await expect(page.locator('#patientCardInfo')).toContainText('10:25');
 expect(await page.evaluate(()=>patientVisitSeedV23('visit-created-1'))).toBe('2026-10-13T07:25:00.000Z');
 await page.evaluate(()=>consumePatientVisitSeedV23('visit-created-1'));expect(await page.evaluate(()=>patientVisitSeedV23('visit-created-1'))).toBeNull();
 expect(await page.evaluate(()=>patientVisitSeedV23('visit-known'))).toBeNull();expect(errors).toEqual([]);
});

test('ambiguous patient save freezes time and retries identical timestamp and UUID despite changed DOM fields',async({page})=>{
 const errors=await boot(page);await enter(page);await page.evaluate(()=>__visitLost=2);await save(page).click();
 await expect(save(page)).toContainText('Повторить');await expect(page.locator('#pVisitDateV23')).toBeDisabled();await expect(page.locator('#pVisitTimeV23')).toBeDisabled();
 await page.evaluate(()=>{show('workspace');goNewPatient()});await expect(page.locator('#pVisitDateV23')).toHaveValue('2026-10-13');await expect(page.locator('#pVisitTimeV23')).toHaveValue('10:25');
 await page.evaluate(()=>{$('pVisitDateV23').value='';$('pVisitTimeV23').value='22:59';$('pname').value=''});await save(page).click();
 await expect(page.locator('#patientCardName')).toHaveText('Пациент 10:25');
 const state=await page.evaluate(()=>({calls:__visitSaveCalls,writes:__visitWrites}));expect(state.calls).toHaveLength(3);expect(state.calls[1]).toEqual(state.calls[0]);expect(state.calls[2]).toEqual(state.calls[0]);expect(state.writes).toHaveLength(1);expect(errors).toEqual([]);
});

test('editing preserves stored seconds, allows changing or clearing visit, and does not seed old patient',async({page})=>{
 const errors=await boot(page);await page.evaluate(async()=>{await openPatient('visit-known');editPatientV5()});
 await expect(page.locator('#pVisitDateV23')).toHaveValue('2026-10-13');await expect(page.locator('#pVisitTimeV23')).toHaveValue('10:25');
 await page.fill('#pnotes','Не изменять время');await save(page).click();await expect(page.locator('#patientCard')).toBeVisible();
 expect(await page.evaluate(()=>__visitWrites[0].first_visit_at)).toBe('2026-10-13T07:25:41.125Z');expect(await page.evaluate(()=>patientVisitSeedV23('visit-known'))).toBeNull();
 await page.evaluate(()=>editPatientV5());await page.fill('#pVisitTimeV23','10:45');await save(page).click();await expect(page.locator('#patientCardInfo')).toContainText('10:45');expect(await page.evaluate(()=>__visitWrites[1].first_visit_at)).toBe('2026-10-13T07:45:00.000Z');
 await page.evaluate(()=>editPatientV5());await page.fill('#pVisitDateV23','');await page.fill('#pVisitTimeV23','');await save(page).click();await expect(page.locator('#patientCard')).toBeVisible();
 expect(await page.evaluate(()=>__visitWrites[2].first_visit_at)).toBeNull();await expect(page.locator('#patientCardInfo')).not.toContainText('Первое посещение');expect(errors).toEqual([]);
});

test('unknown historical time stays blank and one missing field cannot be silently saved',async({page})=>{
 const errors=await boot(page);await page.evaluate(async()=>{await openPatient('visit-unknown');editPatientV5()});
 await expect(page.locator('#pVisitDateV23')).toHaveValue('');await expect(page.locator('#pVisitTimeV23')).toHaveValue('');
 await page.fill('#pVisitTimeV23','10:25');await save(page).click();await expect(page.locator('#patientFormMessageV5')).toContainText(/дат|время/i);expect(await page.evaluate(()=>__visitWrites.length)).toBe(0);
 await page.fill('#pVisitTimeV23','');await save(page).click();await expect(page.locator('#patientCard')).toBeVisible();expect(await page.evaluate(()=>__visitWrites[0].first_visit_at)).toBeNull();expect(errors).toEqual([]);
});

test('patient profile, full card and PDF show entered first visit and actual procedure arrival',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openPatient('visit-known'));
 await expect(page.locator('#patientCardInfo')).toContainText('10:25');await expect(page.locator('#patientHistory')).toContainText('11:05');await expect(page.locator('#patientHistory')).not.toContainText('21:45');
 await page.click('#patientCardOpenV20');await expect(page.locator('#patientMedicalCardBodyV20')).toContainText('Первое посещение · Москва');await expect(page.locator('#patientMedicalCardBodyV20')).toContainText('10:25');await expect(page.locator('#patientMedicalCardBodyV20')).toContainText('11:05');
 await page.click('#patientMedicalCardPrintV20');await expect(page.locator('#patientCardPrintV20')).toContainText('10:25');await expect(page.locator('#patientCardPrintV20')).toContainText('11:05');expect(await page.evaluate(()=>__visitPrints)).toBe(1);
 await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.evaluate(()=>openPatient('visit-unknown'));await page.click('#patientCardPrintButtonV20');await expect(page.locator('#patientCardPrintV20')).not.toContainText('Первое посещение');expect(errors).toEqual([]);
});

test('confirmed late patient save seeds once and recovering card cannot recreate consumed seed',async({page})=>{
 const errors=await boot(page);await enter(page);await page.evaluate(()=>{__visitHold=true;void addPatient()});await page.waitForFunction(()=>typeof __releaseVisitSave==='function');
 await page.evaluate(()=>show('workspace'));await page.evaluate(()=>__releaseVisitSave());await expect(save(page)).toBeEnabled();await expect(page.locator('#workspace')).toBeVisible();
 expect(await page.evaluate(()=>patientVisitSeedV23('visit-created-1'))).toBe('2026-10-13T07:25:00.000Z');await page.evaluate(()=>consumePatientVisitSeedV23('visit-created-1'));
 await page.evaluate(()=>goNewPatient());await expect(save(page)).toContainText('Открыть');await save(page).click();await expect(page.locator('#patientCardName')).toHaveText('Пациент 10:25');
 expect(await page.evaluate(()=>patientVisitSeedV23('visit-created-1'))).toBeNull();expect(await page.evaluate(()=>__visitWrites.length)).toBe(1);expect(errors).toEqual([]);
});

test('actor change or sign-out clears new-patient visit seeds and late responses cannot seed another account',async({page})=>{
 const errors=await boot(page);await enter(page);await save(page).click();await expect(page.locator('#patientCard')).toBeVisible();
 await page.evaluate(()=>{currentStaff={id:'other-nurse',role:'nurse',active:true}});expect(await page.evaluate(()=>patientVisitSeedV23('visit-created-1'))).toBeNull();
 await page.evaluate(async()=>{await signOut();currentStaff={id:'visit-owner',role:'admin',active:true};goNewPatient()});expect(await page.evaluate(()=>patientVisitSeedV23('visit-created-1'))).toBeNull();
 await enter(page,'Ожидающая запись');await page.evaluate(()=>{__visitHold=true;void addPatient()});await page.waitForFunction(()=>typeof __releaseVisitSave==='function');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'other-nurse',role:'nurse',active:true};goNewPatient();$('pname').value='Следующий пациент';__releaseVisitSave()});
 await expect(page.locator('#pname')).toHaveValue('Следующий пациент');await expect(save(page)).toBeEnabled();expect(await page.evaluate(()=>patientVisitSeedV23('visit-created-2'))).toBeNull();expect(errors).toEqual([]);
});
