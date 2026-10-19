const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// The three records deliberately have the same numeric outstanding balance
// shape. Only the saved payment state distinguishes waiting at the cabinet
// from an actual loan. Separate repayments never enter the synthetic shift.
async function boot(page,{role='admin',open=true}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-15T09:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async({role,open})=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  const staff=[{id:'nurse-1',full_name:'Наталья',amount:2000},{id:'nurse-2',full_name:'Лилия',amount:2000}];
  const opened={id:'shift-1',date:'2026-10-15',started_at:'2026-10-15T05:30:00Z',planned_end_at:'2026-10-15T13:00:00Z',status:'open',staff};
  currentStaff={id:role==='nurse'?'nurse-1':'admin-1',full_name:role==='nurse'?'Наталья':'Аниса',role,active:true};
  window.__ledgerCalls=[];window.__ledgerEffects=[];window.__ledgerReplay=new Map();window.__ledgerLost=false;window.__ledgerHold=false;window.__ledgerRejected=null;
  const record=(id,status,kind,charge)=>({id,kind,editable:true,version:2,shift_id:'shift-1',patient_id:kind==='procedure'?'patient-1':null,patient:kind==='procedure'?'Анна':'Продажа без пациента',nurse_id:'nurse-1',nurse:'Наталья',at:'2026-10-15T07:00:00Z',visit_at:'2026-10-15T07:00:00Z',procedure_type:kind==='procedure'?'Капельница':undefined,list_total:charge,charge_total:charge,paid_total:0,received_total:0,initial_paid_total:0,debt_total:charge,loan_debt_total:status==='debt'?charge:0,pending_total:status==='pending'?charge:0,payment_pending:status==='pending',payment_status:status,stock_deducted:false,services:kind==='procedure'?[{service_id:'service-1',name:'Капельница',quantity:1,work_price:charge,consumables_price:0,unit_price:charge,line_total:charge}]:[],items:kind==='sale'?[{medication_id:'med-1',name:'Препарат по сохранённой цене',quantity:1,unit:'амп.',unit_price:charge,line_total:charge}]:[],own_medications:[],payments:{cash:0,terminal:0,owner_card:0},notes:''});
  window.__ledgerRecords=[record('waiting','pending','procedure',900),record('loan-procedure','debt','procedure',1000),record('loan-sale','debt','sale',300)];
  window.__ledgerHistory=[{id:'old-repayment',kind:'procedure',record_id:'old-procedure',amount:12000,paid_total:12000,paid_on:'2026-10-14',at:'2026-10-14T09:00:00Z',purpose:'Старая капельница <img src=x>',patient:'Пациент из истории',comment:'Не относится к смене'}];
  window.__ledgerReport={shift:opened,staff,patients_count:1,procedures_count:2,sales_count:1,procedures:__ledgerRecords.filter(x=>x.kind==='procedure'),sales:__ledgerRecords.filter(x=>x.kind==='sale'),receipts:[],revenue:{cash:6800,terminal:1200,owner_card:500,total:8500},charge_total:10700,debt_total:2200,loan_debt_total:1300,pending_total:900,payroll_total:4000,payroll_complete:true,payroll_unknown:0,cash_after_salary:4500,cash_drawer:{opening_confirmed:true,opening:500,received_cash:6800,salary_paid:2000,cash_in:0,cash_out:300,balance:5000,movements:[],payroll:[{staff_id:'nurse-1',staff_name:'Наталья',configured:2000,paid:2000,outstanding:0},{staff_id:'nurse-2',staff_name:'Лилия',configured:2000,paid:0,outstanding:2000}]},used:[],stock:[],untracked:[],warnings:[]};
  window.__ledgerSummary={...clone(__ledgerReport),from:'2026-10-15',to:'2026-10-15',time_zone:'Europe/Moscow',rows:[],shifts:[opened]};
  patients=[{id:'patient-1',full_name:'Анна',sex:'female'}];nurses=staff;meds=[{id:'med-1',name:'Препарат из прайса',sale_price:9999,consumption_unit:'амп.',work_qty:0,active:true}];inventory=[];services=[{id:'service-1',name:'Капельница',work_price:9999,consumables_price:0,active:true}];
  db.rpc=async(name,args={})=>{
   __ledgerCalls.push({name,args:clone(args)});const p=args.p_payload||{},action=args.p_action;
   if(name==='crm_clinical_v10'){
    if(action==='treatment_get')return {data:clone(__ledgerRecords.find(x=>x.id===p.id))};
    if(action==='patient_treatments')return {data:{procedures:clone(__ledgerRecords.filter(x=>x.kind==='procedure')),sales:[]}};
    if(action==='debts')return {data:{debts:clone(__ledgerRecords.filter(x=>x.payment_status==='debt'))}};
    if(action==='debt_history')return {data:{items:clone(__ledgerHistory)}};
    if(action==='debt_payment'){
     if(__ledgerRejected)return {error:__ledgerRejected,status:400};
     let result=__ledgerReplay.get(args.p_request_id);
     if(!result){
      const record=__ledgerRecords.find(x=>x.id===p.id),paid=p.amount??((p.payments?.cash||0)+(p.payments?.terminal||0)+(p.payments?.owner_card||0));
      result={id:'repayment-'+(__ledgerEffects.length+1),record_id:p.id,kind:p.kind,amount:paid,paid_total:paid,debt_total:record.debt_total-paid,paid_on:p.paid_on,purpose:p.purpose};
      __ledgerEffects.push({name,args:clone(args)});__ledgerReplay.set(args.p_request_id,clone(result));
      if(record.payment_pending){__ledgerReport.cash_drawer.received_cash+=p.payments.cash||0;__ledgerReport.cash_drawer.balance+=p.payments.cash||0;__ledgerReport.pending_total-=paid;__ledgerReport.receipts.push({...clone(result),receipt_kind:'pending_payment',at:'2026-10-15T09:30:00Z',payments:clone(p.payments)});for(const method of ['cash','terminal','owner_card'])__ledgerReport.revenue[method]+=p.payments[method]||0;__ledgerReport.revenue.total+=paid;record.payment_pending=false}
      else {__ledgerReport.loan_debt_total-=paid;__ledgerHistory.push({...clone(result),at:'2026-10-15T09:30:00Z',patient:record.patient})}
      record.received_total+=paid;record.debt_total-=paid;record.payment_status=record.debt_total?'debt':'paid';
     }
     if(__ledgerHold){__ledgerHold=false;await new Promise(resolve=>window.__releaseLedger=resolve)}
     if(__ledgerLost){__ledgerLost=false;throw new TypeError('Load failed')}
     return {data:clone(result)};
    }
    return {data:[]};
   }
   if(name==='crm_debt_ledger_v29'){
    if(!['admin','owner'].includes(currentStaff?.role))return {error:{code:'42501',message:'Нет доступа'}};
    if(action==='history'||action==='list')return {data:{items:clone(__ledgerHistory)}};
   }
   if(name==='crm_finance_v5')return {data:action==='accounting_mode'?{payment_only:true,stock_deducted:false}:action==='summary'?clone(__ledgerSummary):clone(__ledgerReport)};
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[clone(__ledgerReport)]}};
   if(name==='get_my_open_shift_v82')return {data:open?opened:null};
   if(name==='work_catalog_v2')return {data:clone(meds)};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};
   if(name==='quick_ui_v4')return {data:action==='context'?{favorites:[],recent:[],shifts:open?[opened]:[]}:null};
   return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadServices=async()=>{};loadMeds=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:open?[opened]:[]}};
  refreshDashboard=async()=>{};refreshOwnerDashboardV5=async()=>{};
  shift=open?{id:'shift-1',aId:'nurse-1',a:'Наталья',bId:'nurse-2',b:'Лилия',type:'08:30–16:00'}:null;
  setAccountingModeV5({payment_only:true,stock_deducted:false});renderCabinetHomeV5();show('workspace');
 },{role,open});
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
const payButton=page=>page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]');
const mutations=page=>page.evaluate(()=>__ledgerEffects);
const paymentCalls=page=>page.evaluate(()=>__ledgerCalls.filter(x=>x.name==='crm_clinical_v10'&&x.args.p_action==='debt_payment'));
async function openLoan(page,kind='sale',id='loan-sale',amount=300){await page.evaluate(({kind,id,amount})=>openSavedPaymentV14(kind,id,amount,null,false),{kind,id,amount});await expect(page.locator('#debtPaymentV10')).toBeVisible()}
async function loanFields(page,{amount='200',date='2026-10-15',purpose='Продажа препарата без пациента'}={}){await page.fill('#debtAmountV10',amount);await page.fill('#debtDateV29',date);await page.fill('#debtPurposeV29',purpose);await page.check('#debtConfirmV10')}

test('waiting after the drip is displayed as waiting, while actual procedure and sale loans remain debt',async({page})=>{
 const errors=await boot(page,{role:'nurse'});await page.evaluate(()=>openShiftJournalV12('2026-10-15'));
 const waiting=page.locator('[data-event-id="waiting"]'),loan=page.locator('[data-event-id="loan-procedure"]'),sale=page.locator('[data-event-id="loan-sale"]');
 await expect(waiting).toContainText('Ожидает оплаты');await expect(waiting).not.toContainText('В долг');await expect(waiting).not.toContainText('Погашение долга');
 await expect(loan).toContainText('Долг');await expect(sale).toContainText('Долг');
 await waiting.getByRole('button',{name:'Принять оплату',exact:true}).click();await expect(page.locator('#debtPaymentV10 h1')).toHaveText('Оплата процедуры');await expect(page.locator('#debtMethodV10')).toBeVisible();await expect(page.locator('#debtDateV29')).toHaveCount(0);await expect(page.locator('#debtPurposeV29')).toHaveCount(0);expect(errors).toEqual([]);
});

test('ordinary after-procedure payment keeps its method and current shift, and changes only ordinary receipts',async({page})=>{
 const errors=await boot(page,{role:'nurse'});await page.evaluate(()=>openSavedPaymentV14('procedure','waiting',900,null,true));await page.selectOption('#debtMethodV10','terminal');await page.check('#debtConfirmV10');await payButton(page).click();await expect(page.locator('#workspace')).toBeVisible();
 const calls=await paymentCalls(page);expect(calls).toHaveLength(1);expect(calls[0].args.p_payload).toMatchObject({id:'waiting',kind:'procedure',shift_id:'shift-1',nurse_id:'nurse-1',payments:{cash:0,terminal:900,owner_card:0,cash_received:0}});expect(calls[0].args.p_payload).not.toHaveProperty('purpose');
 const state=await page.evaluate(()=>({revenue:__ledgerReport.revenue,receipts:__ledgerReport.receipts.length,history:__ledgerHistory.length}));expect(state).toEqual({revenue:{cash:6800,terminal:2100,owner_card:500,total:9400},receipts:1,history:1});expect(errors).toEqual([]);
});

test('ordinary waiting payment still requires an open shift without silently becoming a debt repayment',async({page})=>{
 const errors=await boot(page,{role:'nurse',open:false});await page.evaluate(()=>openSavedPaymentV14('procedure','waiting',900,null,true));await expect(page.locator('#debtShiftBoxV49 p')).toContainText('Нет доступных открытых смен. Откройте смену');await page.check('#debtConfirmV10');await payButton(page).click();await expect(page.locator('#debtMessageV10')).toContainText('Выберите, к какой открытой смене отнести оплату');expect(await mutations(page)).toHaveLength(0);expect(errors).toEqual([]);
});

for(const role of ['admin','nurse'])test(`${role} records an anonymous sale loan repayment without any shift or ordinary money method`,async({page})=>{
 const errors=await boot(page,{role,open:false});await openLoan(page);await expect(page.locator('#debtPaymentV10 h1')).toHaveText('Погашение долга');await expect(page.locator('#debtMethodV10')).toHaveCount(0);await expect(page.locator('#debtTenderV10')).toHaveCount(0);await expect(page.locator('#debtDateV29')).toHaveValue('2026-10-15');await loanFields(page);await payButton(page).click();await expect(page.locator('#workspace')).toBeVisible();
 const calls=await paymentCalls(page);expect(calls).toHaveLength(1);expect(calls[0].args.p_payload).toMatchObject({kind:'sale',id:'loan-sale',amount:200,paid_on:'2026-10-15',purpose:'Продажа препарата без пациента'});for(const key of ['shift_id','nurse_id','payments'])expect(calls[0].args.p_payload).not.toHaveProperty(key);
 expect(await page.evaluate(()=>__ledgerReport.revenue)).toEqual({cash:6800,terminal:1200,owner_card:500,total:8500});expect(await page.evaluate(()=>__ledgerReport.receipts)).toHaveLength(0);expect(await page.evaluate(()=>__ledgerHistory)).toHaveLength(2);expect(errors).toEqual([]);
});

test('debt ledger requires a nonzero amount, exact date, purpose and payment confirmation',async({page})=>{
 const errors=await boot(page,{open:false});await openLoan(page);await page.fill('#debtAmountV10','0');await page.check('#debtConfirmV10');await payButton(page).click();await expect(page.locator('#debtMessageV10')).toContainText(/больше нуля/);expect(await mutations(page)).toHaveLength(0);
 await page.fill('#debtAmountV10','200');await page.fill('#debtPurposeV29',' ');await page.check('#debtConfirmV10');await payButton(page).click();await expect(page.locator('#debtMessageV10')).toContainText(/за что|назначен|оплачен|описани/i);expect(await mutations(page)).toHaveLength(0);
 await page.fill('#debtPurposeV29','Продажа лекарства');await page.fill('#debtDateV29','');await page.check('#debtConfirmV10');await payButton(page).click();await expect(page.locator('#debtMessageV10')).toContainText(/дат/);expect(await mutations(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('lost loan acknowledgement replays the exact original UUID and amount/date/purpose once',async({page})=>{
 const errors=await boot(page,{open:false});await openLoan(page);await loanFields(page,{purpose:'Феринжект, прежняя продажа'});await page.evaluate(()=>{__ledgerLost=true});await payButton(page).click();await expect(page.locator('#debtMessageV10')).toContainText(/Черновик сохранён|не подтвержден|Повтор/i);await expect(page.locator('#debtAmountV10')).toBeDisabled();await expect(page.locator('#debtDateV29')).toBeDisabled();await expect(page.locator('#debtPurposeV29')).toBeDisabled();
 await page.evaluate(()=>{document.getElementById('debtAmountV10').value='1';document.getElementById('debtDateV29').value='2026-01-01';document.getElementById('debtPurposeV29').value='Подмена'});await payButton(page).click();await expect(page.locator('#workspace')).toBeVisible();const attempts=await paymentCalls(page);expect(attempts).toHaveLength(2);expect(attempts[0].args.p_request_id).toBeTruthy();expect(attempts[1].args).toEqual(attempts[0].args);expect(await mutations(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('compact shift summary and PDF separate real debt from waiting and show actual cash instead of all-method revenue less salary',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>renderShiftReportV5(__ledgerReport,true));const report=page.locator('#reportBody'),summary=report.locator('.shift-financial-summary-v16');
 const labels={revenue:'Получено за смену',terminal:'Оплата терминалом','owner-card':'Переводы на карту',loan:'Долг',cash:'Наличные за смену','payroll-total':'Зарплата за смену','cash-balance':'Остаток наличных в кассе'};
 for(const [key,label] of Object.entries(labels))await expect(summary.locator(`[data-summary-key="${key}"]`)).toContainText(label);
 for(const [key,value] of Object.entries({revenue:'8 500',terminal:'1 200','owner-card':'500',loan:'1 300',cash:'6 800','payroll-total':'4 000','cash-balance':'5 000'}))await expect(summary.locator(`[data-summary-key="${key}"]`)).toContainText(new RegExp(value.replace(/ /g,'\\s*')));
 await expect(summary.locator('[data-summary-key="loan"]')).not.toContainText(/2\s*200/);await expect(summary.locator('[data-summary-key="cash-balance"]')).not.toContainText(/4\s*500/);
 const pdf=await page.evaluate(()=>buildShiftPrintV5(__ledgerReport));expect(pdf).toContain('Ожидает оплаты');expect(pdf).not.toContain('Погашение долга');expect(pdf).not.toContain('Старая капельница');expect(pdf).toContain('Остаток наличных в кассе');expect(pdf).not.toContain('Выручка после зарплаты');expect(errors).toEqual([]);
});

test('unknown opening cash is not invented from noncash revenue and accrued salary',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__ledgerReport.cash_drawer={opening_confirmed:false,opening:null,received_cash:6800,salary_paid:2000,cash_in:0,cash_out:300,balance:null,movements:[],payroll:[]};renderShiftReportV5(__ledgerReport,true)});const balance=page.locator('#reportBody [data-summary-key="cash-balance"]');await expect(balance).toContainText('Не рассчитан');await expect(balance).not.toContainText(/4\s*500/);expect(errors).toEqual([]);
});

test('manager repayment history shows only amount, date and purpose with escaped text; nurse cannot open the full ledger',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openDebtHistoryV29());await expect(page.locator('#debtHistoryV29Screen')).toBeVisible();await expect(page.locator('#debtHistoryBodyV29')).toContainText(/12\s*000/);await expect(page.locator('#debtHistoryBodyV29')).toContainText('Старая капельница <img src=x>');expect(await page.locator('#debtHistoryBodyV29 img').count()).toBe(0);
 await page.evaluate(async()=>{await signOut();currentStaff={id:'nurse-1',full_name:'Наталья',role:'nurse',active:true};show('workspace');await openDebtHistoryV29()});await expect(page.locator('#debtHistoryV29Screen')).not.toBeVisible();const reads=await page.evaluate(()=>__ledgerCalls.filter(x=>(x.name==='crm_clinical_v10'&&x.args.p_action==='debt_history')||(x.name==='crm_debt_ledger_v29'&&['list','history'].includes(x.args.p_action))));expect(reads).toHaveLength(1);expect(errors).toEqual([]);
});

test('debt amount cannot exceed the balance or save without explicit confirmation',async({page})=>{
 const errors=await boot(page,{open:false});await openLoan(page);await loanFields(page,{amount:'300.01'});await payButton(page).click();await expect(page.locator('#debtMessageV10')).toContainText(/не больше/);expect(await paymentCalls(page)).toHaveLength(0);
 await page.fill('#debtAmountV10','200.25');await page.uncheck('#debtConfirmV10');await payButton(page).click();await expect(page.locator('#debtMessageV10')).toContainText(/подтверждение/);expect(await paymentCalls(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('ordinary partial cash collection changes drawer cash by the payment and excludes tendered change',async({page})=>{
 const errors=await boot(page,{role:'nurse'});await page.evaluate(()=>openSavedPaymentV14('procedure','waiting',900,null,true));await page.selectOption('#debtMethodV10','cash');await page.fill('#debtAmountV10','450.25');await page.fill('#debtTenderV10','500');await page.check('#debtConfirmV10');await payButton(page).click();await expect(page.locator('#workspace')).toBeVisible();
 const calls=await paymentCalls(page);expect(calls).toHaveLength(1);expect(calls[0].args.p_payload.payments).toEqual({cash:450.25,terminal:0,owner_card:0,cash_received:500});
 const state=await page.evaluate(()=>({cash:__ledgerReport.revenue.cash,total:__ledgerReport.revenue.total,balance:__ledgerReport.cash_drawer.balance,received:__ledgerReport.cash_drawer.received_cash,history:__ledgerHistory.length}));expect(state).toEqual({cash:7250.25,total:8950.25,balance:5450.25,received:7250.25,history:1});expect(errors).toEqual([]);
});

test('concurrent debt save submits one mutation while the acknowledgement is pending',async({page})=>{
 const errors=await boot(page,{open:false});await openLoan(page);await loanFields(page,{amount:'123.45',purpose:'Частичное погашение продажи'});await page.evaluate(()=>{__ledgerHold=true;window.__firstDebtSave=saveDebtPaymentV10()});await expect(payButton(page)).toBeDisabled();await page.evaluate(()=>saveDebtPaymentV10());expect(await paymentCalls(page)).toHaveLength(1);expect(await mutations(page)).toHaveLength(1);
 await page.evaluate(async()=>{__releaseLedger();await __firstDebtSave});await expect(page.locator('#workspace')).toBeVisible();expect(await page.evaluate(()=>__ledgerHistory.at(-1).amount)).toBe(123.45);expect(await page.evaluate(()=>__ledgerReport.cash_drawer.balance)).toBe(5000);expect(errors).toEqual([]);
});

test('definitive debt rejection preserves editable details and a corrected retry uses a fresh request',async({page})=>{
 const errors=await boot(page,{open:false});await openLoan(page);await loanFields(page,{purpose:'Первое назначение'});await page.evaluate(()=>{__ledgerRejected={code:'P0001',message:'Проверьте назначение платежа'}});await payButton(page).click();await expect(page.locator('#debtMessageV10')).toContainText('Проверьте назначение платежа');await expect(page.locator('#debtAmountV10')).toBeEnabled();await expect(page.locator('#debtPurposeV29')).toHaveValue('Первое назначение');expect(await mutations(page)).toHaveLength(0);
 await page.evaluate(()=>{__ledgerRejected=null});await loanFields(page,{amount:'100.25',purpose:'Исправленное назначение'});await payButton(page).click();await expect(page.locator('#workspace')).toBeVisible();const calls=await paymentCalls(page);expect(calls).toHaveLength(2);expect(calls[1].args.p_request_id).not.toBe(calls[0].args.p_request_id);expect(calls[1].args.p_payload).toMatchObject({amount:100.25,purpose:'Исправленное назначение'});expect(await mutations(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('repayment history response cannot reveal manager data after the actor signs out',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{const original=db.rpc;db.rpc=async(name,args)=>name==='crm_clinical_v10'&&args.p_action==='debt_history'?new Promise(resolve=>window.__releaseHistory=()=>resolve({data:{items:__ledgerHistory}})):original(name,args);window.__historyLoad=openDebtHistoryV29()});await expect(page.locator('#debtHistoryV29Screen')).toBeVisible();await page.evaluate(async()=>{await signOut();__releaseHistory();await __historyLoad});await expect(page.locator('#login')).toBeVisible();await expect(page.locator('#debtHistoryV29Screen')).not.toBeVisible();await expect(page.locator('#debtHistoryV29Screen')).toBeEmpty();await expect(page.locator('#debtHistoryBodyV29')).toHaveCount(0);await expect(page.locator('body')).not.toContainText('Старая капельница');expect(errors).toEqual([]);
});
