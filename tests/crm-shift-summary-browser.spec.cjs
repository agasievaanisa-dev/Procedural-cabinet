const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page,role='nurse') {
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:`window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})}}};`}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(role=>{
  currentStaff={id:'summary-staff-1',full_name:'Наталья',role,active:true};shift={id:'summary-shift',a:'Наталья',b:'Лилия',type:'08:30–16:00'};
  window.__shiftSummaryData={shift:{id:'summary-shift',date:'2026-10-12',started_at:'2026-10-12T05:30:00Z',planned_end_at:'2026-10-12T13:00:00Z',status:'closed'},
   staff:[{id:'summary-staff-1',full_name:'Наталья',amount:100,reason:'Не печатать причину зарплаты'},{id:'summary-staff-2',full_name:'Лилия <img src=x>',amount:200}],patients_count:3,procedures_count:2,sales_count:1,
   revenue:{cash:580,terminal:300,owner_card:150,total:1030},charge_total:1700,debt_total:500,payroll_total:300,payroll_unknown:0,payroll_complete:true,cash_after_salary:730,loan_debt_total:100,pending_total:400,cash_drawer:{opening_confirmed:true,opening:500,received_cash:580,salary_paid:100,cash_in:20,cash_out:50,balance:950},
   procedures:[{id:'summary-procedure',at:'2026-10-12T08:00:00Z',patient:'Пациент с частичной оплатой',nurse:'Наталья',type:'Капельница',services:[{name:'Капельница',quantity:1,line_total:600}],items:[{name:'Сохранённый препарат',quantity:2,unit:'фл.',line_total:500}],list_total:1100,charge_total:1000,initial_paid_total:500,paid_total:500,received_total:900,debt_total:100,discount_comment:'Согласованная скидка'},
    {id:'summary-pending',at:'2026-10-12T08:30:00Z',patient:'Пациент оплатит позже',nurse:'Лилия',type:'Внутривенный укол',services:[{name:'Внутривенный укол',quantity:1,line_total:400}],items:[],list_total:400,charge_total:400,initial_paid_total:0,paid_total:0,received_total:0,debt_total:400,payment_pending:true}],
   sales:[{id:'summary-sale',at:'2026-10-12T07:00:00Z',patient:'Покупатель',nurse:'Лилия',items:[{name:'Препарат на продажу',quantity:1,unit:'амп.',line_total:300}],list_total:300,charge_total:300,initial_paid_total:300,paid_total:300,received_total:300,debt_total:0}],
   receipts:[{id:'summary-receipt',receipt_kind:'pending_payment',at:'2026-10-12T09:00:00Z',patient:'Оплата после процедуры',nurse:'Наталья',paid_total:230,payments:{cash:80,terminal:0,owner_card:150},comment:'Получено в этой смене'}],
   stock:[{name:'Не печатать склад',work:99991,reserve:99992}],used:[{name:'Не печатать списание',quantity:99993}],untracked:[{name:'Не печатать учёт без списания',quantity:99994}],warnings:[]};
  window.print=()=>window.__summaryPrintCalls=(window.__summaryPrintCalls||0)+1;show('workspace');renderShiftReportV5(__shiftSummaryData,true);
 },role);
 return errors;
}
const summary=page=>page.locator('#reportBody .shift-financial-summary-v16');
const amount=(host,key)=>host.locator(`[data-summary-key="${key}"]`);

// A record's lifetime receipts can include payments from a later shift. Only
// its initial collection plus the current shift's receipt ledger is revenue.
test('nurse shift summary orders ordinary income, methods, real debt, salary and actual cash',async({page})=>{
 const errors=await boot(page),host=summary(page),cards=host.locator('.finance-simple-summary-v29 .stat');
 expect(await cards.evaluateAll(nodes=>nodes.map(node=>node.dataset.summaryKey))).toEqual(['revenue','terminal','owner-card','loan','cash','payroll-total','cash-balance']);
 for(const [key,label,value] of [['revenue','Получено за смену','1 030'],['terminal','Оплата терминалом','300'],['owner-card','Переводы на карту','150'],['loan','Долг','100'],['cash','Наличные за смену','580'],['payroll-total','Зарплата за смену','300'],['cash-balance','Остаток наличных в кассе','950']]){
  await expect(amount(host,key)).toContainText(label);await expect(amount(host,key)).toContainText(value);
 }
 await expect(amount(host,'pending')).toContainText('400');await expect(amount(host,'pending')).toContainText('Это не долг');
 await expect(amount(host,'loan')).not.toContainText('500');await expect(amount(host,'cash-balance')).not.toContainText('730');
 await expect(host).not.toContainText('Не печатать');await expect(host.locator('input,button')).toHaveCount(0);await expect(page.locator('#reportBody .salary-v5')).toHaveCount(0);
 const totals=await page.evaluate(()=>{const values=financeShiftSummaryAmountsV16(__shiftSummaryData);__shiftSummaryData.procedures[0].paid_total=900;return {values,whenPaidIncludesLater:financeShiftSummaryAmountsV16(__shiftSummaryData)}});
 expect(totals.values.procedures+totals.values.sales+totals.values.receipts).toBe(totals.values.total);expect(totals.whenPaidIncludesLater.procedures).toBe(500);expect(totals.values.debt).toBe(500);expect(totals.values.loan).toBe(100);expect(totals.values.afterSalary).toBe(950);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

test('nurse PDF repeats the summary while preserving ordered patient and medication details',async({page})=>{
 const errors=await boot(page),before=await summary(page).textContent();await page.click('#reportPrintV5');await page.emulateMedia({media:'print'});
 const printed=page.locator('#shiftPrintV5');await expect(printed).toBeVisible();expect(await printed.locator('.shift-financial-summary-v16').textContent()).toBe(before);
 const entries=printed.locator('.shift-print-event-v5');await expect(entries).toHaveCount(3);await expect(entries.nth(0)).toContainText('Покупатель');await expect(entries.nth(1)).toContainText('Сохранённый препарат × 2 фл.');await expect(entries.nth(1)).toContainText(/Оплата по прайсу:\s*1\s*100/);await expect(entries.nth(1)).toContainText('Согласованная скидка');await expect(entries.nth(2)).toContainText('Ожидает оплаты');await expect(printed.locator('.shift-print-other-payments-v39')).toContainText('Получено в этой смене');
 await expect(printed).not.toContainText('Не печатать');await expect(printed.locator('input,button,img,script')).toHaveCount(0);await expect(printed).toContainText('Лилия <img src=x>');expect(errors).toEqual([]);
});

test('owner keeps salary corrections in the app and prints a salary summary without controls or warehouse details',async({page})=>{
 const errors=await boot(page,'owner');await expect(page.locator('#reportBody .salary-v5')).toHaveCount(2);await expect(page.locator('#reportBody')).toContainText('Не печатать склад');
 await page.click('#reportPrintV5');await page.emulateMedia({media:'print'});const printed=page.locator('#shiftPrintV5');await expect(amount(printed,'payroll-total')).toContainText('300');await expect(printed.locator('input,button')).toHaveCount(0);await expect(printed).not.toContainText('Не печатать');expect(errors).toEqual([]);
});

test('incomplete accrued salaries stay missing while confirmed cash uses actual payouts',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{__shiftSummaryData.staff[0].amount=null;__shiftSummaryData.payroll_total=200;__shiftSummaryData.payroll_complete=false;__shiftSummaryData.payroll_unknown=1;__shiftSummaryData.cash_after_salary=null;renderShiftReportV5(__shiftSummaryData,true)});
 const host=summary(page);await expect(host.locator('details')).toContainText('Не задана');await expect(host.locator('details')).toContainText('Лилия <img src=x>');await expect(amount(host,'payroll-total')).toContainText('Не задана полностью');await expect(amount(host,'payroll-total')).toContainText('Из кассы выплачено 100');await expect(amount(host,'cash-balance')).toContainText('950');
 await page.click('#reportPrintV5');await page.emulateMedia({media:'print'});await expect(amount(page.locator('#shiftPrintV5'),'cash-balance')).toContainText('950');expect(errors).toEqual([]);
});

test('old shift payload without opening cash or wages never invents either amount',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{for(const person of __shiftSummaryData.staff)delete person.amount;for(const key of ['payroll_total','payroll_complete','payroll_unknown','cash_after_salary','cash_drawer'])delete __shiftSummaryData[key];renderShiftReportV5(__shiftSummaryData,true)});
 const host=summary(page);await expect(amount(host,'payroll-total')).toContainText('Не задана полностью');await expect(amount(host,'cash-balance')).toContainText('Не рассчитан: укажите остаток на начало смены');await expect(host.locator('details')).toContainText('Не задана');expect(errors).toEqual([]);
});

test('summary handles exact cents and legitimate zero wages without counting unpaid charges as income',async({page})=>{
 const errors=await boot(page);const result=await page.evaluate(()=>{
  const source={procedures:[{initial_paid_total:0.1,received_total:900,charge_total:1000,debt_total:100}],sales:[{paid_total:0.2,charge_total:0.2,debt_total:0}],receipts:[{paid_total:0.3}],revenue:{cash:0.3,terminal:0.3,total:0.6},staff:[{id:'zero-salary',full_name:'Сотрудник',amount:0}],payroll_complete:true,payroll_unknown:0,payroll_total:0,cash_drawer:{opening_confirmed:true,opening:0,received_cash:0.3,salary_paid:0,cash_in:0,cash_out:0,balance:0.3}};
  const amounts=financeShiftSummaryAmountsV16(source);return {amounts,html:financeShiftSummaryHtmlV16(source)};
 });
 expect(result.amounts.total).toBe(0.6);expect(result.amounts.procedures).toBe(0.1);expect(result.amounts.sales).toBe(0.2);expect(result.amounts.receipts).toBe(0.3);expect(result.amounts.payrollComplete).toBe(true);expect(result.amounts.afterSalary).toBe(0.3);expect(result.html).not.toContain('Не задана');expect(errors).toEqual([]);
});
