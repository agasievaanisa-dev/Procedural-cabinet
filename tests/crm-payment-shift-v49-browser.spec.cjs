const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Real forms and an idempotent persistence boundary, with fictional identities.
// A positive receipt must have a deliberately selected payment channel.
async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-19T13:30:00Z'));
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
  window.__sourceShift={...clone(opened),id:'previous-shift',date:'2026-10-19',started_at:'2026-10-19T05:30:00Z',planned_end_at:'2026-10-19T13:00:00Z'};window.__otherShift={...clone(opened),date:'2026-10-19',started_at:'2026-10-19T13:00:00Z',planned_end_at:'2026-10-19T20:00:00Z',staff:[{id:'nurse-evening',full_name:'Вечерняя Медсестра'},{id:'nurse-late',full_name:'Вторая Вечерняя'}]};window.__openShifts=[__sourceShift,__otherShift];window.__contextFail=false;window.__contextDelay=false;window.__receiptReject=false;window.__mixCalls=[];window.__mixWrites=[];window.__mixReplay=new Map();window.__mixRecords=new Map();window.__mixLost=false;window.__mixDeferred=false;window.__mixReceipts=[];
  window.__mixSeed={id:'previous-procedure',kind:'procedure',editable:true,version:3,shift_id:'previous-shift',patient_id:'patient-test',patient:'Тестов Виктор',nurse_id:'nurse-test',nurse:'Сотрудница Тестовая',service_id:'service-test',procedure_type:'Капельница',visit_at:'2026-10-16T07:00:00Z',at:'2026-10-16T07:00:00Z',list_total:1600,charge_total:1600,paid_total:0,received_total:0,initial_paid_total:0,debt_total:1600,payment_pending:true,payment_status:'pending',stock_deducted:false,services:[{service_id:'service-test',name:'Капельница',quantity:1,unit_price:600,work_price:500,consumables_price:100,line_total:600}],items:[{medication_id:'medicine-procedure',name:'Тестовый препарат процедуры',quantity:1,unit:'амп.',unit_price:1000,line_total:1000}],own_medications:[],payments:{cash:0,terminal:0,owner_card:0},notes:'Сохранённая процедура'};
  __mixRecords.set(__mixSeed.id,clone(__mixSeed));
  __mixRecords.set('previous-sale',{...clone(__mixSeed),id:'previous-sale',kind:'sale',service_id:null,procedure_type:null,services:[],items:[{medication_id:'medicine-sale',name:'Тестовый препарат продажи',quantity:1,unit:'фл.',unit_price:1600,line_total:1600}]});
  const report=()=>({shift:opened,staff,procedures:[],sales:[],receipts:[],patients_count:0,procedures_count:0,sales_count:0,revenue:{cash:0,terminal:0,owner_card:0,total:0},charge_total:0,debt_total:0,used:[],stock:[],untracked:[],warnings:[]});
  db.from=()=>{const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:actor})};return q};
  async function mutate(name,args){
   if(__mixReplay.has(args.p_request_id))return {data:clone(__mixReplay.get(args.p_request_id))};
   const p=args.p_payload,previous=__mixRecords.get(p.id),paid=(previous?.paid_total||0)+(p.paid_total||0);
   let result;
   if(args.p_action==='debt_payment'){if(__receiptReject)return {error:{code:'P0001',message:'Выбранная смена уже закрыта'}};
    const amount=p.payments?p.payments.cash+p.payments.terminal+p.payments.owner_card+(p.payments.other_card||0):p.amount;
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
   if(name==='quick_ui_v4'){if(__contextFail)return {error:{message:'Список смен временно недоступен'}};if(__contextDelay)await new Promise(resolve=>{window.__contextRelease=resolve});return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:clone(__openShifts)}:null}};
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};
   if(name.includes('warehouse'))return {data:inventory};return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:clone(__openShifts)}};
  await enterApp({id:'auth-test'});shift={id:'current-shift',aId:'nurse-test',a:'Сотрудница Тестовая',bId:'nurse-second',b:'Сотрудница Вторая',type:'08:30–16:00'};show('workspace');
 },role);
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
const writes=page=>page.evaluate(()=>__mixWrites);
async function collection(page,kind='procedure'){
 await page.evaluate(kind=>openSavedPaymentV14(kind,kind==='sale'?'previous-sale':'previous-procedure',1600,'patient-test',true),kind);
 await expect(page.locator('#debtPaymentV10')).toBeVisible();await expect(page.locator('#debtShiftV49')).toBeEnabled();
}
async function collect(page,method='cash'){
 await page.selectOption('#debtMethodV10',method);await page.check('#debtConfirmV10');await page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]').click();
}
for(const kind of ['procedure','sale'])test(`ordinary ${kind} payment after planned end defaults to original still-open shift, ignoring global evening shift`,async({page})=>{
 const errors=await boot(page);await collection(page,kind);await expect(page.locator('#debtShiftV49')).toHaveValue('previous-shift');await expect(page.locator('#debtShiftBoxV49')).toContainText('19.10.2026');await expect(page.locator('#debtShiftBoxV49')).toContainText('08:30–16:00');await expect(page.locator('#debtShiftBoxV49 p')).toContainText('Принимает: Сотрудница Тестовая');
 await collect(page,'other_card');await expect.poll(async()=> (await writes(page)).length).toBe(1);expect((await writes(page))[0].args.p_payload).toMatchObject({shift_id:'previous-shift',nurse_id:'nurse-test',payments:{cash:0,terminal:0,owner_card:0,other_card:1600}});expect((await writes(page))[0].args.p_payload.payment_shift_explicit).toBeUndefined();expect(errors).toEqual([]);
});
test('administrator explicitly chooses another receiving shift and confirmation resets',async({page})=>{
 const errors=await boot(page);await collection(page);await page.check('#debtConfirmV10');await page.selectOption('#debtShiftV49','current-shift');await expect(page.locator('#debtConfirmV10')).not.toBeChecked();await expect(page.locator('#debtShiftBoxV49 p')).toContainText('Вечерняя Медсестра');await collect(page,'terminal');
 await expect.poll(async()=> (await writes(page)).length).toBe(1);expect((await writes(page))[0].args.p_payload).toMatchObject({shift_id:'current-shift',nurse_id:'nurse-evening',payment_shift_explicit:true,payments:{cash:0,terminal:1600,owner_card:0}});expect(errors).toEqual([]);
});
test('closed source never silently falls back to global shift; explicit choice is required',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__openShifts=[__otherShift]});await collection(page);await expect(page.locator('#debtShiftV49')).toHaveValue('');await collect(page,'cash');await expect(page.locator('#debtMessageV10')).toContainText('Выберите, к какой открытой смене');expect(await writes(page)).toHaveLength(0);
 await page.selectOption('#debtShiftV49','current-shift');await collect(page,'owner_card');await expect.poll(async()=> (await writes(page)).length).toBe(1);expect((await writes(page))[0].args.p_payload).toMatchObject({shift_id:'current-shift',payment_shift_explicit:true,payments:{owner_card:1600}});expect(errors).toEqual([]);
});
test('nurse can choose only authorized shifts, with original remaining usable after planned end',async({page})=>{
 const errors=await boot(page,'nurse');await collection(page);await expect(page.locator('#debtShiftV49 option[value="current-shift"]')).toHaveCount(0);await expect(page.locator('#debtShiftV49')).toHaveValue('previous-shift');await collect(page);await expect.poll(async()=> (await writes(page)).length).toBe(1);expect((await writes(page))[0].args.p_payload.nurse_id).toBe('nurse-test');expect(errors).toEqual([]);
});
test('failed context read blocks money, preserves entered method, and supports read-only refresh',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__contextFail=true});await page.evaluate(()=>openSavedPaymentV14('procedure','previous-procedure',1600,'patient-test',true));await expect(page.locator('#debtShiftBoxV49 p')).toContainText('временно недоступен');await collect(page,'terminal');await expect(page.locator('#debtMessageV10')).toContainText('Дождитесь загрузки');expect(await writes(page)).toHaveLength(0);
 await page.evaluate(()=>{__contextFail=false});await page.locator('#debtShiftBoxV49 button').click();await expect(page.locator('#debtShiftV49')).toHaveValue('previous-shift');await expect(page.locator('#debtMethodV10')).toHaveValue('terminal');await page.check('#debtConfirmV10');await page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]').click();await expect.poll(async()=> (await writes(page)).length).toBe(1);expect(errors).toEqual([]);
});
test('server rejection after shift closes keeps draft and never reroutes payment',async({page})=>{
 const errors=await boot(page);await collection(page);await page.evaluate(()=>{__receiptReject=true;__openShifts=[__otherShift]});await collect(page);await expect(page.locator('#debtMessageV10')).toContainText('Выбранная смена уже закрыта');await expect(page.locator('#debtShiftV49')).toHaveValue('previous-shift');expect(await writes(page)).toHaveLength(0);
 await page.locator('#debtShiftBoxV49 button').click();await expect(page.locator('#debtShiftV49')).toHaveValue('');await expect(page.locator('#debtMethodV10')).toHaveValue('cash');expect(errors).toEqual([]);
});
test('uncertain mixed receipt replays original shift, channels and request UUID even after source closes',async({page})=>{
 const errors=await boot(page);await collection(page);await page.selectOption('#debtMethodV10','mixed');await page.fill('#debtCashV43','1200');await page.fill('#debtTerminalV43','');await page.fill('#debtOwnerCardV43','');await page.fill('#debtOtherCardV47','400');await page.evaluate(()=>{__mixLost=true});await page.check('#debtConfirmV10');await page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]').click();await expect(page.locator('#debtMessageV10')).toContainText('Черновик сохранён');
 await page.evaluate(()=>{__openShifts=[__otherShift];openSavedPaymentV14('procedure','previous-procedure',1600,'patient-test',true)});await expect(page.locator('#debtShiftV49')).toBeDisabled();await expect(page.locator('#debtShiftV49')).toHaveValue('previous-shift');await expect(page.locator('#debtShiftBoxV49 p')).toContainText('первоначально выбранную');await page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]').click();
 const calls=await page.evaluate(()=>__mixCalls.filter(call=>call.name==='crm_clinical_v10'&&call.args.p_action==='debt_payment'));expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(await writes(page)).toHaveLength(1);expect(calls[0].args.p_payload).toMatchObject({shift_id:'previous-shift',payments:{cash:1200,other_card:400}});expect(errors).toEqual([]);
});
test('editing a saved procedure with new money uses original open shift rather than global one',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>editTreatmentV10('procedure','previous-procedure'));await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procPaymentStatusV10','paid');await expect(page.locator('#procPaymentShiftBoxV49')).toBeVisible();await expect(page.locator('#procPaymentShiftV49')).toHaveValue('previous-shift');await page.locator('#procPaymentV5 [data-pay-method="terminal"]').click();await page.fill('#procEditReasonV10','Принимаем оплату после процедуры');await page.check('#procPayConfirmed');await page.locator('#procedure button[onclick="saveProcedure()"]').click();
 await expect.poll(async()=> (await writes(page)).length).toBe(1);expect((await writes(page))[0].args.p_payload).toMatchObject({shift_id:'previous-shift',payment_shift_id:'previous-shift',payment_nurse_id:'nurse-test',payments:{terminal:1600}});expect(errors).toEqual([]);
});
test('an unpaid edit can save while receiving shift context is unavailable',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__contextFail=true});await page.evaluate(()=>editTreatmentV10('procedure','previous-procedure'));await expect(page.locator('#procedure')).toBeVisible();await expect(page.locator('#procPaymentShiftBoxV49')).not.toBeVisible();await page.fill('#procNotes','Изменение без оплаты');await page.locator('#procedure button[onclick="saveProcedure()"]').click();await expect.poll(async()=> (await writes(page)).length).toBe(1);expect((await writes(page))[0].args.p_payload).toMatchObject({paid_total:0,payment_status:'pending'});expect((await writes(page))[0].args.p_payload.payment_shift_id).toBeUndefined();expect(errors).toEqual([]);
});
test('true debt repayment stays separate and has no shift selector or payment methods',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openSavedPaymentV14('procedure','previous-procedure',1600,'patient-test',false));await expect(page.locator('#debtShiftV49')).toHaveCount(0);await expect(page.locator('#debtMethodV10')).toHaveCount(0);await page.fill('#debtPurposeV29','Погашение прежнего долга');await page.check('#debtConfirmV10');await page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]').click();await expect.poll(async()=> (await writes(page)).length).toBe(1);const payload=(await writes(page))[0].args.p_payload;expect(payload).toMatchObject({amount:1600,purpose:'Погашение прежнего долга'});expect(payload.shift_id).toBeUndefined();expect(errors).toEqual([]);
});
test('journal payment keeps refresh separate from Back after a failed shift context read',async({page})=>{
 const errors=await boot(page,'nurse');await page.evaluate(async()=>{
  const rpc=db.rpc;db.rpc=async(name,args={})=>name==='crm_shift_journal_v12'?{data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[{shift:__sourceShift,staff:__sourceShift.staff,procedures:[__mixRecords.get('previous-procedure')],sales:[],receipts:[]}]}}:rpc(name,args);
  await openShiftJournalV12('2026-10-19');
 });await expect(page.locator('#shiftJournalV12')).toBeVisible();
 await page.evaluate(()=>{__contextFail=true});await page.locator('#journalBodyV12 [data-event-id="previous-procedure"]').getByRole('button',{name:'Принять оплату',exact:true}).click();await expect(page.locator('#debtPaymentV10')).toBeVisible();await expect(page.locator('#debtShiftBoxV49 p')).toContainText('временно недоступен');
 await page.evaluate(()=>{__contextFail=false});await page.locator('#debtShiftBoxV49 button').click();await expect(page.locator('#debtShiftV49')).toHaveValue('previous-shift');await expect(page.locator('#debtPaymentV10')).toBeVisible();await expect(page.locator('#shiftJournalV12')).not.toBeVisible();expect(await writes(page)).toHaveLength(0);
 await page.locator('#debtBackV49').click();await expect(page.locator('#shiftJournalV12')).toBeVisible();await expect(page.locator('#journalDateV12')).toHaveValue('2026-10-19');await expect(page.locator('#debtPaymentV10')).not.toBeVisible();expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});
