const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'});

async function boot(page,role='nurse'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-13T07:33:27Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  const actor={id:role==='admin'?'admin-1':'nurse-1',full_name:role==='admin'?'Аниса':'Марья',role,active:true};
  const staff=[{id:'nurse-1',full_name:'Марья'},{id:'nurse-2',full_name:'Азиза'}],opened={id:'shift-1',date:'2026-10-13',started_at:'2026-10-13T05:30:00Z',planned_end_at:'2026-10-13T13:00:00Z',status:'open',staff};
  const clone=value=>JSON.parse(JSON.stringify(value));
  patients=[{id:'patient-1',full_name:'Анна',sex:'female'},{id:'patient-2',full_name:'Борис',sex:'male'}];nurses=staff;
  meds=[{id:'med-1',name:'Витамин C',consumption_unit:'амп.',sale_price:100,work_qty:0,active:true}];
  services=[{id:'service-1',name:'Капельница',work_price:100,consumables_price:50,active:true}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:0,units_per_package:5,purchase_price:0}));
  window.__visitCalls=[];window.__visitWrites=[];window.__visitRecords=new Map();window.__visitReplay=new Map();window.__visitLose=false;
  window.__visitSeeds=new Map();window.__visitConsumed=[];
  window.patientVisitSeedV23=id=>__visitSeeds.get(id)||null;
  window.consumePatientVisitSeedV23=id=>{__visitSeeds.delete(id);__visitConsumed.push(id)};
  window.__visitSeed={id:'procedure-1',kind:'procedure',editable:true,version:3,shift_id:'past-shift',patient_id:'patient-1',patient:'Анна',nurse_id:'nurse-1',nurse:'Марья',service_id:'service-1',procedure_type:'Капельница',arrival_at:'2026-10-12T06:22:43.123Z',at:'2026-10-12T06:22:43.123Z',visit_at:'2026-10-13T07:33:27.456Z',recorded_at:'2026-10-13T07:33:27.456Z',list_total:150,charge_total:150,paid_total:0,received_total:0,initial_paid_total:0,debt_total:150,payment_pending:true,payment_status:'pending',stock_deducted:false,services:[{service_id:'service-1',name:'Капельница',quantity:1,unit_price:150,work_price:100,consumables_price:50,line_total:150}],items:[],own_medications:[],payments:{cash:0,terminal:0,owner_card:0},notes:'Первоначальная запись'};
  function recordFrom(payload,previous,kind='procedure'){
   const recorded=previous?.recorded_at||'2026-10-13T07:33:27.456Z',arrival=Object.hasOwn(payload,'arrival_at')?payload.arrival_at:previous?.arrival_at||recorded;
   const pricedServices=(payload.services||[]).map(item=>({...item,name:'Капельница',unit_price:150,work_price:100,consumables_price:50,line_total:150*item.quantity}));
   const items=(payload.items||[]).map(item=>({...item,name:'Витамин C',unit:'амп.',unit_price:100,line_total:100*item.quantity}));
   return {...clone(__visitSeed),...previous,...payload,id:previous?.id||kind+'-'+(__visitRecords.size+1),kind,editable:true,version:previous?previous.version+1:1,arrival_at:arrival,at:arrival,visit_at:previous?.visit_at||recorded,recorded_at:recorded,services:pricedServices,items,list_total:[...pricedServices,...items].reduce((sum,item)=>sum+item.line_total,0),paid_total:(previous?.paid_total||0)+payload.paid_total,received_total:(previous?.paid_total||0)+payload.paid_total,debt_total:payload.charge_total-(previous?.paid_total||0)-payload.paid_total,payment_pending:payload.payment_status==='pending'};
  }
  db.from=()=>{const query={select(){return query},eq(){return query},order(){return query},maybeSingle:async()=>({data:actor})};return query};
  db.rpc=async(name,args={})=>{
   __visitCalls.push({name,args:clone(args)});
   if(name==='record_treatment_v5'||name==='crm_payment_correction_v22'||(name==='crm_clinical_v10'&&args.p_action==='treatment_edit')){
    if(__visitReplay.has(args.p_request_id))return {data:clone(__visitReplay.get(args.p_request_id))};
    const payload=args.p_payload,kind=args.p_kind||payload.kind||'procedure',prior=payload.id?__visitRecords.get(payload.id):null,record=recordFrom(payload,prior,kind);
    if(name==='crm_payment_correction_v22')Object.assign(record,{paid_total:0,received_total:0,initial_paid_total:0,debt_total:payload.charge_total});
    __visitRecords.set(record.id,record);__visitWrites.push({name,args:clone(args)});__visitReplay.set(args.p_request_id,clone(record));
    if(__visitLose){__visitLose=false;throw new TypeError('Load failed')}
    return {data:clone(record)};
   }
   if(name==='crm_clinical_v10'){
    if(args.p_action==='treatment_get')return {data:clone(__visitRecords.get(args.p_payload.id))};
    if(args.p_action==='patient_treatments')return {data:{procedures:clone([...__visitRecords.values()]),sales:[]}};
    return {data:[]};
   }
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[{shift:opened,staff,procedures:clone([...__visitRecords.values()].filter(record=>record.kind==='procedure')),sales:clone([...__visitRecords.values()].filter(record=>record.kind==='sale'))}]}};
   if(name==='crm_finance_v5')return {data:args.p_action==='accounting_mode'?{payment_only:true,stock_deducted:false}:{shift:opened,staff,procedures:[],sales:[],receipts:[],revenue:{cash:0,terminal:0,owner_card:0,total:0}}};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};
   if(name.includes('warehouse'))return {data:inventory};return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'mock-auth'});shift={id:'shift-1',aId:'nurse-1',a:'Марья',bId:'nurse-2',b:'Азиза',type:'08:30–16:00'};show('workspace');
 },role);
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
async function procedure(page,patient='patient-1'){await page.evaluate(patient=>openProcedure(patient),patient);await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procService','service-1')}
async function seedEdit(page,overrides={}){await page.evaluate(overrides=>{__visitRecords.set('procedure-1',{...__visitSeed,...overrides});return editTreatmentV10('procedure','procedure-1')},overrides);await expect(page.locator('#procedure')).toBeVisible()}
const writes=page=>page.evaluate(()=>__visitWrites);

for(const timezoneId of ['UTC','America/Los_Angeles'])test.describe('Visit form in '+timezoneId,()=>{
 test.use({timezoneId});
 test('manual 10:25 arrival is stored separately from accounting time and displayed in the journal',async({page})=>{
  const errors=await boot(page);await procedure(page);
  await expect(page.locator('#procVisitDateV23')).toHaveValue('2026-10-13');await expect(page.locator('#procVisitTimeV23')).toHaveValue('10:33');
  await expect(page.locator('.clinical-visit-time-v23').first()).toContainText('Москва (UTC+3)');
  await page.fill('#procVisitTimeV23','10:25');await page.click('#procSavePendingV14');await expect(page.locator('#workspace')).toBeVisible();
  expect((await writes(page))[0].args.p_payload).toMatchObject({arrival_at:'2026-10-13T07:25:00.000Z',shift_id:'shift-1',payment_status:'pending',paid_total:0});
  expect(await page.evaluate(()=>__visitRecords.get('procedure-1'))).toMatchObject({at:'2026-10-13T07:25:00.000Z',recorded_at:'2026-10-13T07:33:27.456Z',visit_at:'2026-10-13T07:33:27.456Z'});
  await page.evaluate(()=>openShiftJournalV12('2026-10-13'));await expect(page.locator('#journalBodyV12 .journal-event-v12')).toContainText('10:25');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
 });
});

test('an unchanged old visit preserves its seconds and original financial shift',async({page})=>{
 const errors=await boot(page);await seedEdit(page);await expect(page.locator('#procVisitDateV23')).toHaveValue('2026-10-12');await expect(page.locator('#procVisitTimeV23')).toHaveValue('09:22');
 await page.fill('#procNotes','Уточнена процедура');await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();
 const payload=(await writes(page))[0].args.p_payload;expect(payload).not.toHaveProperty('arrival_at');expect(payload).toMatchObject({shift_id:'past-shift',expected_version:3,edit_reason:null});
 expect(await page.evaluate(()=>__visitRecords.get('procedure-1'))).toMatchObject({arrival_at:'2026-10-12T06:22:43.123Z',recorded_at:'2026-10-13T07:33:27.456Z',visit_at:'2026-10-13T07:33:27.456Z'});expect(errors).toEqual([]);
});
test('editing the exact arrival changes its Moscow date and minute while accounting time stays original',async({page})=>{
 const errors=await boot(page);await seedEdit(page);await page.fill('#procVisitDateV23','2026-10-11');await page.fill('#procVisitTimeV23','10:25');await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args.p_payload).toMatchObject({arrival_at:'2026-10-11T07:25:00.000Z',shift_id:'past-shift',paid_total:0,payment_status:'pending'});
 expect(await page.evaluate(()=>__visitRecords.get('procedure-1'))).toMatchObject({at:'2026-10-11T07:25:00.000Z',visit_at:'2026-10-13T07:33:27.456Z'});expect(errors).toEqual([]);
});
test('an ambiguous save freezes the exact arrival and receipt UUID despite subsequent DOM changes',async({page})=>{
 const errors=await boot(page);await procedure(page);await page.fill('#procVisitTimeV23','10:25');await page.evaluate(()=>{__visitLose=true});await page.click('#procSavePendingV14');await expect(page.locator('#procedureMessage')).toContainText('Черновик сохранён');await expect(page.locator('#procVisitTimeV23')).toBeDisabled();
 await page.evaluate(()=>{document.getElementById('procVisitDateV23').value='2026-10-12';document.getElementById('procVisitTimeV23').value='23:59'});await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();
 const attempts=await page.evaluate(()=>__visitCalls.filter(call=>call.name==='record_treatment_v5'));expect(attempts).toHaveLength(2);expect(attempts[1].args).toEqual(attempts[0].args);expect(attempts[1].args.p_payload.arrival_at).toBe('2026-10-13T07:25:00.000Z');expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});
test('changing patient adopts a pending registration arrival until manually edited, then consumes it once',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>__visitSeeds.set('patient-2','2026-10-13T06:40:00Z'));await procedure(page);await page.selectOption('#procPatient','patient-2');await expect(page.locator('#procVisitTimeV23')).toHaveValue('09:40');
 await page.fill('#procVisitTimeV23','10:25');await page.selectOption('#procPatient','patient-1');await expect(page.locator('#procVisitTimeV23')).toHaveValue('10:25');await page.selectOption('#procPatient','patient-2');await expect(page.locator('#procVisitTimeV23')).toHaveValue('10:25');
 await page.click('#procSavePendingV14');await expect(page.locator('#workspace')).toBeVisible();expect(await page.evaluate(()=>__visitConsumed)).toEqual(['patient-2']);
 await page.clock.setFixedTime(new Date('2026-10-13T08:01:00Z'));await procedure(page,'patient-2');await expect(page.locator('#procVisitTimeV23')).toHaveValue('11:01');expect(errors).toEqual([]);
});
test('a fresh procedure after cancelling an old edit uses current Moscow time',async({page})=>{
 const errors=await boot(page);await seedEdit(page);await page.evaluate(()=>show('workspace'));await procedure(page,'patient-2');await expect(page.locator('#procVisitDateV23')).toHaveValue('2026-10-13');await expect(page.locator('#procVisitTimeV23')).toHaveValue('10:33');await expect(page.locator('#procPatient')).toHaveValue('patient-2');expect(errors).toEqual([]);
});
test('a sale has its own exact visit input and accepts zero payment without consuming registration seed',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>__visitSeeds.set('patient-1','2026-10-13T06:40:00Z'));await page.evaluate(()=>openSale());await expect(page.locator('#sale')).toBeVisible();await page.selectOption('#salePatient','patient-1');await expect(page.locator('#saleVisitTimeV23')).toHaveValue('09:40');await page.fill('#saleVisitTimeV23','10:25');await page.evaluate(()=>chooseMedication('saleMeds','med-1'));await page.click('#saleSavePendingV14');await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args).toMatchObject({p_kind:'sale',p_payload:{arrival_at:'2026-10-13T07:25:00.000Z',patient_id:'patient-1',paid_total:0,payment_status:'pending'}});expect(await page.evaluate(()=>__visitConsumed)).toEqual([]);expect(errors).toEqual([]);
});
test('missing visit time blocks saving before any patient or financial write',async({page})=>{
 const errors=await boot(page);await procedure(page);await page.fill('#procVisitTimeV23','');await page.click('#procSavePendingV14');await expect(page.locator('#procedureMessage')).toContainText('Укажите точное время посещения');expect(await writes(page)).toEqual([]);await expect(page.locator('#procVisitTimeV23')).toBeEnabled();expect(errors).toEqual([]);
});
test('correcting phantom payment can also retain a manually corrected actual visit',async({page})=>{
 const errors=await boot(page,'admin');await seedEdit(page,{paid_total:150,received_total:150,initial_paid_total:150,debt_total:0,payment_pending:false,payment_status:'paid'});await page.fill('#procVisitTimeV23','10:25');await page.check('#procPaymentCorrectionV22');await page.check('#procPayConfirmed');await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0]).toMatchObject({name:'crm_payment_correction_v22',args:{p_payload:{arrival_at:'2026-10-12T07:25:00.000Z',confirm_no_money_received:true,charge_total:150,paid_total:0,payment_status:'debt',shift_id:'past-shift'}}});expect(errors).toEqual([]);
});
