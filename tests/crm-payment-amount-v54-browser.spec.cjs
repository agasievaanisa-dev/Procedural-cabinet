const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Every person, medicine and ledger entry below is fictional. Browser mocks
// record exact RPC requests; real business invariants are checked by SQL tests.
async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-23T07:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(role=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  currentStaff={id:'amount-'+role,full_name:'Сотрудник Проверки',role,active:true};
  const staff=[{id:'amount-nurse',full_name:'Медсестра Проверки'}],source={id:'amount-source',date:'2026-10-22',status:'closed',started_at:'2026-10-22T05:30:00Z',planned_end_at:'2026-10-22T13:00:00Z',staff};
  shift={id:'amount-current',aId:staff[0].id,a:staff[0].full_name,bId:null,b:''};nurses=staff;
  patients=[{id:'amount-patient',full_name:'Пациент Проверки',sex:'male'}];
  meds=[{id:'amount-med',name:'Препарат Проверки',consumption_unit:'амп.',sale_price:5000,active:true,work_qty:10}];services=[{id:'amount-service',name:'Капельница',work_price:500,consumables_price:100,active:true}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:10,units_per_package:5,purchase_price:0}));
  const seed={kind:'procedure',id:'amount-procedure',editable:true,version:3,shift_id:source.id,patient_id:patients[0].id,patient:patients[0].full_name,nurse_id:staff[0].id,nurse:staff[0].full_name,
   service_id:services[0].id,procedure_type:'Капельница',at:'2026-10-22T06:00:00Z',visit_at:'2026-10-22T06:00:00Z',list_total:5600,charge_total:5600,discount_amount:0,
   initial_paid_total:0,paid_total:5600,received_total:5600,debt_total:0,loan_debt_total:0,pending_total:0,payment_pending:false,payment_status:'paid',stock_deducted:false,
   services:[{service_id:services[0].id,name:'Капельница',quantity:1,line_total:600,work_price:500,consumables_price:100}],items:[{medication_id:meds[0].id,name:meds[0].name,quantity:1,unit:'амп.',unit_price:5000,line_total:5000}],own_medications:[],payments:{cash:0,terminal:5600,owner_card:0,other_card:0},notes:'Сохранённый состав'};
  window.__amountRecords=new Map([[seed.id,clone(seed)],['amount-sale',{...clone(seed),id:'amount-sale',kind:'sale',patient_id:null,patient:'Без пациента',initial_paid_total:5600,services:[],service_id:null}]]);
  window.__amountEvents=new Map([...__amountRecords.values()].map(record=>[record.id,[{event_type:record.kind==='sale'?'allocation':'receipt',id:'event-'+record.id,amount:5600,cash:0,terminal:5600,owner_card:0,other_card:0,unclassified:0,cash_received:0,change:0,created_at:'2026-10-22T07:00:00Z',shift_id:source.id,nurse_id:staff[0].id}]]));
  window.__amountCalls=[];window.__amountWrites=[];window.__amountReplay=new Map();window.__amountLost=false;window.__amountDeferred=false;window.__amountReadFail=false;window.__amountReportFail=0;window.__amountMalformed=false;
  const money=records=>{const out={cash:0,terminal:0,owner_card:0,other_card:0,unclassified:0,total:0};for(const record of records)for(const key of ['cash','terminal','owner_card','other_card'])out[key]+=record.payments[key]||0;out.total=out.cash+out.terminal+out.owner_card+out.other_card;return out};
  window.__amountReport=()=>{
   const procedures=[__amountRecords.get('amount-procedure')],sales=[__amountRecords.get('amount-sale')],revenue=money(procedures),saleMoney=money(sales),p=procedures[0],s=sales[0];
   return {sales_separate:true,revenue_scope:'procedures',shift:source,staff:staff.map(s=>({...s,amount:0})),procedures,sales,receipts:[],patients_count:1,procedures_count:1,sales_count:1,
    revenue,charge_total:p.charge_total,debt_total:p.loan_debt_total,loan_debt_total:p.loan_debt_total,pending_total:p.pending_total,payroll_total:0,payroll_complete:true,payroll_unknown:0,
    sales_summary:{sales_count:1,revenue:saleMoney,charge_total:s.charge_total,debt_total:s.loan_debt_total,loan_debt_total:s.loan_debt_total,pending_total:s.pending_total},
    cash_drawer:{opening_confirmed:true,opening:0,received_cash:revenue.cash,salary_paid:0,balance:revenue.cash},used:[],stock:[],untracked:[],warnings:[]};
  };
  const snapshot=id=>{const record=__amountRecords.get(id);return {id,kind:record.kind,version:record.version,treatment:clone(record),events:clone(__amountEvents.get(id)||[]),debt_repayments_excluded:true,debt_repayments_total:0,amount_correction_available:true}};
  db.rpc=async(name,args={})=>{
   __amountCalls.push({name,args:clone(args)});
   if(name==='crm_payment_amount_v54'){
    if(args.p_action==='get'){if(__amountReadFail)return {error:{code:'P0001',message:'Не удалось прочитать сохранённую оплату'}};return {data:snapshot(args.p_payload.id)}}
    if(__amountReplay.has(args.p_request_id))return {data:clone(__amountReplay.get(args.p_request_id))};
    const p=args.p_payload,record=__amountRecords.get(p.id),event=__amountEvents.get(p.id).find(e=>e.id===p.event_id);
    if(p.expected_version!==record.version)return {error:{code:'40001',message:'Запись уже изменена. Откройте её заново'}};
    const previousAmount=event.amount,previousCharge=record.charge_total,amount=['cash','terminal','owner_card','other_card'].reduce((sum,key)=>sum+(p.payments[key]||0),0);
    Object.assign(event,clone(p.payments),{amount,unclassified:0});if(amount===0)__amountEvents.set(p.id,__amountEvents.get(p.id).filter(e=>e.id!==event.id));
    record.payments=Object.fromEntries(['cash','terminal','owner_card','other_card'].map(key=>[key,__amountEvents.get(p.id).reduce((sum,e)=>sum+(e[key]||0),0)]));
    record.received_total=record.paid_total=Object.values(record.payments).reduce((sum,v)=>sum+v,0);record.charge_total=p.charge_total??record.charge_total;
    record.discount_amount=Math.max(0,record.list_total-record.charge_total);record.debt_total=Math.max(0,record.charge_total-record.received_total);record.payment_pending=record.debt_total>0&&p.remaining_status==='pending';
    record.pending_total=record.payment_pending?record.debt_total:0;record.loan_debt_total=record.payment_pending?0:record.debt_total;if(event.event_type==='allocation')record.initial_paid_total=amount;record.version++;
    const result={...snapshot(p.id),request_id:args.p_request_id,amount_corrected:true,corrected_event_type:p.event_type,corrected_event_id:p.event_id,previous_amount:previousAmount,corrected_amount:amount,previous_charge_total:previousCharge,charge_total:record.charge_total};
    __amountReplay.set(args.p_request_id,clone(result));__amountWrites.push({name,args:clone(args)});
    if(__amountDeferred)await new Promise(resolve=>{window.__amountRelease=resolve});
    if(__amountLost){__amountLost=false;throw new TypeError('Load failed')}
    return {data:__amountMalformed?{id:p.id}:result};
   }
   if(name==='crm_finance_v5'){if(args.p_action==='accounting_mode')return {data:{payment_only:true}};if(args.p_action==='shift_report'&&__amountReportFail>0){__amountReportFail--;return {error:{code:'P0001',message:'Не удалось обновить отчёт'}}}return {data:clone(__amountReport())}}
   if(name==='crm_clinical_v10'){if(args.p_action==='treatment_get')return {data:clone(__amountRecords.get(args.p_payload.id))};return {data:[]}}
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,reports:[clone(__amountReport())]}};
   return {data:[]};
  };
  window.print=()=>{};show('workspace');renderShiftReportV5(clone(__amountReport()),false);
 },role);return errors;
}
const writes=page=>page.evaluate(()=>__amountWrites);
async function openAmount(page,kind='procedure'){
 const summary=page.locator('#reportBody details > summary').filter({hasText:kind==='sale'?/^Продажи отдельно \(/:/^Процедуры \(/});
 const details=summary.locator('..');
 if(await details.getAttribute('open')===null)await summary.click();
 await page.locator(`#reportBody [data-event-id="amount-${kind}"]`).getByRole('button',{name:'Исправить сумму оплаты',exact:true}).click();
 await expect(page.locator('[data-financial-amount]')).toBeVisible();
}
async function confirm(page){await page.fill('[data-financial-reason]','Уточнили фактический расчёт');await page.check('[data-financial-confirm]')}

for(const role of ['admin','owner'])test(`${role}: correct ordinary terminal receipt to final boss-card settlement and return to its original shift`,async({page})=>{
 const errors=await boot(page,role);await openAmount(page);
 await expect(page.locator('[data-financial-method]')).toHaveValue('terminal');await expect(page.locator('[data-financial-amount]')).toHaveValue('5600.00');
 await expect(page.locator('[data-financial-amount]')).toHaveJSProperty('readOnly',false);
 await page.fill('[data-financial-amount]','5500');await page.selectOption('[data-financial-method]','owner_card');await page.fill('[data-financial-charge]','5500');
 await expect(page.locator('[data-financial-after-balance]')).toContainText(/0\s*₽/);await expect(page.locator('[data-financial-after-discount]')).toContainText(/100\s*₽/);
 await confirm(page);await page.click('[data-financial-save]');await expect(page.locator('#report')).toBeVisible();
 const out=(await writes(page))[0].args.p_payload;
 expect(out).toMatchObject({kind:'procedure',id:'amount-procedure',event_type:'receipt',event_id:'event-amount-procedure',expected_version:3,
  expected_payments:{cash:0,terminal:5600,owner_card:0,other_card:0,unclassified:0},payments:{cash:0,terminal:0,owner_card:5500,other_card:0,cash_received:0},charge_total:5500,confirmed:true});
 expect(out.shift_id).toBeUndefined();expect(out.remaining_status).toBeUndefined();
 await expect(page.locator('#reportBody [data-event-id="amount-procedure"]')).toContainText(/5\s*500/);await expect(page.locator('#reportBody')).toContainText(/карт.*начальника/i);
 expect(await page.evaluate(()=>__amountRecords.get('amount-procedure').debt_total)).toBe(0);expect(errors).toEqual([]);
});

test('amount and final-cost fields can stay empty and accept a decimal comma without restoring old digits',async({page})=>{
 const errors=await boot(page);await openAmount(page);
 await page.fill('[data-financial-amount]','');await page.locator('[data-financial-amount]').press('Tab');await expect(page.locator('[data-financial-amount]')).toHaveValue('');
 await page.fill('[data-financial-charge]','');await page.locator('[data-financial-charge]').press('Tab');await expect(page.locator('[data-financial-charge]')).toHaveValue('');
 await page.fill('[data-financial-amount]','5500,50');await page.fill('[data-financial-charge]','5500,50');await confirm(page);await page.click('[data-financial-save]');
 await expect(page.locator('#report')).toBeVisible();expect((await writes(page))[0].args.p_payload).toMatchObject({payments:{terminal:5500.5},charge_total:5500.5});expect(errors).toEqual([]);
});

test('selecting one later receipt keeps another initial payment in the aggregate preview and correction',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{
  const record=__amountRecords.get('amount-procedure'),receipt=__amountEvents.get(record.id)[0];
  record.initial_paid_total=1000;record.payments={cash:1000,terminal:4600,owner_card:0,other_card:0};
  receipt.amount=receipt.terminal=4600;
  __amountEvents.set(record.id,[{...receipt,id:'initial-amount-procedure',event_type:'allocation',amount:1000,cash:1000,terminal:0,created_at:'2026-10-22T06:00:00Z'},receipt]);
  renderShiftReportV5(__amountReport(),false);
 });
 await openAmount(page);await expect(page.locator('[data-financial-amount]')).toHaveValue('1000.00');
 await page.selectOption('[data-financial-event]','event-amount-procedure');await expect(page.locator('[data-financial-amount]')).toHaveValue('4600.00');await expect(page.locator('[data-financial-method]')).toHaveValue('terminal');
 await page.fill('[data-financial-amount]','4500');await page.fill('[data-financial-charge]','5500');await expect(page.locator('[data-financial-after-paid]')).toContainText(/5\s*500/);
 await confirm(page);await page.click('[data-financial-save]');await expect(page.locator('#report')).toBeVisible();
 expect((await writes(page))[0].args.p_payload).toMatchObject({event_type:'receipt',event_id:'event-amount-procedure',expected_payments:{cash:0,terminal:4600},payments:{cash:0,terminal:4500},charge_total:5500});
 expect(await page.evaluate(()=>__amountRecords.get('amount-procedure').initial_paid_total)).toBe(1000);expect(errors).toEqual([]);
});

test('changing a payment alone shows a waiting balance and full-settlement helper explicitly adjusts final cost',async({page})=>{
 const errors=await boot(page);await openAmount(page);await page.fill('[data-financial-amount]','5500');
 await expect(page.locator('[data-financial-charge]')).toHaveValue('5600.00');await expect(page.locator('[data-financial-after-balance]')).toContainText(/100\s*₽/);
 await expect(page.locator('[data-financial-remaining-status]')).toHaveValue('pending');
 await page.click('[data-financial-settled]');await expect(page.locator('[data-financial-charge]')).toHaveValue('5500.00');await expect(page.locator('[data-financial-after-balance]')).toContainText(/0\s*₽/);
 expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});

for(const status of ['pending','debt'])test(`an intentionally unpaid difference is saved explicitly as ${status}`,async({page})=>{
 const errors=await boot(page);await openAmount(page);await page.fill('[data-financial-amount]','5500');await page.selectOption('[data-financial-remaining-status]',status);await confirm(page);await page.click('[data-financial-save]');
 await expect(page.locator('#report')).toBeVisible();expect((await writes(page))[0].args.p_payload).toMatchObject({charge_total:5600,remaining_status:status});expect(errors).toEqual([]);
});

test('mixed correction preserves each channel, validates the exact new total and refreshes confirmation',async({page})=>{
 const errors=await boot(page);await openAmount(page);await page.fill('[data-financial-amount]','5500');await page.fill('[data-financial-charge]','5500');await page.selectOption('[data-financial-method]','mixed');
 await page.fill('[data-channel="cash"]','2000');await page.fill('[data-channel="terminal"]','1500');await page.fill('[data-channel="owner_card"]','1000');await page.fill('[data-channel="other_card"]','900');
 await confirm(page);await page.click('[data-financial-save]');await expect(page.locator('[data-financial-message]')).toContainText(/Распределите|сумм/i);expect(await writes(page)).toHaveLength(0);
 await page.fill('[data-channel="other_card"]','1000');await expect(page.locator('[data-financial-confirm]')).not.toBeChecked();await page.fill('[data-financial-tender]','2500');await confirm(page);await page.click('[data-financial-save]');
 await expect(page.locator('#report')).toBeVisible();expect((await writes(page))[0].args.p_payload.payments).toEqual({cash:2000,terminal:1500,owner_card:1000,other_card:1000,cash_received:2500});expect(errors).toEqual([]);
});

test('reason and confirmation are required only for the explicit correction action',async({page})=>{
 const errors=await boot(page);await openAmount(page);await page.click('[data-financial-save]');await expect(page.locator('[data-financial-message]')).toContainText('причину');
 await page.fill('[data-financial-reason]','Исправление ошибочно записанной суммы');await page.click('[data-financial-save]');await expect(page.locator('[data-financial-message]')).toContainText('подтверждение');
 await page.check('[data-financial-confirm]');await page.fill('[data-financial-charge]','5500');await expect(page.locator('[data-financial-confirm]')).not.toBeChecked();expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('anonymous standalone sale correction remains separate from procedure income and cash',async({page})=>{
 const errors=await boot(page);await openAmount(page,'sale');await expect(page.locator('#financialToolsV51')).toContainText('Без пациента');
 await page.fill('[data-financial-amount]','5500');await page.fill('[data-financial-charge]','5500');await page.selectOption('[data-financial-method]','cash');await confirm(page);await page.click('[data-financial-save]');
 await expect(page.locator('#report')).toBeVisible();expect((await writes(page))[0].args.p_payload).toMatchObject({kind:'sale',event_type:'allocation',payments:{cash:5500,cash_received:5500}});
 await expect(page.locator('#reportBody .shift-financial-summary-v16 [data-summary-key="cash"]')).toContainText(/0\s*₽/);
 await expect(page.locator('#reportBody [data-sales-summary-key="cash"]').first()).toContainText(/5\s*500/);expect(errors).toEqual([]);
});

test('zero correction can void a fully incorrect receipt without receiving new money',async({page})=>{
 const errors=await boot(page);await openAmount(page);await page.fill('[data-financial-amount]','0');await page.fill('[data-financial-charge]','0');await confirm(page);await page.click('[data-financial-save]');
 await expect(page.locator('#report')).toBeVisible();expect((await writes(page))[0].args.p_payload).toMatchObject({payments:{cash:0,terminal:0,owner_card:0,other_card:0},charge_total:0});expect(errors).toEqual([]);
});

test('uncertain correction freezes amount, method and UUID and retries the same request once',async({page})=>{
 const errors=await boot(page);await openAmount(page);await page.fill('[data-financial-amount]','5500');await page.fill('[data-financial-charge]','5500');await page.selectOption('[data-financial-method]','owner_card');await confirm(page);
 await page.evaluate(()=>{__amountLost=true});await page.click('[data-financial-save]');await expect(page.locator('[data-financial-message]')).toContainText('первоначальное');
 await expect(page.locator('[data-financial-amount]')).toBeDisabled();await expect(page.locator('[data-financial-charge]')).toBeDisabled();await expect(page.locator('[data-financial-method]')).toBeDisabled();await expect(page.locator('[data-financial-back]')).toBeDisabled();
 await page.click('[data-financial-save]');await expect(page.locator('#report')).toBeVisible();const calls=await page.evaluate(()=>__amountCalls.filter(c=>c.name==='crm_payment_amount_v54'&&c.args.p_action==='save'));
 expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('an unconfirmed acknowledgement offers an exact retry instead of claiming success',async({page})=>{
 const errors=await boot(page);await openAmount(page);await confirm(page);await page.evaluate(()=>{__amountMalformed=true});await page.click('[data-financial-save]');
 await expect(page.locator('[data-financial-message]')).toContainText('первоначальное');await expect(page.locator('#financialToolsV51')).toBeVisible();expect(await writes(page)).toHaveLength(1);
 await page.click('[data-financial-save]');await expect(page.locator('#report')).toBeVisible();expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('a committed correction followed by a refresh failure only retries the original report read',async({page})=>{
 const errors=await boot(page);await openAmount(page);await confirm(page);await page.evaluate(()=>{__amountReportFail=2});await page.click('[data-financial-save]');
 await expect(page.locator('#reportEditMessageV46')).toContainText('уже сохранены');await page.locator('#reportEditRetryV46').click();await expect(page.locator('#report')).toBeVisible();expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('nurses cannot see or directly open amount correction',async({page})=>{
 const errors=await boot(page,'nurse');await expect(page.getByRole('button',{name:'Исправить сумму оплаты',exact:true,includeHidden:true})).toHaveCount(0);
 await page.evaluate(()=>openPaymentAmountV54('procedure','amount-procedure'));await expect(page.locator('#financialToolsV51')).toHaveCount(0);
 expect(await page.evaluate(()=>__amountCalls.filter(c=>c.name==='crm_payment_amount_v54').length)).toBe(0);expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('a late correction after navigation does not reopen its original shift',async({page})=>{
 const errors=await boot(page);await openAmount(page);await confirm(page);await page.evaluate(()=>{__amountDeferred=true});await page.click('[data-financial-save]');
 await page.waitForFunction(()=>typeof __amountRelease==='function');await page.evaluate(()=>{show('workspace');__amountRelease()});await expect(page.locator('#workspace')).toBeVisible();expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});
