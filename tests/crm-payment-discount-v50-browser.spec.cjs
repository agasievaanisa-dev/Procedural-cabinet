const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Fictional records exercise the real editor and receipt form. Changing the
// amount received must never silently change an agreed patient charge.
async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-19T13:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  const actor={id:role==='nurse'?'nurse-test':'admin-test',full_name:'Сотрудник Проверки',role,active:true};
  const staff=[{id:'nurse-test',full_name:'Первая Медсестра'},{id:'nurse-second',full_name:'Вторая Медсестра'}];
  const opened={id:'source-shift',date:'2026-10-19',started_at:'2026-10-19T05:30:00Z',planned_end_at:'2026-10-19T13:00:00Z',status:'open',staff};
  patients=[{id:'patient-test',full_name:'Пациент Проверки',sex:'male'}];nurses=staff;
  meds=[{id:'medicine-test',name:'Препарат Проверки',consumption_unit:'амп.',sale_price:700,work_qty:0,active:true}];
  services=[{id:'service-test',name:'Капельница',work_price:500,consumables_price:100,active:true}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:0,units_per_package:5,purchase_price:0}));
  window.__discountV50={calls:[],writes:[],replay:new Map(),records:new Map(),contextFail:false,contextDelay:false,lost:false,deferred:false};
  const state=__discountV50,seed={id:'procedure-test',kind:'procedure',editable:true,version:3,shift_id:opened.id,patient_id:'patient-test',patient:'Пациент Проверки',nurse_id:'nurse-test',nurse:'Первая Медсестра',service_id:'service-test',procedure_type:'Капельница',at:'2026-10-19T08:00:00Z',visit_at:'2026-10-19T08:00:00Z',list_total:1300,charge_total:1300,paid_total:0,received_total:0,initial_paid_total:0,debt_total:1300,payment_pending:true,payment_status:'pending',stock_deducted:false,services:[{service_id:'service-test',name:'Капельница',quantity:1,unit_price:600,line_total:600}],items:[{medication_id:'medicine-test',name:'Препарат Проверки',quantity:1,unit:'амп.',unit_price:700,line_total:700}],own_medications:[],payments:{cash:0,terminal:0,owner_card:0},notes:''};
  state.records.set(seed.id,clone(seed));state.records.set('sale-test',{...clone(seed),id:'sale-test',kind:'sale',service_id:null,procedure_type:null,services:[],items:[{...seed.items[0],unit_price:1300,line_total:1300}]});
  const report=()=>({shift:clone(opened),staff,procedures:[clone(state.records.get('procedure-test'))],sales:[clone(state.records.get('sale-test'))],receipts:[],patients_count:1,procedures_count:1,sales_count:1,revenue:{cash:0,terminal:0,owner_card:0,total:0},charge_total:2600,debt_total:0,pending_total:2600,payroll_total:0,payroll_complete:true,payroll_unknown:0,cash_drawer:{opening_confirmed:true,opening:0,received_cash:0,salary_paid:0,balance:0},used:[],stock:[],untracked:[],warnings:[]});
  db.from=()=>{const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:actor})};return q};
  db.rpc=async(name,args={})=>{
   state.calls.push({name,args:clone(args)});
   if(name==='crm_clinical_v10'){
    if(args.p_action==='treatment_get')return {data:clone(state.records.get(args.p_payload.id))};
    if(args.p_action==='patient_treatments')return {data:{procedures:[],sales:[]}};
    if(['debt_payment','treatment_edit'].includes(args.p_action)){
     if(state.replay.has(args.p_request_id))return {data:clone(state.replay.get(args.p_request_id))};
     const p=args.p_payload,record=state.records.get(p.id),previous=record.paid_total;
     if(args.p_action==='debt_payment'){
      const paid=p.payments?['cash','terminal','owner_card','other_card'].reduce((sum,key)=>sum+(p.payments[key]||0),0):p.amount;
      if(paid>record.debt_total)return {error:{code:'P0001',message:'Оплата превышает остаток'}};
      record.paid_total+=paid;record.received_total=record.paid_total;record.debt_total=record.charge_total-record.paid_total;record.payment_pending=record.debt_total>0;
     }else{
      if(p.expected_version!==record.version)return {error:{code:'40001',message:'Запись изменена'}};
      Object.assign(record,clone(p),{paid_total:previous+p.paid_total,received_total:previous+p.paid_total,debt_total:p.charge_total-previous-p.paid_total,payment_pending:p.payment_status==='pending'});
     }
     record.version++;const result=clone(record);state.writes.push(clone(args));state.replay.set(args.p_request_id,result);
     if(state.deferred)await new Promise(resolve=>{window.__discountReleaseV50=resolve});
     if(state.lost){state.lost=false;throw new TypeError('Load failed')}
     return {data:result};
    }
    return {data:[]};
   }
   if(name==='quick_ui_v4'){
    if(state.contextFail)return {error:{message:'Не удалось загрузить смены'}};
    if(state.contextDelay)await new Promise(resolve=>{window.__discountContextReleaseV50=resolve});
    return {data:{favorites:[],recent:[],shifts:[clone(opened)]}};
   }
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[report()]}};
   if(name==='crm_finance_v5')return {data:args.p_action==='accounting_mode'?{payment_only:true,stock_deducted:false}:report()};
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};if(name.includes('warehouse'))return {data:inventory};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};refreshDashboard=async()=>{};refreshOwnerDashboardV5=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'auth-test'});shift={id:'source-shift',aId:'nurse-test',a:'Первая Медсестра',bId:'nurse-second',b:'Вторая Медсестра',type:'08:30–16:00'};show('workspace');
 },role);
 return errors;
}
const writes=page=>page.evaluate(()=>__discountV50.writes);
const save=page=>page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]');
async function openPayment(page,kind='procedure',amount=1300,pending=true){
 await page.evaluate(({kind,amount,pending})=>openSavedPaymentV14(kind,kind==='sale'?'sale-test':'procedure-test',amount,'patient-test',pending),{kind,amount,pending});
 await expect(page.locator('#debtPaymentV10')).toBeVisible();if(pending)await expect(page.locator('#debtEditChargeV50')).toBeEnabled();
}
async function saveEditor(page,prefix='proc'){
 await page.fill('#'+prefix+'Paid','1000');await page.fill('#'+prefix+'DiscountComment','Согласована индивидуальная стоимость');
 const editReason=page.locator('#'+prefix+'EditReasonV10');if(await editReason.isVisible())await editReason.fill('Учтена согласованная скидка');
 await page.check('#'+prefix+'PayConfirmed');
 await page.locator('#'+(prefix==='proc'?'procedure':'sale')+' button[onclick="'+(prefix==='proc'?'saveProcedure()':'saveSale()')+'"]').click();
}

test('a partial waiting payment preserves the agreed bill and explicitly previews the remaining300',async({page})=>{
 const errors=await boot(page);await openPayment(page);await expect(page.locator('#debtChargeV50')).toContainText(/По прайсу:.*1\s*300.*Стоимость для пациента:.*1\s*300/);
 await page.fill('#debtAmountV10','1000');await expect(page.locator('#debtRemainderV50')).toContainText(/Получено сейчас:.*1\s*000.*останется:.*300/);await expect(page.locator('#debtRemainderV50')).toContainText('скидка не применяется автоматически');
 await page.selectOption('#debtMethodV10','terminal');await page.check('#debtConfirmV10');await save(page).click();
 expect(await writes(page)).toHaveLength(1);const record=await page.evaluate(()=>__discountV50.records.get('procedure-test'));expect(record).toMatchObject({charge_total:1300,paid_total:1000,debt_total:300,payment_pending:true});expect((await writes(page))[0].p_payload.charge_total).toBeUndefined();expect(errors).toEqual([]);
});

test('discount editing after partial collection preserves the journal date and makes no newreceipt',async({page})=>{
 const errors=await boot(page,'nurse');await page.evaluate(async()=>{Object.assign(__discountV50.records.get('procedure-test'),{paid_total:1000,received_total:1000,debt_total:300});await openShiftJournalV12('2026-10-19')});
 await page.locator('#journalBodyV12 [data-event-id="procedure-test"]').getByRole('button',{name:'Принять оплату',exact:true}).click();await expect(page.locator('#debtEditChargeV50')).toBeEnabled();await page.click('#debtEditChargeV50');await expect(page.locator('#procedure')).toBeVisible();await expect(page.locator('#procPaid')).toHaveValue('1300.00');
 await saveEditor(page);await expect(page.locator('#shiftJournalV12')).toBeVisible();await expect(page.locator('#journalDateV12')).toHaveValue('2026-10-19');
 const changes=await writes(page);expect(changes).toHaveLength(1);expect(changes[0].p_action).toBe('treatment_edit');expect(changes[0].p_payload).toMatchObject({id:'procedure-test',charge_total:1000,paid_total:0,payments:{cash:0,terminal:0,owner_card:0,cash_received:0}});expect(await page.evaluate(()=>__discountV50.records.get('procedure-test').debt_total)).toBe(0);expect(errors).toEqual([]);
});

test('discount navigation from a sale in a report returns to the same report',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openReportByIdV5('source-shift'));await expect(page.locator('#report')).toBeVisible();await page.evaluate(()=>document.querySelectorAll('#reportBody details').forEach(node=>node.open=true));
 await page.locator('#reportBody [data-event-id="sale-test"]').getByRole('button',{name:'Принять оплату',exact:true}).click();await expect(page.locator('#debtEditChargeV50')).toBeEnabled();await page.click('#debtEditChargeV50');await expect(page.locator('#sale')).toBeVisible();await expect(page.locator('#salePaid')).toHaveValue('1300.00');await saveEditor(page,'sale');
 await expect(page.locator('#report')).toBeVisible();expect((await writes(page))[0].p_payload).toMatchObject({kind:'sale',id:'sale-test',charge_total:1000,paid_total:0,payment_status:'pending'});expect(await page.evaluate(()=>financeReportId5)).toBe('source-shift');expect(errors).toEqual([]);
});

test('changing a receipt draft requires confirmation before opening discount editing',async({page})=>{
 const errors=await boot(page);await openPayment(page);await page.fill('#debtAmountV10','1000');await page.selectOption('#debtMethodV10','other_card');
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain('не будет перенесена');await dialog.dismiss()});await page.click('#debtEditChargeV50');await expect(page.locator('#debtPaymentV10')).toBeVisible();await expect(page.locator('#debtAmountV10')).toHaveValue('1000');await expect(page.locator('#debtMethodV10')).toHaveValue('other_card');expect(await writes(page)).toHaveLength(0);
 page.once('dialog',dialog=>dialog.accept());await page.click('#debtEditChargeV50');await expect(page.locator('#procedure')).toBeVisible();await expect(page.locator('#procReceivedV10')).toHaveValue('0.00');expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('the discount button stays disabled until a fresh source read succeeds',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__discountV50.contextFail=true;openSavedPaymentV14('procedure','procedure-test',1300,'patient-test',true)});await expect(page.locator('#debtShiftBoxV49 p')).toContainText('Не удалось загрузить смены');await expect(page.locator('#debtEditChargeV50')).toBeDisabled();
 await page.evaluate(()=>{__discountV50.contextFail=false;__discountV50.contextDelay=true});await page.locator('#debtShiftBoxV49 button').click();await expect(page.locator('#debtEditChargeV50')).toBeDisabled();await expect.poll(()=>page.evaluate(()=>typeof __discountContextReleaseV50)).toBe('function');await page.evaluate(()=>{__discountV50.contextDelay=false;__discountContextReleaseV50()});await expect(page.locator('#debtEditChargeV50')).toBeEnabled();expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('a read-only source does not offer enabled discount editing',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__discountV50.records.get('procedure-test').editable=false;openSavedPaymentV14('procedure','procedure-test',1300,'patient-test',true)});await expect(page.locator('#debtShiftV49')).toBeEnabled();await expect(page.locator('#debtEditChargeV50')).toBeDisabled();expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('uncertain collection disables discount editing and retries the exact original receipt',async({page})=>{
 const errors=await boot(page);await openPayment(page);await page.selectOption('#debtMethodV10','terminal');await page.evaluate(()=>{__discountV50.lost=true});await page.check('#debtConfirmV10');await save(page).click();await expect(page.locator('#debtMessageV10')).toContainText('Черновик сохранён');await expect(page.locator('#debtEditChargeV50')).toBeDisabled();
 await page.evaluate(()=>openSavedPaymentV14('procedure','procedure-test',1300,'patient-test',true));await expect(page.locator('#debtEditChargeV50')).toBeDisabled();await save(page).click();expect(await writes(page)).toHaveLength(1);const calls=await page.evaluate(()=>__discountV50.calls.filter(call=>call.name==='crm_clinical_v10'&&call.args.p_action==='debt_payment'));expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(errors).toEqual([]);
});

test('saving a receipt disables discount editing until the write has finished',async({page})=>{
 const errors=await boot(page);await openPayment(page);await page.selectOption('#debtMethodV10','cash');await page.evaluate(()=>{__discountV50.deferred=true});await page.check('#debtConfirmV10');await save(page).click();await expect.poll(()=>page.evaluate(()=>typeof __discountReleaseV50)).toBe('function');await expect(page.locator('#debtEditChargeV50')).toBeDisabled();await page.evaluate(()=>__discountReleaseV50());await expect(page.locator('#debtPaymentV10')).not.toBeVisible();expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('true debt repayment has no discount navigation or ordinary charge summary',async({page})=>{
 const errors=await boot(page);await openPayment(page,'procedure',1300,false);await expect(page.locator('#debtEditChargeV50')).toHaveCount(0);await expect(page.locator('#debtChargeV50')).toHaveCount(0);await expect(page.locator('#debtRemainderV50')).toHaveCount(0);await expect(page.locator('#debtPurposeV29')).toBeVisible();expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});
