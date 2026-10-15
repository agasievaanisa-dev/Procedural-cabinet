const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Persist complete record snapshots and separate receipts. This catches saving
// a different patient over the first record, re-billing captured prices, and
// counting an unpaid visit or an edit as cash collected.
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
  window.__pendingCalls=[];window.__pendingWrites=[];window.__pendingRecords=new Map();window.__pendingReplay=new Map();window.__pendingReceipts=[];
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
    const prior=previous?.items.find(med=>med.medication_id===item.medication_id),current=meds.find(med=>med.id===item.medication_id),price=prior?.unit_price??current?.sale_price;
    return {medication_id:item.medication_id,name:prior?.name||current?.name,unit:prior?.unit||current?.consumption_unit,quantity:item.quantity,unit_price:price,line_total:price*item.quantity};
   });
   const paid=(previous?.paid_total||0)+payload.paid_total,payments={...(previous?.payments||{cash:0,terminal:0,owner_card:0})};for(const method of ['cash','terminal','owner_card'])payments[method]=(payments[method]||0)+(payload.payments?.[method]||0);
   return {id:previous?.id||'procedure-'+(__pendingRecords.size+1),kind:'procedure',editable:true,version:previous?previous.version+1:1,shift_id:payload.shift_id,patient_id:payload.patient_id,patient:patients.find(patient=>patient.id===payload.patient_id)?.full_name,nurse_id:payload.nurse_id,nurse:staff.find(nurse=>nurse.id===payload.nurse_id)?.full_name,service_id:payload.service_id,procedure_type:capturedServices[0]?.name,at:previous?.at||'2026-10-11T07:'+String(__pendingRecords.size).padStart(2,'0')+':00Z',visit_at:previous?.visit_at||'2026-10-11T07:00:00Z',services:capturedServices,items:capturedItems,own_medications:payload.own_medications||[],list_total:[...capturedServices,...capturedItems].reduce((sum,item)=>sum+item.line_total,0),charge_total:payload.charge_total,paid_total:paid,received_total:paid,debt_total:payload.charge_total-paid,payment_pending:payload.payment_status==='pending',payment_status:payload.payment_status,stock_deducted:false,payments,discount_reason:payload.discount_reason,discount_comment:payload.discount_comment,notes:payload.notes};
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
     const updated=recordFrom(payload,record);__pendingRecords.set(record.id,updated);__pendingWrites.push({name,args:clone(args)});__pendingReplay.set(args.p_request_id,clone(updated));return {data:clone(updated)};
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
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};
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


for (const role of ['nurse','owner']) test(`${role} repeatedly reopens an unpaid treatment and adds medicines without an edit comment`,async({page})=>{
 const errors=await boot(page,role);
 await page.evaluate(()=>{
  const record=JSON.parse(JSON.stringify(__pendingSeed));__pendingRecords.set(record.id,record);
  meds[0].sale_price=9999;services[0].work_price=9999;services[0].consumables_price=0;
 });
 await page.evaluate(()=>editTreatmentV10('procedure','procedure-1'));
 await expect(page.locator('#procMeds [data-medication-id="med-1"] .medication-price-v31')).toContainText(/Цена:\s*20\s*₽\s*\/\s*компл\..*Сумма:\s*40\s*₽/);
 await expect(page.locator('#procEditReasonBoxV10')).toBeHidden();
 await page.evaluate(()=>chooseMedication('procMeds','med-2'));
 await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('200.00');
 await expect(page.locator('#procDiscountBox')).toBeHidden();
 await page.locator('button[onclick="saveProcedure()"]') .click();
 await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args.p_payload).toMatchObject({id:'procedure-1',expected_version:3,charge_total:200,paid_total:0,payment_status:'pending',edit_reason:null,discount_comment:null});
 await page.evaluate(()=>{meds[1].sale_price=7777;return editTreatmentV10('procedure','procedure-1')});
 await expect(page.locator('#procEditReasonBoxV10')).toBeHidden();
 await page.locator('#procMeds .medrow[data-medication-id="med-2"] .medqty').fill('2');
 await expect(page.locator('#procMeds [data-medication-id="med-2"] .medication-price-v31')).toContainText(/Цена:\s*10\s*₽\s*\/\s*амп\..*Сумма:\s*20\s*₽/);
 await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('210.00');
 await page.locator('button[onclick="saveProcedure()"]') .click();
 await expect(page.locator('#workspace')).toBeVisible();
 const mutations=await writes(page);expect(mutations).toHaveLength(2);
 expect(mutations[1].args.p_payload).toMatchObject({id:'procedure-1',expected_version:4,charge_total:210,paid_total:0,payment_status:'pending',edit_reason:null,items:[{medication_id:'med-1',quantity:2},{medication_id:'med-2',quantity:2}]});
 expect(await page.evaluate(()=>__pendingRecords.get('procedure-1'))).toMatchObject({list_total:210,charge_total:210,paid_total:0,received_total:0,debt_total:210,payment_pending:true,version:5});
 expect(await page.evaluate(()=>__pendingRecords.size)).toBe(1);expect(await page.evaluate(()=>__pendingReceipts.length)).toBe(0);
 await noOverflow(page);expect(errors).toEqual([]);
});

test('an unpaid edit preserves an existing discount and still requires the separate discount explanation',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{
  const record=JSON.parse(JSON.stringify(__pendingSeed));Object.assign(record,{charge_total:170,debt_total:170,discount_reason:'Скидка от владельца',discount_comment:'Постоянная скидка по разрешению администратора'});__pendingRecords.set(record.id,record);
 });
 await page.evaluate(()=>editTreatmentV10('procedure','procedure-1'));
 await expect(page.locator('#procEditReasonBoxV10')).toBeHidden();
 await page.evaluate(()=>chooseMedication('procMeds','med-2'));
 await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('170.00');
 await page.fill('#procDiscountInPaymentV11','');await page.locator('button[onclick="saveProcedure()"]') .click();
 await expect(page.locator('#procedureMessage')).toContainText(/комментарий|причин/i);expect(await writes(page)).toHaveLength(0);
 await page.fill('#procDiscountInPaymentV11','Постоянная скидка по разрешению администратора');await page.locator('button[onclick="saveProcedure()"]') .click();
 await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args.p_payload).toMatchObject({charge_total:170,paid_total:0,edit_reason:null,discount_comment:'Постоянная скидка по разрешению администратора'});
 expect(await page.evaluate(()=>__pendingRecords.get('procedure-1'))).toMatchObject({list_total:200,charge_total:170,paid_total:0,debt_total:170,payment_pending:true});expect(errors).toEqual([]);
});

test('a separate partial receipt restores the edit-reason requirement even if the treatment is still pending',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{const record=JSON.parse(JSON.stringify(__pendingSeed));Object.assign(record,{paid_total:20,received_total:20,initial_paid_total:0,debt_total:170});__pendingRecords.set(record.id,record)});
 await page.evaluate(()=>editTreatmentV10('procedure','procedure-1'));
 await expect(page.locator('#procEditReasonBoxV10')).toBeVisible();
 await page.locator('button[onclick="saveProcedure()"]') .click();await expect(page.locator('#procedureMessage')).toContainText(/что изменили/);expect(await writes(page)).toHaveLength(0);
 await page.fill('#procEditReasonV10','Уточнено назначение после частичной оплаты');await page.locator('button[onclick="saveProcedure()"]') .click();
 await expect(page.locator('#workspace')).toBeVisible();expect((await writes(page))[0].args.p_payload).toMatchObject({paid_total:0,edit_reason:'Уточнено назначение после частичной оплаты'});expect(errors).toEqual([]);
});


for(const role of ['nurse','owner'])test(`${role} edits a saved measured quantity using the captured milligram price after catalog changes`,async({page})=>{
 const errors=await boot(page,role);
 await page.evaluate(()=>{
  Object.assign(meds[0],{name:'Рета',consumption_unit:'мг',sale_price:9999});
  const record=JSON.parse(JSON.stringify(__pendingSeed));Object.assign(record,{list_total:3900,charge_total:3900,debt_total:3900,items:[{medication_id:'med-1',name:'Рета',quantity:2.5,unit:'мг',unit_price:1500,line_total:3750}]});__pendingRecords.set(record.id,record);
 });
 await page.evaluate(()=>editTreatmentV10('procedure','procedure-1'));const row=page.locator('#procMeds [data-medication-id="med-1"]');await expect(row.locator('.medqty')).toHaveValue('2.5');await expect(row.locator('.medication-price-v31')).toContainText(/Цена:\s*1\s*500\s*₽\s*\/\s*мг/);await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('3900.00');
 await row.locator('.medqty').fill('7,5');await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('11400.00');await expect(page.locator('#procEditReasonBoxV10')).toBeHidden();await page.locator('#procedure button[onclick="saveProcedure()"]').click();await expect(page.locator('#workspace')).toBeVisible();
 const saved=await writes(page);expect(saved).toHaveLength(1);expect(saved[0].args.p_payload).toMatchObject({id:'procedure-1',expected_version:3,charge_total:11400,paid_total:0,payment_status:'pending',items:[{medication_id:'med-1',quantity:7.5}]});expect(await page.evaluate(()=>__pendingRecords.get('procedure-1').items[0])).toMatchObject({quantity:7.5,unit_price:1500,line_total:11250});expect(await page.evaluate(()=>meds[0].sale_price)).toBe(9999);expect(errors).toEqual([]);
});
