const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Real forms and an idempotent persistence boundary, with fictional identities.
// A positive receipt must have a deliberately selected payment channel.
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
 else if(kind==='sale')await page.evaluate(async()=>{await openSale();chooseMedication('saleMeds','medicine-sale')});
 else{await page.evaluate(()=>openProcedure('patient-test'));await page.selectOption('#procService','service-test');await page.evaluate(()=>chooseMedication('procMeds','medicine-procedure'))}
 const prefix=kind==='sale'?'sale':'proc';await expect(page.locator('#'+kind)).toBeVisible();await expect(page.locator('#'+prefix+'Paid')).toHaveValue('1600.00');return prefix;
}
async function save(page,prefix){
 await page.check('#'+prefix+'PayConfirmed');await page.locator('#'+(prefix==='proc'?'procedure':'sale')+' button[onclick="'+(prefix==='proc'?'saveProcedure()':'saveSale()')+'"]').click();
}

for(const role of ['admin','nurse'])for(const kind of ['procedure','sale'])test(`${role} must explicitly choose a method before saving a paid ${kind}`,async({page})=>{
 const errors=await boot(page,role),prefix=await openForm(page,kind);
 await expect(page.locator('#'+prefix+'PaymentV5 [data-pay-method][aria-pressed="true"]')).toHaveCount(0);
 for(const suffix of ['Cash','Terminal','OwnerCard'])await expect(page.locator('#'+prefix+'Pay'+suffix)).toHaveValue('0.00');
 await expect(page.locator('#'+prefix+'PaySummary')).toContainText('Выберите способ оплаты');await expect(page.locator('#'+prefix+'PayTenderBox')).not.toBeVisible();
 await save(page,prefix);await expect(page.locator('#'+kind+'Message')).toContainText('Выберите способ оплаты');expect(await writes(page)).toHaveLength(0);expect(await mutations(page)).toHaveLength(0);expect(errors).toEqual([]);
});

for(const kind of ['procedure','sale'])for(const scenario of [
 {method:'cash',label:'Наличные',payment:{cash:1600,terminal:0,owner_card:0,cash_received:1600}},
 {method:'terminal',label:'Терминал',payment:{cash:0,terminal:1600,owner_card:0,cash_received:0}},
 {method:'owner_card',label:'Перевод на карту начальника',payment:{cash:0,terminal:0,owner_card:1600,cash_received:0}}
])test(`${kind} shows and saves the explicitly chosen ${scenario.method} without guessing cash`,async({page})=>{
 const errors=await boot(page),prefix=await openForm(page,kind);await page.locator('#'+prefix+'PaymentV5 [data-pay-method="'+scenario.method+'"]').click();
 await expect(page.locator('#'+prefix+'PaySummary')).toContainText(scenario.label+': 1 600');await expect(page.locator('#'+prefix+'PayConfirmed')).not.toBeChecked();
 await save(page,prefix);await expect(page.locator('#workspace')).toBeVisible();const saved=await writes(page);expect(saved).toHaveLength(1);expect(saved[0].args.p_payload.payments).toEqual(scenario.payment);expect(errors).toEqual([]);
});

test('explicit mixed payment keeps the exact cash and terminal components and cash change',async({page})=>{
 const errors=await boot(page),prefix=await openForm(page);await page.locator('#procPaymentV5 [data-pay-method="mixed"]').click();
 await page.fill('#procPayCash','1200');await page.fill('#procPayTerminal','400');await page.fill('#procPayOwnerCard','');await page.fill('#procPayTender','1500');
 await expect(page.locator('#procPaySummary')).toContainText('Наличные: 1 200');await expect(page.locator('#procPaySummary')).toContainText('Терминал: 400');await expect(page.locator('#procPaySummary')).toContainText('Сдача: 300');
 await save(page,prefix);await expect(page.locator('#workspace')).toBeVisible();expect((await writes(page))[0].args.p_payload.payments).toEqual({cash:1200,terminal:400,owner_card:0,cash_received:1500});expect(errors).toEqual([]);
});

for(const kind of ['procedure','sale'])test(`the next ${kind} cannot inherit the preceding patient's cash choice`,async({page})=>{
 const errors=await boot(page),prefix=await openForm(page,kind);await page.locator('#'+prefix+'PaymentV5 [data-pay-method="cash"]').click();await save(page,prefix);await expect(page.locator('#workspace')).toBeVisible();
 await openForm(page,kind);await expect(page.locator('#'+prefix+'PaymentV5 [data-pay-method][aria-pressed="true"]')).toHaveCount(0);await save(page,prefix);await expect(page.locator('#'+kind+'Message')).toContainText('Выберите способ оплаты');expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

for(const kind of ['procedure','sale'])for(const mode of ['pending','debt','free'])test(`a ${kind} with no money received in ${mode} mode needs no payment method`,async({page})=>{
 const errors=await boot(page),prefix=await openForm(page,kind);await page.selectOption('#'+prefix+'PaymentStatusV10',mode);
 if(mode==='free')await page.fill('#'+prefix+'DiscountInPaymentV11','Бесплатная процедура по согласованию');
 await expect(page.locator('#'+prefix+'PaymentV5 [data-pay-method][aria-pressed="true"]')).toHaveCount(0);
 await save(page,prefix);await expect(page.locator('#workspace')).toBeVisible();expect((await writes(page))[0].args.p_payload).toMatchObject({paid_total:0,payment_status:mode,payments:{cash:0,terminal:0,owner_card:0,cash_received:0}});expect(errors).toEqual([]);
});

test('adding a positive payment to a saved procedure needs a newly chosen method',async({page})=>{
 const errors=await boot(page),prefix=await openForm(page,'procedure',true);await page.selectOption('#procPaymentStatusV10','paid');await page.fill('#procEditReasonV10','Получена оплата после процедуры');
 await save(page,prefix);await expect(page.locator('#procedureMessage')).toContainText('Выберите способ оплаты');expect(await mutations(page)).toHaveLength(0);
 await page.locator('#procPaymentV5 [data-pay-method="owner_card"]').click();await save(page,prefix);await expect(page.locator('#workspace')).toBeVisible();expect((await writes(page))[0].args).toMatchObject({p_action:'treatment_edit',p_payload:{paid_total:1600,payments:{cash:0,terminal:0,owner_card:1600,cash_received:0}}});expect(errors).toEqual([]);
});

test('editing an already paid procedure without a new receipt does not require another payment method',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>Object.assign(__mixRecords.get('previous-procedure'),{paid_total:1600,received_total:1600,initial_paid_total:1600,debt_total:0,payment_pending:false,payment_status:'paid',payments:{cash:0,terminal:1600,owner_card:0}}));
 const prefix=await openForm(page,'procedure',true);await page.fill('#procEditReasonV10','Уточнён комментарий к сохранённой процедуре');await page.fill('#procNotes','Новая заметка');
 await save(page,prefix);await expect(page.locator('#workspace')).toBeVisible();expect((await writes(page))[0].args.p_payload).toMatchObject({paid_total:0,payments:{cash:0,terminal:0,owner_card:0,cash_received:0},notes:'Новая заметка'});expect(errors).toEqual([]);
});

test('a selected terminal cannot submit stale hidden cash allocations',async({page})=>{
 const errors=await boot(page),prefix=await openForm(page);await page.locator('#procPaymentV5 [data-pay-method="terminal"]').click();
 await page.evaluate(()=>{document.getElementById('procPayCash').value='1600';document.getElementById('procPayTerminal').value='0';document.getElementById('procPayTender').value='1600'});
 await save(page,prefix);await expect(page.locator('#procedureMessage')).toContainText('не соответствуют выбранному способу оплаты');expect(await mutations(page)).toHaveLength(0);
 await page.locator('#procPaymentV5 [data-pay-method="terminal"]').click();await save(page,prefix);await expect(page.locator('#workspace')).toBeVisible();expect((await writes(page))[0].args.p_payload.payments).toEqual({cash:0,terminal:1600,owner_card:0,cash_received:0});expect(errors).toEqual([]);
});

test('an uncertain explicit card payment retries the original allocation and UUID once',async({page})=>{
 const errors=await boot(page),prefix=await openForm(page);await page.locator('#procPaymentV5 [data-pay-method="owner_card"]').click();await page.evaluate(()=>{__mixLost=true});await save(page,prefix);
 await expect(page.locator('#procedureMessage')).toContainText('Черновик сохранён');await expect(page.locator('#procPaymentV5 [data-pay-method="cash"]')).toBeDisabled();
 await page.evaluate(()=>{document.getElementById('procPayCash').value='1600';document.getElementById('procPayOwnerCard').value='0'});
 await page.locator('#procedure button[onclick="saveProcedure()"]').click();await expect(page.locator('#workspace')).toBeVisible();const calls=await mutations(page);expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(calls[0].args.p_payload.payments).toEqual({cash:0,terminal:0,owner_card:1600,cash_received:0});expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});
