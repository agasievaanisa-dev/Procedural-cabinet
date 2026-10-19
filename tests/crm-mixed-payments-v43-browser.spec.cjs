const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Real form controls with a persisted, idempotent RPC boundary. All identities
// are fictional; the previous-shift record exercises captured prices rather
// than silently repricing an old visit from today's catalogue.
async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-17T07:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  const actor={id:role==='nurse'?'nurse-test':'admin-test',full_name:'Сотрудница Тестовая',role,active:true};
  const staff=[{id:'nurse-test',full_name:'Сотрудница Тестовая'},{id:'nurse-second',full_name:'Сотрудница Вторая'}];
  const opened={id:'current-shift',date:'2026-10-17',started_at:'2026-10-17T05:30:00Z',planned_end_at:'2026-10-17T13:00:00Z',status:'open',staff};
  patients=[{id:'patient-test',full_name:'Тестов Виктор',sex:'male'}];nurses=staff;
  meds=[{id:'medicine-procedure',name:'Тестовый препарат процедуры',consumption_unit:'амп.',sale_price:1000,work_qty:0,active:true},{id:'medicine-sale',name:'Тестовый препарат продажи',consumption_unit:'фл.',sale_price:1600,work_qty:0,active:true}];
  services=[{id:'service-test',name:'Капельница',work_price:500,consumables_price:100,active:true}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:0,units_per_package:5,purchase_price:0,active:true}));
  window.__mixCalls=[];window.__mixWrites=[];window.__mixReplay=new Map();window.__mixRecords=new Map();window.__mixLost=false;window.__mixDeferred=false;window.__mixReceipts=[];
  window.__mixSeed={id:'previous-procedure',kind:'procedure',editable:true,version:3,shift_id:'previous-shift',patient_id:'patient-test',patient:'Тестов Виктор',nurse_id:'nurse-test',nurse:'Сотрудница Тестовая',service_id:'service-test',procedure_type:'Капельница',visit_at:'2026-10-16T07:00:00Z',at:'2026-10-16T07:00:00Z',list_total:1600,charge_total:1600,paid_total:0,received_total:0,initial_paid_total:0,debt_total:1600,payment_pending:true,payment_status:'pending',stock_deducted:false,services:[{service_id:'service-test',name:'Капельница',quantity:1,unit_price:600,work_price:500,consumables_price:100,line_total:600}],items:[{medication_id:'medicine-procedure',name:'Тестовый препарат процедуры',quantity:1,unit:'амп.',unit_price:1000,line_total:1000}],own_medications:[],payments:{cash:0,terminal:0,owner_card:0},notes:'Сохранённая процедура'};
  __mixRecords.set(__mixSeed.id,clone(__mixSeed));
  __mixRecords.set('previous-sale',{...clone(__mixSeed),id:'previous-sale',kind:'sale',service_id:null,procedure_type:null,services:[],items:[{medication_id:'medicine-sale',name:'Тестовый препарат продажи',quantity:1,unit:'фл.',unit_price:1600,line_total:1600}]});
  const report=()=>({shift:opened,staff,procedures:[],sales:[],receipts:[],patients_count:0,procedures_count:0,sales_count:0,revenue:{cash:0,terminal:0,owner_card:0,total:0},charge_total:0,debt_total:0,used:[],stock:[],untracked:[],warnings:[]});
  db.from=()=>{const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:actor})};return q};
  async function mutate(name,args){
   if(__mixReplay.has(args.p_request_id))return {data:clone(__mixReplay.get(args.p_request_id))};
   const p=args.p_payload,previous=__mixRecords.get(p.id),paid=(previous?.paid_total||0)+(p.paid_total||0);
   let result;
   if(args.p_action==='debt_payment'){
    const amount=p.payments?p.payments.cash+p.payments.terminal+p.payments.owner_card:p.amount;
    if(!previous||amount<=0||amount>previous.debt_total)return {error:{code:'P0001',message:'Проверьте сумму оплаты'}};
    previous.paid_total+=amount;previous.received_total=previous.paid_total;previous.debt_total=previous.charge_total-previous.paid_total;previous.payment_pending=false;previous.payment_status=previous.debt_total?'debt':'paid';previous.version++;
    result={id:'receipt-'+(__mixReceipts.length+1),paid_total:amount,debt_total:previous.debt_total,payments:p.payments,shift_id:p.shift_id,nurse_id:p.nurse_id};__mixReceipts.push(clone(result));
   }else{
    result={...(previous||{}),...clone(p),id:previous?.id||'new-record-'+(__mixWrites.length+1),kind:p.kind||(p.services?.length?'procedure':'sale'),version:(previous?.version||0)+1,paid_total:paid,received_total:paid,debt_total:p.charge_total-paid,stock_deducted:false,payment_pending:p.payment_status==='pending'};
    __mixRecords.set(result.id,result);
   }
   __mixWrites.push({name,args:clone(args)});__mixReplay.set(args.p_request_id,clone(result));
   if(__mixDeferred)await new Promise(resolve=>{window.__mixRelease=resolve});
   if(__mixLost){__mixLost=false;throw new TypeError('Load failed')}
   return {data:clone(result)};
  }
  db.rpc=async(name,args={})=>{
   __mixCalls.push({name,args:clone(args)});
   if(name==='record_treatment_v5')return mutate(name,args);
   if(name==='crm_clinical_v10'){
    if(args.p_action==='treatment_get')return {data:clone(__mixRecords.get(args.p_payload.id))};
    if(args.p_action==='patient_treatments')return {data:{procedures:[],sales:[]}};
    if(['treatment_edit','debt_payment'].includes(args.p_action))return mutate(name,args);
    return {data:[]};
   }
   if(name==='crm_finance_v5')return {data:args.p_action==='accounting_mode'?{payment_only:true,stock_deducted:false}:report()};
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[report()]}};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};
   if(name.includes('warehouse'))return {data:inventory};return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'auth-test'});shift={id:'current-shift',aId:'nurse-test',a:'Сотрудница Тестовая',bId:'nurse-second',b:'Сотрудница Вторая',type:'08:30–16:00'};show('workspace');
 },role);
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
const writes=page=>page.evaluate(()=>__mixWrites);
const mutations=page=>page.evaluate(()=>__mixCalls.filter(call=>call.name==='record_treatment_v5'||call.name==='crm_clinical_v10'&&['treatment_edit','debt_payment'].includes(call.args.p_action)));
async function openForm(page,kind='procedure',edit=false){
 if(edit)await page.evaluate(kind=>editTreatmentV10(kind,kind==='sale'?'previous-sale':'previous-procedure'),kind);
 else if(kind==='sale')await page.evaluate(async()=>{await openSale('patient-test');chooseMedication('saleMeds','medicine-sale')});
 else{await page.evaluate(()=>openProcedure('patient-test'));await page.selectOption('#procService','service-test');await page.evaluate(()=>chooseMedication('procMeds','medicine-procedure'))}
 const prefix=kind==='sale'?'sale':'proc';
 await expect(page.locator('#'+kind)).toBeVisible();await expect(page.locator('#'+prefix+'Paid')).toHaveValue('1600.00');
 if(edit){await page.selectOption('#'+prefix+'PaymentStatusV10','paid');await expect(page.locator('#'+prefix+'PaymentShiftV49')).toBeEnabled();await page.selectOption('#'+prefix+'PaymentShiftV49','current-shift');await page.fill('#'+prefix+'EditReasonV10','Уточнены фактически полученные способы оплаты')}
 await page.click('#'+prefix+'PaymentV5 [data-pay-method="mixed"]');return prefix;
}
async function splitForm(page,prefix,{cash='1200',terminal='400',card='',tender}={}){
 await page.fill('#'+prefix+'PayCash',cash);await page.fill('#'+prefix+'PayTerminal',terminal);await page.fill('#'+prefix+'PayOwnerCard',card);
 if(tender!==undefined)await page.fill('#'+prefix+'PayTender',tender);
}
async function saveForm(page,prefix='proc'){
 await page.check('#'+prefix+'PayConfirmed');await page.locator('#'+(prefix==='proc'?'procedure':'sale')+' button[onclick="'+(prefix==='proc'?'saveProcedure()':'saveSale()')+'"]').click();
}
async function openPending(page,kind='procedure'){
 await page.evaluate(kind=>openSavedPaymentV14(kind,kind==='sale'?'previous-sale':'previous-procedure',1600,'patient-test',true),kind);
 await expect(page.locator('#debtPaymentV10')).toBeVisible();await expect(page.locator('#debtShiftV49')).toBeEnabled();await page.selectOption('#debtShiftV49','current-shift');await page.selectOption('#debtMethodV10','mixed');
}
async function splitPending(page,{cash='1200',terminal='400',card='',tender}={}){
 await page.fill('#debtCashV43',cash);await page.fill('#debtTerminalV43',terminal);await page.fill('#debtOwnerCardV43',card);
 if(tender!==undefined)await page.fill('#debtTenderV10',tender);
}
async function savePending(page){await page.check('#debtConfirmV10');await page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()" ]').click()}

for(const kind of ['procedure','sale'])for(const edit of [false,true])test(`${edit?'previous-shift edit':'new'} ${kind} accepts 1200 cash plus 400 terminal with the unused card field blank`,async({page})=>{
 const errors=await boot(page);const prefix=await openForm(page,kind,edit);await splitForm(page,prefix);await saveForm(page,prefix);await expect(page.locator('#workspace')).toBeVisible();
 const saved=await writes(page);expect(saved).toHaveLength(1);expect(saved[0].args.p_payload).toMatchObject({charge_total:1600,paid_total:1600,payment_status:'paid',payments:{cash:1200,terminal:400,owner_card:0,cash_received:1200}});
 if(edit)expect(saved[0].args.p_payload).toMatchObject({id:kind==='sale'?'previous-sale':'previous-procedure',kind,expected_version:3,shift_id:'previous-shift',payment_shift_id:'current-shift',payment_nurse_id:'nurse-test'});
 else expect(saved[0].name).toBe('record_treatment_v5');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

for(const scenario of [
 {name:'terminal and card',input:{cash:'',terminal:'400',card:'1200'},expected:{cash:0,terminal:400,owner_card:1200,cash_received:0}},
 {name:'cash and card with change',input:{cash:'1200',terminal:'',card:'400',tender:'1500'},expected:{cash:1200,terminal:0,owner_card:400,cash_received:1500}}
])test(`mixed procedure supports ${scenario.name} with a blank unused channel`,async({page})=>{
 const errors=await boot(page,'nurse');await openForm(page);await splitForm(page,'proc',scenario.input);await saveForm(page);await expect(page.locator('#workspace')).toBeVisible();expect((await writes(page))[0].args.p_payload.payments).toEqual(scenario.expected);expect(errors).toEqual([]);
});

for(const scenario of [
 {name:'wrong allocation sum',input:{cash:'1200',terminal:'399',card:''},message:/Распределите/},
 {name:'negative allocation',input:{cash:'1200',terminal:'400',card:'-1'},message:/от нуля/},
 {name:'fractional kopeck allocation',input:{cash:'1200',terminal:'399.999',card:''},message:/копеек/},
 {name:'cash tender below the cash allocation',input:{cash:'1200',terminal:'400',card:'',tender:'1199'},message:/меньше/}
])test(`mixed procedure rejects ${scenario.name} without submitting or losing the draft`,async({page})=>{
 const errors=await boot(page);await openForm(page);await splitForm(page,'proc',scenario.input);await saveForm(page);await expect(page.locator('#procedure')).toBeVisible();await expect(page.locator('#procedureMessage')).toContainText(scenario.message);expect(await writes(page)).toHaveLength(0);expect(await mutations(page)).toHaveLength(0);await expect(page.locator('#procPayCash')).toHaveValue(scenario.input.cash);expect(errors).toEqual([]);
});

test('blank charge is still invalid rather than a zero-priced procedure',async({page})=>{
 const errors=await boot(page);await openForm(page);await splitForm(page,'proc');await page.fill('#procChargeInPaymentV11','');await saveForm(page);await expect(page.locator('#procedureMessage')).toContainText(/стоимость.*сумму|сумму.*копеек/i);expect(await mutations(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('blank received amount and blank cash tender remain invalid despite optional allocation fields',async({page})=>{
 const errors=await boot(page);await openForm(page);await page.selectOption('#procPaymentStatusV10','debt');await page.fill('#procReceivedV10','');await saveForm(page);await expect(page.locator('#procedureMessage')).toContainText(/оплата сейчас.*сумму/i);expect(await mutations(page)).toHaveLength(0);
 await page.fill('#procReceivedV10','1600');await splitForm(page,'proc',{tender:''});await saveForm(page);await expect(page.locator('#procedureMessage')).toContainText(/Получено наличными.*сумму/i);expect(await mutations(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('changing a mixed component invalidates an earlier payment confirmation',async({page})=>{
 const errors=await boot(page);await openForm(page);await splitForm(page,'proc');await page.check('#procPayConfirmed');await page.fill('#procPayTerminal','300');await expect(page.locator('#procPayConfirmed')).not.toBeChecked();await page.fill('#procPayCash','1300');await saveForm(page);await expect(page.locator('#workspace')).toBeVisible();expect((await writes(page))[0].args.p_payload.payments).toEqual({cash:1300,terminal:300,owner_card:0,cash_received:1300});expect(errors).toEqual([]);
});

for(const kind of ['procedure','sale'])test(`saved ordinary ${kind} payment records 1200 cash and 400 terminal once, not 1600 cash`,async({page})=>{
 const errors=await boot(page);await openPending(page,kind);await splitPending(page);await savePending(page);await expect(page.locator('#patientCard')).toBeVisible();
 const saved=await writes(page);expect(saved).toHaveLength(1);expect(saved[0].args).toMatchObject({p_action:'debt_payment',p_payload:{id:kind==='sale'?'previous-sale':'previous-procedure',kind,shift_id:'current-shift',nurse_id:'nurse-test',payments:{cash:1200,terminal:400,owner_card:0,cash_received:1200}}});expect(await page.evaluate(()=>__mixReceipts.length)).toBe(1);expect(errors).toEqual([]);
});

test('saved ordinary payment supports terminal plus card without requiring cash tender',async({page})=>{
 const errors=await boot(page);await openPending(page);await splitPending(page,{cash:'',terminal:'1000',card:'600'});await savePending(page);await expect(page.locator('#patientCard')).toBeVisible();expect((await writes(page))[0].args.p_payload.payments).toEqual({cash:0,terminal:1000,owner_card:600,cash_received:0});expect(errors).toEqual([]);
});

for(const scenario of [
 {name:'wrong sum',input:{cash:'1200',terminal:'300',card:''},message:/Распределите|сумм/i},
 {name:'negative allocation',input:{cash:'1200',terminal:'400',card:'-1'},message:/от нуля/},
 {name:'fractional kopecks',input:{cash:'1200',terminal:'399.999',card:''},message:/копеек/},
 {name:'insufficient tender',input:{cash:'1200',terminal:'400',card:'',tender:'1199'},message:/меньше/}
])test(`saved ordinary mixed payment rejects ${scenario.name} without a receipt`,async({page})=>{
 const errors=await boot(page);await openPending(page);await splitPending(page,scenario.input);await savePending(page);await expect(page.locator('#debtPaymentV10')).toBeVisible();await expect(page.locator('#debtMessageV10')).toContainText(scenario.message);expect(await mutations(page)).toHaveLength(0);expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('uncertain mixed receipt reopens with all components locked and replays the exact UUID only once',async({page})=>{
 const errors=await boot(page);await openPending(page);await splitPending(page);await page.fill('#debtNoteV10','Два фактических способа оплаты');await page.evaluate(()=>{__mixLost=true});await savePending(page);await expect(page.locator('#debtMessageV10')).toContainText(/Черновик сохранён|сохранение.*не подтверждено/i);
 for(const id of ['debtAmountV10','debtMethodV10','debtCashV43','debtTerminalV43','debtOwnerCardV43','debtTenderV10'])await expect(page.locator('#'+id)).toBeDisabled();
 await page.evaluate(()=>{show('workspace');openSavedPaymentV14('procedure','previous-procedure',1600,'patient-test',true)});await expect(page.locator('#debtMethodV10')).toHaveValue('mixed');await expect(page.locator('#debtCashV43')).toHaveValue(/1200/);await expect(page.locator('#debtTerminalV43')).toHaveValue(/400/);
 await page.evaluate(()=>{document.getElementById('debtCashV43').value='1';document.getElementById('debtMethodV10').value='cash'});await page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()" ]').click();await expect(page.locator('#patientCard')).toBeVisible();
 const calls=await mutations(page);expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(calls[0].args.p_request_id).toMatch(/^[\da-f-]{36}$/i);expect(await writes(page)).toHaveLength(1);expect(await page.evaluate(()=>__mixReceipts.length)).toBe(1);expect(errors).toEqual([]);
});

test('a delayed mixed receipt cannot navigate away from the screen the user opened afterwards',async({page})=>{
 const errors=await boot(page);await openPending(page);await splitPending(page);await page.evaluate(()=>{__mixDeferred=true});await savePending(page);await page.waitForFunction(()=>typeof __mixRelease==='function');await page.evaluate(()=>goPatients());await expect(page.locator('#patients')).toBeVisible();await page.evaluate(()=>__mixRelease());await expect.poll(async()=>(await writes(page)).length).toBe(1);await expect(page.locator('#patients')).toBeVisible();await expect(page.locator('#patientCard')).not.toBeVisible();expect(errors).toEqual([]);
});

test('signout clears the mixed payment form and a late response cannot restore the previous employee screen',async({page})=>{
 const errors=await boot(page);await openPending(page);await splitPending(page);await page.evaluate(()=>{__mixDeferred=true});await savePending(page);await page.waitForFunction(()=>typeof __mixRelease==='function');await page.evaluate(()=>signOut());await expect(page.locator('#login')).toBeVisible();await page.evaluate(()=>__mixRelease());await expect(page.locator('#debtCashV43')).toHaveCount(0);await expect(page.locator('#debtPaymentV10')).not.toBeVisible();await expect(page.locator('#login')).toBeVisible();expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('true debt repayment stays separate and does not expose the shift payment-method selector',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openSavedPaymentV14('procedure','previous-procedure',1600,'patient-test',false));await expect(page.locator('#debtPaymentV10 h1')).toHaveText('Погашение долга');await expect(page.locator('#debtPaymentV10')).toContainText('не входит в сумму смены и её кассу');await expect(page.locator('#debtMethodV10')).toHaveCount(0);await expect(page.locator('#debtCashV43')).toHaveCount(0);await page.fill('#debtPurposeV29','Возврат ранее оформленного долга');await savePending(page);await expect(page.locator('#patientCard')).toBeVisible();
 const payload=(await writes(page))[0].args.p_payload;expect(payload).toMatchObject({amount:1600,paid_on:'2026-10-17',purpose:'Возврат ранее оформленного долга'});expect(payload).not.toHaveProperty('shift_id');expect(payload).not.toHaveProperty('payments');expect(errors).toEqual([]);
});
