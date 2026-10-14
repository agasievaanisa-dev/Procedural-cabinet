const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Complete application UI with synthetic persisted sales and separate receipt
// events. A null buyer stays null across creation, editing and later payment.
async function boot(page,{role='nurse',paymentOnly=true}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-14T07:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]}),createSignedUrl:async()=>({data:{signedUrl:"#"}})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async({role,paymentOnly})=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  const actor={id:role==='nurse'?'nurse-1':'owner-1',full_name:role==='nurse'?'Наталья':'Аниса',role,active:true};
  const staff=[{id:'nurse-1',full_name:'Наталья',amount:2000},{id:'nurse-2',full_name:'Лилия',amount:2000}];
  const opened={id:'shift-1',date:'2026-10-14',started_at:'2026-10-14T05:30:00Z',planned_end_at:'2026-10-14T13:00:00Z',status:'open',staff};
  patients=[];nurses=staff;currentPatientId='stale-unrelated-patient';
  meds=[{id:'med-1',name:'Первый препарат',consumption_unit:'амп.',sale_price:200,work_qty:paymentOnly?0:20,active:true},{id:'med-2',name:'Второй препарат',consumption_unit:'фл.',sale_price:100,work_qty:paymentOnly?0:20,active:true}];
  services=[{id:'service-1',name:'Капельница',work_price:100,consumables_price:50,active:true}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:m.work_qty,units_per_package:10,purchase_price:0}));
  window.__saleCalls=[];window.__saleWrites=[];window.__saleRecords=new Map();window.__saleReplay=new Map();window.__saleReceipts=[];window.__saleStockEffects=[];window.__salePatientWrites=0;window.__saleLoseResponse=false;
  function report(){
   const all=[...__saleRecords.values()],procedures=all.filter(r=>r.kind==='procedure'),sales=all.filter(r=>r.kind==='sale');
   const revenue={cash:0,terminal:0,owner_card:0,total:0};
   all.forEach(r=>{for(const method of ['cash','terminal','owner_card'])revenue[method]+=r.initial_payments?.[method]||0});
   __saleReceipts.forEach(r=>{for(const method of ['cash','terminal','owner_card'])revenue[method]+=r.payments?.[method]||0});
   revenue.total=revenue.cash+revenue.terminal+revenue.owner_card;
   return {shift:opened,staff,patients_count:new Set(procedures.map(r=>r.patient_id).filter(Boolean)).size,procedures_count:procedures.length,sales_count:sales.length,procedures:clone(procedures),sales:clone(sales),receipts:clone(__saleReceipts),revenue,charge_total:all.reduce((sum,r)=>sum+r.charge_total,0),debt_total:all.reduce((sum,r)=>sum+r.debt_total,0),payroll_total:4000,payroll_complete:true,cash_after_salary:revenue.total-4000,used:[],stock:[],untracked:[],warnings:[]};
  }
  function capture(kind,payload,previous){
   const items=payload.items.map(item=>{
    const prior=previous?.items.find(row=>row.medication_id===item.medication_id),current=meds.find(m=>m.id===item.medication_id),price=prior?.unit_price??current.sale_price;
    return {medication_id:item.medication_id,name:prior?.name||current.name,unit:prior?.unit||current.consumption_unit,quantity:item.quantity,unit_price:price,line_total:price*item.quantity};
   });
   if(!paymentOnly){
    for(const med of meds){const before=previous?.items.find(row=>row.medication_id===med.id)?.quantity||0,after=items.find(row=>row.medication_id===med.id)?.quantity||0;if(after!==before){med.work_qty+=before-after;__saleStockEffects.push({medication_id:med.id,quantity:after-before})}}
   }
   const received=(previous?.paid_total||0)+payload.paid_total,payments={...(previous?.payments||{cash:0,terminal:0,owner_card:0})};
   for(const method of ['cash','terminal','owner_card'])payments[method]+=payload.payments?.[method]||0;
   return {id:previous?.id||'sale-'+(__saleRecords.size+1),kind,editable:true,version:previous?previous.version+1:1,shift_id:payload.shift_id,patient_id:payload.patient_id??null,patient:null,nurse_id:payload.nurse_id,nurse:staff.find(s=>s.id===payload.nurse_id)?.full_name,at:previous?.at||'2026-10-14T07:30:00Z',sold_at:previous?.sold_at||'2026-10-14T07:30:00Z',visit_at:previous?.visit_at||'2026-10-14T07:30:00Z',list_total:items.reduce((sum,item)=>sum+item.line_total,0),charge_total:payload.charge_total,initial_paid_total:previous?.initial_paid_total??payload.paid_total,initial_payments:previous?.initial_payments||clone(payload.payments),paid_total:received,received_total:received,debt_total:payload.charge_total-received,payment_status:payload.payment_status,payment_pending:payload.payment_status==='pending',payments,stock_deducted:!paymentOnly,items,services:[],own_medications:[],discount_reason:payload.discount_reason,discount_comment:payload.discount_comment,notes:payload.notes};
  }
  function commit(name,args,data){
   __saleWrites.push({name,args:clone(args)});__saleReplay.set(args.p_request_id,clone(data));
   if(__saleLoseResponse){__saleLoseResponse=false;throw new TypeError('Load failed')}
   return {data:clone(data)};
  }
  db.from=()=>{const query={select(){return query},eq(){return query},order(){return query},maybeSingle:async()=>({data:actor}),insert(){__salePatientWrites++;throw Error('Unexpected patient creation')},upsert(){__salePatientWrites++;throw Error('Unexpected patient creation')}};return query};
  db.rpc=async(name,args={})=>{
   __saleCalls.push({name,args:clone(args)});
   if(name==='record_treatment_v5'){
    if(__saleReplay.has(args.p_request_id))return {data:clone(__saleReplay.get(args.p_request_id))};
    if(args.p_kind!=='sale')return {error:{code:'P0001',message:'Процедура требует пациента'}};
    const record=capture(args.p_kind,args.p_payload);__saleRecords.set(record.id,record);return commit(name,args,record);
   }
   if(name==='crm_clinical_v10'){
    const p=args.p_payload||{},record=__saleRecords.get(p.id);
    if(args.p_action==='treatment_get')return {data:clone(record)};
    if(args.p_action==='patient_treatments')return {data:{procedures:[],sales:[]}};
    if(args.p_action==='debts')return {data:{debts:clone([...__saleRecords.values()].filter(r=>r.debt_total>0&&!r.payment_pending))}};
    if(__saleReplay.has(args.p_request_id))return {data:clone(__saleReplay.get(args.p_request_id))};
    if(args.p_action==='treatment_edit'){
     if(!record||p.kind!==record.kind||p.expected_version!==record.version)return {error:{code:'P0001',message:'Запись уже изменена'}};
     const updated=capture(record.kind,p,record);__saleRecords.set(record.id,updated);return commit(name,args,updated);
    }
    if(args.p_action==='debt_payment'){
     const payment=p.payments,total=payment.cash+payment.terminal+payment.owner_card;
     if(!record||p.kind!==record.kind||total<=0||total>record.debt_total)return {error:{code:'P0001',message:'Проверьте сумму оплаты'}};
     record.paid_total+=total;record.received_total=record.paid_total;record.debt_total=record.charge_total-record.paid_total;record.payment_pending=false;record.payment_status=record.debt_total?'debt':'paid';record.version++;
     for(const method of ['cash','terminal','owner_card'])record.payments[method]+=payment[method]||0;
     const receipt={id:'receipt-'+(__saleReceipts.length+1),kind:'sale',record_id:record.id,patient_id:record.patient_id,patient:null,at:'2026-10-14T08:30:00Z',paid_total:total,debt_total:record.debt_total,payments:clone(payment),shift_id:p.shift_id,nurse_id:p.nurse_id,nurse:staff.find(s=>s.id===p.nurse_id)?.full_name};
     __saleReceipts.push(receipt);return commit(name,args,receipt);
    }
   }
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[report()]}};
   if(name==='crm_finance_v5')return {data:args.p_action==='accounting_mode'?{payment_only:paymentOnly,stock_deducted:!paymentOnly}:report()};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};
   if(name.includes('warehouse'))return {data:inventory};return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  refreshDashboard=async()=>{};
  await enterApp({id:'mock-auth'});shift={id:'shift-1',aId:'nurse-1',a:'Наталья',bId:'nurse-2',b:'Лилия',type:'08:30–16:00'};show('workspace');
 },{role,paymentOnly});
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
async function sale(page,received=0,status='debt'){
 await page.locator('#workspace .home-actions button[onclick="openSale()"]' ).click();await expect(page.locator('#sale')).toBeVisible();
 await expect(page.locator('#salePatient')).toHaveValue('');await page.evaluate(()=>chooseMedication('saleMeds','med-1'));await page.fill('#saleMeds .medqty','2');
 await expect(page.locator('#salePaid')).toHaveValue('400.00');await page.selectOption('#salePaymentStatusV10',status);if(received)await page.fill('#saleReceivedV10',String(received));
}
async function save(page){await page.check('#salePayConfirmed');await page.locator('#sale button[onclick="saveSale()"]' ).click()}
const writes=page=>page.evaluate(()=>__saleWrites);
const journalEntry=(page,id='sale-1')=>page.locator('#journalBodyV12 .journal-event-v12[data-event-id="'+id+'"]');
async function noPatients(page){expect(await page.evaluate(()=>({patients:patients.length,writes:__salePatientWrites,patientSaves:__saleCalls.filter(call=>call.name==='crm_patient_save_v11').length,ids:[...__saleRecords.values()].map(r=>r.patient_id)}))).toEqual({patients:0,writes:0,patientSaves:0,ids:[null]})}

for(const role of ['nurse','owner'])for(const paymentOnly of [true,false])for(const received of [0,40])test(`${role} saves anonymous ${received?'partly paid':'unpaid'} sale in ${paymentOnly?'payment-only':'stock'} mode`,async({page})=>{
 const errors=await boot(page,{role,paymentOnly});await sale(page,received);await expect(page.locator('#saleDebtSummaryV10')).toContainText(/Долг:\s*(?:400|360)/);await page.fill('#saleNotes','Покупатель оплатит позже');await save(page);await expect(page.locator('#workspace')).toBeVisible();
 const calls=await writes(page);expect(calls).toHaveLength(1);expect(calls[0].args).toMatchObject({p_kind:'sale',p_payload:{patient_id:null,service_id:null,services:[],items:[{medication_id:'med-1',quantity:2}],charge_total:400,paid_total:received,payment_status:'debt',notes:'Покупатель оплатит позже',payments:{cash:received,terminal:0,owner_card:0,cash_received:received},expected_stock_deducted:!paymentOnly}});
 const saved=await page.evaluate(()=>__saleRecords.get('sale-1'));expect(saved).toMatchObject({kind:'sale',patient_id:null,paid_total:received,debt_total:400-received,stock_deducted:!paymentOnly});await noPatients(page);
 expect(await page.evaluate(()=>__saleStockEffects)).toEqual(paymentOnly?[]:[{medication_id:'med-1',quantity:2}]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

for(const role of ['nurse','owner'])test(`${role} reopens anonymous debt sale and changes medicines without attaching a stale patient`,async({page})=>{
 const errors=await boot(page,{role});await sale(page);await save(page);await expect(page.locator('#workspace')).toBeVisible();
 if(role==='nurse'){await page.click('#homeJournalV12');await journalEntry(page).getByRole('button',{name:'Редактировать',exact:true}).click()}else await page.evaluate(()=>editTreatmentV10('sale','sale-1'));
 await expect(page.locator('#sale h1')).toHaveText('Редактирование продажи');await expect(page.locator('#salePatient')).toHaveValue('');await expect(page.locator('#salePaymentStatusV10')).toHaveValue('debt');await page.evaluate(()=>chooseMedication('saleMeds','med-2'));await page.fill('#saleChargeInPaymentV11','500');await page.fill('#saleEditReasonV10','Добавлен второй препарат к продаже');await save(page);await expect(page.locator('#workspace')).toBeVisible();
 const edits=(await writes(page)).filter(call=>call.args.p_action==='treatment_edit');expect(edits).toHaveLength(1);expect(edits[0].args.p_payload).toMatchObject({id:'sale-1',kind:'sale',patient_id:null,expected_version:1,charge_total:500,paid_total:0,payment_status:'debt',items:[{medication_id:'med-1',quantity:2},{medication_id:'med-2',quantity:1}],edit_reason:'Добавлен второй препарат к продаже',payments:{cash:0,terminal:0,owner_card:0,cash_received:0}});
 expect(await page.evaluate(()=>__saleRecords.get('sale-1'))).toMatchObject({version:2,patient_id:null,debt_total:500});await noPatients(page);expect(errors).toEqual([]);
});

test('nurse collects anonymous sale debt directly from the journal and report separates original sale from later money',async({page})=>{
 const errors=await boot(page);await sale(page,40);await save(page);await expect(page.locator('#workspace')).toBeVisible();await page.click('#homeJournalV12');await expect(journalEntry(page)).toContainText('Без пациента');await journalEntry(page).getByRole('button',{name:'Принять оплату долга',exact:true}).click();
 await expect(page.locator('#debtPaymentV10')).toBeVisible();await expect(page.locator('#debtAmountV10')).toHaveValue('360.00');expect(await page.locator('#debtPaymentV10').getAttribute('data-patient-id')).toBe('');await page.fill('#debtAmountV10','100');await page.selectOption('#debtMethodV10','terminal');await page.check('#debtConfirmV10');await page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]' ).click();
 await expect(page.locator('#shiftJournalV12')).toBeVisible();await expect(journalEntry(page)).toContainText(/В долг:\s*260/);const payment=(await writes(page)).find(call=>call.args.p_action==='debt_payment');expect(payment.args.p_payload).toMatchObject({kind:'sale',id:'sale-1',shift_id:'shift-1',nurse_id:'nurse-1',payments:{cash:0,terminal:100,owner_card:0,cash_received:0}});await noPatients(page);
 await page.evaluate(()=>openReport());await expect(page.locator('#report')).toBeVisible();
 for(const [key,total] of [['revenue','140'],['sales','40'],['receipts','100'],['cash','40'],['terminal','100'],['loan','260'],['charge','400']])await expect(page.locator('#reportBody [data-summary-key="'+key+'"]')).toContainText(total);
 expect(await page.evaluate(()=>__saleReceipts.length)).toBe(1);expect(errors).toEqual([]);
});

test('owner collects anonymous sale from all debts and returns to debts without opening an unrelated patient',async({page})=>{
 const errors=await boot(page,{role:'owner'});await sale(page);await save(page);await expect(page.locator('#workspace')).toBeVisible();await page.evaluate(()=>openDebtsV10());await expect(page.locator('#debtsV10')).toBeVisible();await page.locator('#debtsBodyV10 button').filter({hasText:'Принять оплату долга'}).click();
 await expect(page.locator('#debtPaymentV10')).toBeVisible();expect(await page.locator('#debtPaymentV10').getAttribute('data-patient-id')).toBe('');await page.check('#debtConfirmV10');await page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]' ).click();await expect(page.locator('#debtsV10')).toBeVisible();await expect(page.locator('#debtsBodyV10 button')).toHaveCount(0);await expect(page.locator('#debtsBodyV10')).toContainText(/Всего к оплате:\s*0/);
 expect(await page.evaluate(()=>__saleRecords.get('sale-1'))).toMatchObject({patient_id:null,paid_total:400,debt_total:0});await noPatients(page);expect(errors).toEqual([]);
});

test('ambiguous anonymous debt save retries the same exact request and does not duplicate sale or stock deduction',async({page})=>{
 const errors=await boot(page,{paymentOnly:false});await sale(page);await page.fill('#saleNotes','Не потерять продажу в долг');await page.evaluate(()=>{__saleLoseResponse=true});await save(page);await expect(page.locator('#saleMessage')).toContainText('Черновик сохранён');await expect(page.locator('#salePatient')).toBeDisabled();await expect(page.locator('#saleReceivedV10')).toBeDisabled();
 await page.evaluate(()=>{document.getElementById('saleNotes').value='Изменённый текст';document.getElementById('saleReceivedV10').value='1'});await page.locator('#sale button[onclick="saveSale()"]' ).click();await expect(page.locator('#workspace')).toBeVisible();
 const calls=await page.evaluate(()=>__saleCalls.filter(call=>call.name==='record_treatment_v5'));expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(await writes(page)).toHaveLength(1);expect(await page.evaluate(()=>__saleStockEffects)).toEqual([{medication_id:'med-1',quantity:2}]);expect(await page.evaluate(()=>__saleRecords.get('sale-1'))).toMatchObject({patient_id:null,paid_total:0,debt_total:400,notes:'Не потерять продажу в долг'});await noPatients(page);expect(errors).toEqual([]);
});

test('procedure still requires its patient when saving debt',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openProcedure());await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procService','service-1');await page.selectOption('#procPaymentStatusV10','debt');await page.check('#procPayConfirmed');await page.locator('#procedure button[onclick="saveProcedure()"]' ).click();await expect(page.locator('#procedureMessage')).toContainText('Выберите пациента');expect(await writes(page)).toHaveLength(0);expect(await page.evaluate(()=>__saleCalls.filter(call=>call.name==='record_treatment_v5'))).toHaveLength(0);expect(errors).toEqual([]);
});
