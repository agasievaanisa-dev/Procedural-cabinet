const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Fictional patients and prices only. The catalog is separate from the loaded
// client cache, as when an administrator changes a price in another tab.
async function boot(page,role='nurse'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-11T07:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  const actor={id:role==='owner'?'owner-1':'nurse-1',full_name:role==='owner'?'Аниса':'Наталья',role,active:true};
  const staff=[{id:'nurse-1',full_name:'Наталья'},{id:'nurse-2',full_name:'Лилия'}],opened={id:'shift-1',date:'2026-10-11',started_at:'2026-10-11T05:30:00Z',planned_end_at:'2026-10-11T13:00:00Z',status:'open',staff};
  const clone=value=>JSON.parse(JSON.stringify(value));
  patients=[{id:'patient-1',full_name:'Анна',sex:'female'},{id:'patient-2',full_name:'Борис',sex:'male'}];nurses=staff;
  meds=[{id:'med-1',name:'Самыр 400 мг',consumption_unit:'компл.',sale_price:20,work_qty:0,active:true},{id:'med-2',name:'Витамин C 1000 мг',consumption_unit:'амп.',sale_price:10,work_qty:0,active:true}];
  services=[{id:'service-1',name:'Капельница',work_price:100,consumables_price:50,active:true}];inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:0,units_per_package:5,purchase_price:0}));
  window.__currentCatalog=clone(meds);window.__pendingCalls=[];window.__pendingWrites=[];window.__pendingRecords=new Map();window.__pendingReplay=new Map();window.__pendingReceipts=[];
  window.__pendingSeed={id:'procedure-1',kind:'procedure',editable:true,version:3,shift_id:'shift-1',patient_id:'patient-1',patient:'Анна',nurse_id:'nurse-1',nurse:'Наталья',service_id:'service-1',procedure_type:'Капельница',visit_at:'2026-10-11T07:00:00Z',at:'2026-10-11T07:00:00Z',list_total:190,charge_total:190,paid_total:0,received_total:0,debt_total:190,payment_pending:true,payment_status:'pending',stock_deducted:false,services:[{service_id:'service-1',name:'Капельница',quantity:1,unit_price:150,work_price:100,consumables_price:50,line_total:150}],items:[{medication_id:'med-1',name:'Самыр 400 мг',quantity:2,unit:'компл.',unit_price:20,line_total:40}],own_medications:[],payments:{cash:0,terminal:0,owner_card:0},notes:'Первоначальная запись'};
  function report(){
   const records=[...__pendingRecords.values()],revenue={cash:0,terminal:0,owner_card:0,total:0};
   records.forEach(record=>{for(const method of ['cash','terminal','owner_card'])revenue[method]+=record.payments?.[method]||0});revenue.total=revenue.cash+revenue.terminal+revenue.owner_card;
   return {shift:opened,staff,patients_count:new Set(records.map(record=>record.patient_id)).size,procedures_count:records.length,sales_count:0,procedures:clone(records),sales:[],receipts:clone(__pendingReceipts),revenue,charge_total:records.reduce((sum,record)=>sum+record.charge_total,0),debt_total:records.reduce((sum,record)=>sum+record.debt_total,0),used:[],stock:[],untracked:[],warnings:[]};
  }
  function recordFrom(payload,previous){
   const capturedServices=(payload.services||[]).map(item=>{
    const prior=previous?.services.find(service=>service.service_id===item.service_id),current=services.find(service=>service.id===item.service_id),price=prior?.unit_price??((current?.work_price||0)+(current?.consumables_price||0));
    return {...(prior||{}),service_id:item.service_id,name:prior?.name||current?.name,quantity:item.quantity,unit_price:price,line_total:price*item.quantity};
   });
   const capturedItems=(payload.items||[]).map(item=>{
    const prior=previous?.items.find(med=>med.medication_id===item.medication_id),current=__currentCatalog.find(med=>med.id===item.medication_id),price=item.refresh_price===true?current?.sale_price:prior?.unit_price??current?.sale_price;
    return {medication_id:item.medication_id,name:prior?.name||current?.name,unit:prior?.unit||current?.consumption_unit,quantity:item.quantity,unit_price:price,line_total:price*item.quantity};
   });
   const paid=(previous?.paid_total||0)+payload.paid_total,payments={...(previous?.payments||{cash:0,terminal:0,owner_card:0})};for(const method of ['cash','terminal','owner_card'])payments[method]=(payments[method]||0)+(payload.payments?.[method]||0);
   return {id:previous?.id||'procedure-'+(__pendingRecords.size+1),kind:previous?.kind||'procedure',editable:true,version:previous?previous.version+1:1,shift_id:payload.shift_id,patient_id:payload.patient_id,patient:patients.find(patient=>patient.id===payload.patient_id)?.full_name,nurse_id:payload.nurse_id,nurse:staff.find(nurse=>nurse.id===payload.nurse_id)?.full_name,service_id:payload.service_id,procedure_type:capturedServices[0]?.name,at:previous?.at||'2026-10-11T07:'+String(__pendingRecords.size).padStart(2,'0')+':00Z',visit_at:previous?.visit_at||'2026-10-11T07:00:00Z',services:capturedServices,items:capturedItems,own_medications:payload.own_medications||[],list_total:[...capturedServices,...capturedItems].reduce((sum,item)=>sum+item.line_total,0),charge_total:payload.charge_total,paid_total:paid,received_total:paid,debt_total:payload.charge_total-paid,payment_pending:payload.payment_status==='pending',payment_status:payload.payment_status,stock_deducted:false,payments,discount_reason:payload.discount_reason,discount_comment:payload.discount_comment,notes:payload.notes};
  }
  db.from=()=>{const query={select(){return query},eq(){return query},order(){return query},maybeSingle:async()=>({data:actor})};return query};
  db.rpc=async(name,args={})=>{
   __pendingCalls.push({name,args:clone(args)});
   if(name==='record_treatment_v5'){
    if(__pendingReplay.has(args.p_request_id))return {data:clone(__pendingReplay.get(args.p_request_id))};
    const record=recordFrom(args.p_payload);__pendingRecords.set(record.id,record);__pendingWrites.push({name,args:clone(args)});__pendingReplay.set(args.p_request_id,clone(record));return {data:clone(record)};
   }
   if(name==='crm_clinical_v10'){
    const payload=args.p_payload||{},record=__pendingRecords.get(payload.id);
    if(args.p_action==='treatment_get')return {data:clone(record)};
    if(args.p_action==='patient_treatments')return {data:{procedures:clone([...__pendingRecords.values()].filter(item=>item.patient_id===payload.patient_id)),sales:[]}};
    if(args.p_action==='debts')return {data:{debts:clone([...__pendingRecords.values()].filter(item=>item.debt_total>0&&!item.payment_pending))}};
    if(__pendingReplay.has(args.p_request_id))return {data:clone(__pendingReplay.get(args.p_request_id))};
    if(args.p_action==='treatment_edit'){
     if(!record||payload.expected_version!==record.version)return {error:{code:'P0001',message:'Запись уже изменена'}};
     if((payload.items||[]).some(item=>item.refresh_price===true&&item.expected_catalog_price!==__currentCatalog.find(m=>m.id===item.medication_id)?.sale_price))return {error:{code:'P0001',message:'Цена в прайсе изменилась. Обновите цену препарата'}};
     const updated=recordFrom(payload,record);__pendingRecords.set(record.id,updated);__pendingWrites.push({name,args:clone(args)});__pendingReplay.set(args.p_request_id,clone(updated));if(window.__failAfterWriteV48){window.__failAfterWriteV48=false;throw TypeError('Load failed')}return {data:clone(updated)};
    }
    if(args.p_action==='debt_payment'){
     const payment=payload.payments,total=payment.cash+payment.terminal+payment.owner_card;
     if(!record||total<=0||total>record.debt_total)return {error:{code:'P0001',message:'Проверьте сумму оплаты'}};
     record.paid_total+=total;record.received_total=record.paid_total;record.debt_total=record.charge_total-record.paid_total;record.payment_pending=false;record.payment_status=record.debt_total?'debt':'paid';record.version++;
     for(const method of ['cash','terminal','owner_card'])record.payments[method]=(record.payments[method]||0)+payment[method];
     const receipt={id:'receipt-'+(__pendingReceipts.length+1),paid_total:total,debt_total:record.debt_total,payments:payment,shift_id:payload.shift_id,nurse_id:payload.nurse_id};__pendingReceipts.push(receipt);__pendingWrites.push({name,args:clone(args)});__pendingReplay.set(args.p_request_id,clone(receipt));return {data:clone(receipt)};
    }
   }
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[report()]}};
   if(name==='crm_finance_v5')return {data:args.p_action==='accounting_mode'?{payment_only:true,stock_deducted:false}:report()};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2'){if(window.__catalogPauseV48)await window.__catalogPauseV48;return window.__catalogErrorV48?{error:{code:'P0001',message:'Прайс временно недоступен'}}:{data:clone(__currentCatalog)}};
   if(name==='patient_history_v8')return {data:{procedures:clone([...__pendingRecords.values()].filter(item=>item.patient_id===args.p_patient_id)),sales:[]}};
   if(name.includes('warehouse'))return {data:inventory};return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'mock-auth'});shift={id:'shift-1',aId:'nurse-1',a:'Наталья',bId:'nurse-2',b:'Лилия',type:'08:30–16:00'};show('workspace');
 },role);
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
async function procedure(page,patient='patient-1',medicine=true){
 await page.evaluate(patient=>openProcedure(patient),patient);await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procService','service-1');
 if(medicine){await page.evaluate(()=>chooseMedication('procMeds','med-1'));await page.fill('#procMeds .medqty','2')}
 await expect(page.locator('#procPaid')).toHaveValue(medicine?'190.00':'150.00');
}
const writes=page=>page.evaluate(()=>__pendingWrites);
const journalEntry=(page,id)=>page.locator('#journalBodyV12 .journal-event-v12[data-event-id="'+id+'"]');
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)}


async function seed(page,{discount=false,kind='procedure'}={}){
 await page.evaluate(({discount,kind})=>{
  Object.assign(meds[0],{name:'Образец препарата',consumption_unit:'амп.',sale_price:1});
  __currentCatalog=JSON.parse(JSON.stringify(meds));__currentCatalog[0].sale_price=1000;
  const record=JSON.parse(JSON.stringify(__pendingSeed));
  Object.assign(record,{kind,list_total:kind==='sale'?1:151,charge_total:discount?100:kind==='sale'?1:151,debt_total:discount?100:kind==='sale'?1:151,items:[{medication_id:'med-1',name:'Образец препарата',quantity:1,unit:'амп.',unit_price:1,line_total:1}]});
  if(kind==='sale')record.services=[];
  if(discount)Object.assign(record,{discount_reason:'Индивидуальная стоимость',discount_comment:'Согласованная сумма'});
  __pendingRecords.set(record.id,record);
  return editTreatmentV10(kind,record.id);
 },{discount,kind});
 await expect(page.locator(kind==='sale'?'#sale':'#procedure')).toBeVisible();
}
const medRow=page=>page.locator('#procMeds .medrow[data-medication-id="med-1"]');
for(const role of ['nurse','owner']){
 test(`${role}: an unchanged historical line retains its captured price`,async({page})=>{
  const errors=await boot(page,role);await seed(page);
  await expect(medRow(page).locator('.medication-price-v31')).toContainText(/Цена:\s*1\s*₽/);
  await expect(page.locator('#procPaid')).toHaveValue('151.00');
  await page.locator('#procedure button[onclick="saveProcedure()"]') .click();await expect(page.locator('#workspace')).toBeVisible();
  const saved=(await writes(page))[0].args.p_payload;expect(saved.items[0].refresh_price).toBeUndefined();expect(saved.charge_total).toBe(151);
  expect(await page.evaluate(()=>__pendingRecords.get('procedure-1').items[0].unit_price)).toBe(1);expect(errors).toEqual([]);
 });
 test(`${role}: removing and readding a saved medicine fetches the corrected catalog price`,async({page})=>{
  const errors=await boot(page,role);await seed(page);
  await medRow(page).locator('button.danger').click();await expect(page.locator('#procPaid')).toHaveValue('150.00');
  await page.evaluate(()=>chooseMedication('procMeds','med-1'));
  await expect(medRow(page).locator('.medication-price-v31')).toContainText(/Цена:\s*1\s*000\s*₽/);
  await expect(page.locator('#procPaid')).toHaveValue('1150.00');
  await page.locator('#procedure button[onclick="saveProcedure()"]') .click();await expect(page.locator('#workspace')).toBeVisible();
  const saved=(await writes(page))[0].args.p_payload;expect(saved).toMatchObject({charge_total:1150,paid_total:0,payment_status:'pending',items:[{medication_id:'med-1',quantity:1,refresh_price:true,expected_catalog_price:1000}]});
  expect(await page.evaluate(()=>__pendingRecords.get('procedure-1').items[0].unit_price)).toBe(1000);expect(errors).toEqual([]);
 });
}
test('explicit refresh updates only its historical line and keeps the individual agreed charge',async({page})=>{
 const errors=await boot(page,'owner');await seed(page,{discount:true});
 await medRow(page).locator('.medication-refresh-v48').click();await expect(medRow(page).locator('.medication-price-v31')).toContainText(/1\s*000\s*₽/);
 await expect(page.locator('#procPaid')).toHaveValue('100.00');await expect(page.locator('#procedureMessage')).toContainText('Индивидуальная стоимость для пациента не изменена');
 await page.locator('#procedure button[onclick="saveProcedure()"]') .click();await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args.p_payload).toMatchObject({charge_total:100,paid_total:0,discount_comment:'Согласованная сумма',items:[{refresh_price:true,expected_catalog_price:1000}]});expect(errors).toEqual([]);
});
test('a failed catalog refresh leaves the old line and charge intact and can be retried',async({page})=>{
 const errors=await boot(page);await seed(page);await page.evaluate(()=>{__catalogErrorV48=true});
 await medRow(page).locator('.medication-refresh-v48').click();await expect(page.locator('#procedureMessage')).toContainText('Прайс временно недоступен');
 await expect(page.locator('#procPaid')).toHaveValue('151.00');await expect(medRow(page).locator('.medication-price-v31')).toContainText(/Цена:\s*1\s*₽/);expect(await writes(page)).toHaveLength(0);
 await page.evaluate(()=>{__catalogErrorV48=false});await medRow(page).locator('.medication-refresh-v48').click();await expect(page.locator('#procPaid')).toHaveValue('1150.00');expect(errors).toEqual([]);
});
test('an uncertain save replays the exact refreshed price without a second write',async({page})=>{
 const errors=await boot(page);await seed(page);await medRow(page).locator('.medication-refresh-v48').click();await expect(page.locator('#procPaid')).toHaveValue('1150.00');
 await page.evaluate(()=>{__failAfterWriteV48=true});await page.locator('#procedure button[onclick="saveProcedure()"]') .click();await expect(page.locator('#procedureMessage')).toContainText('Черновик сохранён');
 expect(await writes(page)).toHaveLength(1);await expect(medRow(page).locator('.medication-refresh-v48')).toBeDisabled();
 await page.evaluate(()=>{__currentCatalog[0].sale_price=2000});await page.locator('#procedure button[onclick="saveProcedure()"]') .click();await expect(page.locator('#workspace')).toBeVisible();
 const attempts=await page.evaluate(()=>__pendingCalls.filter(call=>call.name==='crm_clinical_v10'&&call.args.p_action==='treatment_edit'));
 expect(attempts).toHaveLength(2);expect(attempts[1].args).toEqual(attempts[0].args);expect(await writes(page)).toHaveLength(1);
 expect(await page.evaluate(()=>__pendingRecords.get('procedure-1').items[0].unit_price)).toBe(1000);expect(errors).toEqual([]);
});
test('navigation during catalog refresh does not change the abandoned form or loaded catalog',async({page})=>{
 const errors=await boot(page);await seed(page);await page.evaluate(()=>{__catalogPauseV48=new Promise(resolve=>{window.__releaseCatalogV48=resolve})});
 await medRow(page).locator('.medication-refresh-v48').click();await page.evaluate(()=>{beginQuickNavigation4();show('workspace');__releaseCatalogV48()});
 await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#procPaid')).toHaveValue('151.00');
 expect(await page.evaluate(()=>meds[0].sale_price)).toBe(1);expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});
test('a sale uses the same explicit refresh and persists the corrected unit price',async({page})=>{
 const errors=await boot(page,'owner');await seed(page,{kind:'sale'});
 await page.locator('#saleMeds .medication-refresh-v48').click();await expect(page.locator('#salePaid')).toHaveValue('1000.00');
 await page.locator('#sale button[onclick="saveSale()"]') .click();await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args.p_payload).toMatchObject({kind:'sale',charge_total:1000,paid_total:0,items:[{refresh_price:true,expected_catalog_price:1000}]});expect(errors).toEqual([]);
});
test('save waits for the current catalog fetch rather than submitting the old price',async({page})=>{
 const errors=await boot(page);await seed(page);await page.evaluate(()=>{__catalogPauseV48=new Promise(resolve=>{window.__releaseCatalogV48=resolve})});
 await medRow(page).locator('.medication-refresh-v48').click();await page.locator('#procedure button[onclick="saveProcedure()"]') .click();
 await expect(page.locator('#procedureMessage')).toContainText('Дождитесь загрузки актуальной цены');expect(await writes(page)).toHaveLength(0);
 await page.evaluate(()=>__releaseCatalogV48());await expect(page.locator('#procPaid')).toHaveValue('1150.00');
 await page.locator('#procedure button[onclick="saveProcedure()"]') .click();await expect(page.locator('#workspace')).toBeVisible();expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});
test('refreshing an already paid line does not choose a new payment method or collect money',async({page})=>{
 const errors=await boot(page,'owner');await seed(page);
 await page.evaluate(()=>{const record=__pendingRecords.get('procedure-1');Object.assign(record,{paid_total:151,received_total:151,debt_total:0,payment_pending:false,payment_status:'paid',payments:{cash:151,terminal:0,owner_card:0}});return editTreatmentV10('procedure',record.id)});
 await medRow(page).locator('.medication-refresh-v48').click();await expect(page.locator('#procPaid')).toHaveValue('1150.00');await expect(page.locator('#procPayConfirmed')).not.toBeChecked();
 await page.locator('#procedure button[onclick="saveProcedure()"]') .click();await expect(page.locator('#procedureMessage')).toContainText('Выберите способ оплаты');expect(await writes(page)).toHaveLength(0);
 expect(await page.evaluate(()=>__pendingRecords.get('procedure-1').paid_total)).toBe(151);expect(errors).toEqual([]);
});
