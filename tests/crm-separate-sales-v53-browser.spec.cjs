const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// The two ledgers are deliberately specified as independent business figures.
// Every person, item, receipt and RPC below is fictional.
async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-22T08:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(role=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  currentStaff={id:role==='nurse'?'v53-nurse':'v53-admin',full_name:'Сотрудник Проверки',role,active:true};
  shift={id:'v53-shift',aId:'v53-nurse',a:'Медсестра Проверки',bId:null,b:''};
  nurses=[{id:'v53-nurse',full_name:'Медсестра Проверки'}];patients=[{id:'v53-patient',full_name:'Пациент Процедуры'}];
  services=[{id:'v53-service',name:'Капельница',work_price:500,consumables_price:100,active:true}];
  meds=[{id:'v53-proc-med',name:'Препарат в процедуре',consumption_unit:'амп.',sale_price:100,active:true,work_qty:10},{id:'v53-sale-med',name:'Аминокислоты для продажи',consumption_unit:'фл.',sale_price:9500,active:true,work_qty:10}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:10,units_per_package:1,purchase_price:0}));
  const zero={cash:0,terminal:0,owner_card:0,other_card:0,unclassified:0,total:0};
  const common={editable:true,version:1,shift_id:shift.id,nurse_id:'v53-nurse',nurse:'Медсестра Проверки',at:'2026-10-22T06:00:00Z',created_at:'2026-10-22T06:00:00Z',own_medications:[],stock_deducted:false,payment_pending:false,pending_total:0,debt_total:0,loan_debt_total:0};
  const procedure={...common,id:'v53-procedure',kind:'procedure',patient_id:'v53-patient',patient:'Пациент Процедуры',procedure_type:'Капельница',list_total:700,charge_total:700,initial_paid_total:700,paid_total:700,received_total:700,
   services:[{service_id:'v53-service',name:'Капельница',quantity:1,line_total:600,work_price:500,consumables_price:100}],items:[{medication_id:'v53-proc-med',name:'Препарат в процедуре',quantity:1,unit:'амп.',line_total:100,unit_price:100}],payments:{cash:300,terminal:100,owner_card:200,other_card:100,total:700}};
  const sale={...common,kind:'sale',patient_id:null,patient:'Без пациента',at:'2026-10-22T05:45:00Z',sold_at:'2026-10-22T05:45:00Z',services:[],items:[{medication_id:'v53-sale-med',name:'Аминокислоты для продажи',quantity:1,unit:'фл.',line_total:9500,unit_price:9500}],list_total:9500};
  window.__v53Calls=[];
  window.__v53Report={sales_separate:true,revenue_scope:'procedures',shift:{id:shift.id,date:'2026-10-22',status:'open',started_at:'2026-10-22T05:30:00Z',planned_end_at:'2026-10-22T13:00:00Z'},
   staff:[{id:'v53-nurse',full_name:'Медсестра Проверки',amount:2000}],patients_count:1,procedures_count:1,sales_count:4,
   procedures:[procedure],sales:[{...sale,id:'v53-cash-sale',charge_total:7000,discount_amount:2500,discount_reason:'Скидка от владельца',discount_comment:'Согласовано',initial_paid_total:7000,paid_total:7000,received_total:7000,payments:{...zero,cash:7000,total:7000}},
    {...sale,id:'v53-mixed-sale',charge_total:9500,initial_paid_total:9500,paid_total:9500,received_total:9500,payments:{...zero,cash:1000,terminal:2500,owner_card:3000,other_card:3000,total:9500}},
    {...sale,id:'v53-pending-sale',charge_total:9500,initial_paid_total:0,paid_total:0,received_total:0,payment_pending:true,pending_total:9500,debt_total:9500,payments:zero},
    {...sale,id:'v53-debt-sale',charge_total:9500,initial_paid_total:0,paid_total:0,received_total:0,loan_debt_total:9500,debt_total:9500,payments:zero}],
   receipts:[],revenue:{...zero,cash:300,terminal:100,owner_card:200,other_card:100,total:700},charge_total:700,debt_total:0,loan_debt_total:0,pending_total:0,payroll_total:2000,payroll_complete:true,payroll_unknown:0,
   sales_summary:{revenue_scope:'standalone_sales',sales_count:4,patients_count:0,revenue:{...zero,cash:8000,terminal:2500,owner_card:3000,other_card:3000,total:16500},charge_total:35500,debt_total:9500,loan_debt_total:9500,pending_total:9500},
   cash_drawer:{sales_separate:true,revenue_scope:'procedures',shift_id:shift.id,opening_confirmed:true,opening:5000,received_cash:300,salary_paid:0,cash_in:0,cash_out:0,balance:5300,salary_auto:true,salary_auto_total:2000,salary_auto_remaining:2000,salary_deduction:2000,cash_after_salary_auto:3300,movements:[],
    payroll:[{staff_id:'v53-nurse',staff_name:'Медсестра Проверки',configured:2000,paid:0,outstanding:2000}],salary_auto_payroll:[{staff_id:'v53-nurse',staff_name:'Медсестра Проверки',configured:2000,paid:0,outstanding:2000,source:'assigned'}],
    reconciliation_v37:{required:true,editable:true,token:'v53-cash-token',count:null,history:[],stale:false,can_close:false}},
   used:[],untracked:[],stock:[],warnings:[]};
  window.__v53Period=()=>({...clone(__v53Report),from:'2026-10-22',to:'2026-10-22',time_zone:'Europe/Moscow',group_by:'day',payroll_scope:'all_period_shifts',rows:[{id:'2026-10-22',label:'2026-10-22',patients_count:1,procedures_count:1,sales_count:4,revenue:clone(__v53Report.revenue),charge_total:700,loan_debt_total:0,pending_total:0,sales_separate:true,sales_summary:clone(__v53Report.sales_summary)}],shifts:[clone(__v53Report.shift)]});
  db.rpc=async(name,args={})=>{
   __v53Calls.push({name,args:clone(args)});
   if(name==='crm_finance_v5'){if(args.p_action==='summary')return {data:__v53Period()};if(args.p_action==='accounting_mode')return {data:{payment_only:true}};return {data:clone(__v53Report)}}
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[clone(__v53Report)]}};
   if(name==='crm_cash_drawer_v30'||name==='crm_cash_reconciliation_v37')return {data:clone(__v53Report.cash_drawer)};
   if(name==='crm_dashboard_day_v25')return {data:{...clone(__v53Report),date:'2026-10-22',working_day:clone(__v53Report),receipts_day:clone(__v53Report)}};
   if(name==='get_my_open_shift_v82')return {data:{...clone(__v53Report.shift),staff:nurses}};
   if(name==='quick_ui_v4')return {data:{favorites:[],recent:[],shifts:[clone(__v53Report.shift)]}};
   return {data:[]};
  };
  window.print=()=>{};show('workspace');renderShiftReportV5(clone(__v53Report),false);
 },role);return errors;
}
const main=page=>page.locator('#reportBody .shift-financial-summary-v16');
const mainAmount=(page,key)=>main(page).locator(`[data-summary-key="${key}"]`);
const sales=page=>page.locator('#reportBody > [data-sales-summary], #reportBody [data-sales-summary]').first();
const saleAmount=(page,key)=>sales(page).locator(`[data-sales-summary-key="${key}"]`);

for(const role of ['admin','nurse'])test(`${role}: shift totals and cash include procedures, with all sale channels separate`,async({page})=>{
 const errors=await boot(page,role);
 await expect(mainAmount(page,'revenue')).toContainText(/700\s*₽/);await expect(mainAmount(page,'cash')).toContainText(/300\s*₽/);
 await expect(mainAmount(page,'terminal')).toContainText(/100\s*₽/);await expect(mainAmount(page,'owner-card')).toContainText(/200\s*₽/);await expect(mainAmount(page,'other-card')).toContainText(/100\s*₽/);
 await expect(mainAmount(page,'loan')).toContainText(/0\s*₽/);await expect(mainAmount(page,'cash-balance')).toContainText(/3\s*300/);
 await expect(saleAmount(page,'revenue')).toContainText(/16\s*500/);await expect(saleAmount(page,'cash')).toContainText(/8\s*000/);
 await expect(saleAmount(page,'terminal')).toContainText(/2\s*500/);await expect(saleAmount(page,'owner-card')).toContainText(/3\s*000/);await expect(saleAmount(page,'other-card')).toContainText(/3\s*000/);
 await expect(saleAmount(page,'loan')).toContainText(/9\s*500/);await expect(sales(page)).toContainText('Не входят в сумму и наличную кассу смены');
 await expect(page.locator('#reportBody [data-event-id="v53-procedure"]')).toContainText('Препарат в процедуре');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

test('partial sale receipt stays visible once without being added to procedure income or debt',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{
  const sale=__v53Report.sales.find(x=>x.id==='v53-pending-sale');sale.received_total=400;sale.paid_total=400;sale.pending_total=sale.debt_total=9100;sale.payments={cash:400,terminal:0,owner_card:0,other_card:0,total:400};
  __v53Report.receipts=[{id:'v53-sale-receipt',kind:'sale',record_id:sale.id,receipt_kind:'pending_payment',at:'2026-10-22T07:00:00Z',patient:'Без пациента',nurse:'Медсестра Проверки',paid_total:400,payments:{cash:400,terminal:0,owner_card:0,other_card:0},comment:'Оплата отдельной продажи'}];
  Object.assign(__v53Report.sales_summary,{pending_total:9100});Object.assign(__v53Report.sales_summary.revenue,{cash:8400,total:16900});renderShiftReportV5(__v53Report,false);
 });
 await expect(mainAmount(page,'revenue')).toContainText(/700\s*₽/);await expect(mainAmount(page,'cash')).toContainText(/300\s*₽/);
 await expect(mainAmount(page,'loan')).toContainText(/0\s*₽/);await expect(saleAmount(page,'cash')).toContainText(/8\s*400/);
 await expect(page.locator('#reportBody [data-receipt-id="v53-sale-receipt"]')).toHaveCount(1);
 await expect(page.locator('#reportBody [data-event-id="v53-pending-sale"]')).toContainText('Оплата отдельной продажи');
 expect(errors).toEqual([]);
});

test('missing summary fields cannot reintroduce standalone sales through client fallbacks',async({page})=>{
 const errors=await boot(page);const values=await page.evaluate(()=>{
  const d=JSON.parse(JSON.stringify(__v53Report));for(const key of ['revenue','cash_total','charge_total','debt_total','loan_debt_total','pending_total'])delete d[key];
  d.receipts=[{id:'proc-later',kind:'procedure',paid_total:50},{id:'sale-later',kind:'sale',paid_total:400},{id:'true-loan',kind:'sale',paid_total:500,is_debt_repayment:true}];
  return {amounts:financeShiftSummaryAmountsV16(d),allOrdinary:financeShiftReceiptsV29(d).length,procedureReceipts:financeProcedureReceiptsV53(d).length};
 });
 expect(values.amounts).toMatchObject({total:750,procedures:700,receipts:50,charge:700,loan:0,pending:0});
 expect(values.allOrdinary).toBe(2);expect(values.procedureReceipts).toBe(1);expect(errors).toEqual([]);
});

test('print contains a procedure list and a separately numbered sale list with independent summaries',async({page})=>{
 const errors=await boot(page,'nurse');await page.evaluate(()=>prepareShiftPrintV5());
 const printed=page.locator('#shiftPrintV5');await expect(printed.locator('[data-print-procedures] > li')).toHaveCount(1);
 await expect(printed.locator('.shift-print-sales-v53 li.shift-print-event-v5')).toHaveCount(4);
 await expect(printed.locator('[data-print-procedures]')).toContainText('Пациент Процедуры');await expect(printed.locator('[data-print-procedures]')).not.toContainText('Аминокислоты для продажи');
 await expect(printed.locator('.shift-financial-summary-v16 [data-summary-key="cash"]')).toContainText(/300\s*₽/);
 await expect(printed.locator('.shift-print-sales-v53 [data-sales-summary-key="cash"]')).toContainText(/8\s*000/);
 await expect(printed.locator('.shift-print-sales-v53')).toContainText('со скидкой');await expect(printed.locator('.shift-print-sales-v53')).toContainText('2 500');
 await expect(printed.locator('input,button,script')).toHaveCount(0);expect(errors).toEqual([]);
});

test('nurse journal numbers procedures separately from standalone sale records',async({page})=>{
 const errors=await boot(page,'nurse');await page.evaluate(()=>openShiftJournalV12('2026-10-22'));
 await expect(page.locator('[data-journal-procedures] > li')).toHaveCount(1);await expect(page.locator('[data-journal-sales] > li')).toHaveCount(4);
 await expect(page.locator('[data-journal-procedures] .journal-event-number-v12')).toHaveText('1.');
 await expect(page.locator('[data-journal-sales] .journal-event-number-v12')).toHaveText(['1.','2.','3.','4.']);
 await expect(page.locator('[data-journal-procedures]')).not.toContainText('Аминокислоты для продажи');
 await expect(page.locator('[data-journal-sales]')).toContainText('Аминокислоты для продажи');expect(errors).toEqual([]);
});

test('period, grouped row and CSV show both ledgers without merging sale cash',async({page})=>{
 const errors=await boot(page);const result=await page.evaluate(()=>{
  const d=__v53Period();return {html:renderFinanceSummaryV5(d,'reportsV5'),csv:buildFinanceCsvV5(d)};
 });
 expect(result.csv).toContain('"Наличные за период";"300"');expect(result.csv).toContain('"Получено за период";"700"');
 expect(result.csv).toContain('"Наличные от продаж";"8000"');expect(result.csv).toContain('"Получено за продажи";"16500"');
 expect(result.csv).toContain('"Терминал продаж";"2500"');expect(result.csv).toContain('"Карта начальника — продажи";"3000"');expect(result.csv).toContain('"Другая карта — продажи";"3000"');
 await page.evaluate(html=>{$('reportBody').innerHTML=html;show('report')},result.html);
 await expect(page.locator('#reportBody > .finance-simple-summary-v29 [data-summary-key="cash"]')).toContainText(/300\s*₽/);
 await expect(page.locator('#reportBody [data-sales-summary]')).toHaveCount(2);expect(errors).toEqual([]);
});

test('dashboard working-shift and calendar sections retain independent sales totals',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{
  const d={date:'2026-10-22',working_day:__v53Report,receipts_day:__v53Report};$('reportBody').innerHTML=financeDashboardHtmlV25(d);show('report');
 });
 const working=page.locator('[data-dashboard-section="shifts"]');await expect(working.locator('[data-summary-key="revenue"]')).toContainText(/700\s*₽/);
 await expect(working.locator('[data-sales-summary-key="revenue"]')).toContainText(/16\s*500/);
 await page.locator('[data-dashboard-section="calendar"] > summary').click();
 await expect(page.locator('[data-dashboard-section="calendar"] [data-sales-summary-key="cash"]')).toContainText(/8\s*000/);expect(errors).toEqual([]);
});

test('cash drawer and reconciliation describe only cash for procedures',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openCashDrawerV30('v53-shift','open'));
 await expect(page.locator('#cashBalanceV30')).toContainText(/3\s*300/);await expect(page.locator('#cashDrawerV30')).toContainText(/продаж.*отдельно|продаж.*не входят/i);
 await page.evaluate(()=>openCashReconciliationV37('v53-shift',{status:'open'}));
 await expect(page.locator('#cashReconciliationV37')).toContainText(/продаж.*отдельно|продаж.*не входят/i);
 await page.selectOption('#cashCountSalaryV37','false');await page.fill('#cashCountAmountV37','5300');
 await expect(page.locator('#cashCountPreviewV37')).toContainText(/5\s*300/);await expect(page.locator('#cashCountPreviewV37')).toContainText(/расхождение:\s*0/i);
 expect(await page.evaluate(()=>__v53Calls.filter(c=>/record|save|movement|payment|cancel/.test(c.args?.p_action||'')).length)).toBe(0);expect(errors).toEqual([]);
});

test('missing separate-sales data shows an explicit error instead of folding records into cash',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{delete __v53Report.sales_summary;renderShiftReportV5(__v53Report,false)});
 await expect(page.locator('[data-sales-summary-error]')).toContainText('Отдельные итоги продаж не получены');
 await expect(mainAmount(page,'cash')).toContainText(/300\s*₽/);await expect(mainAmount(page,'revenue')).toContainText(/700\s*₽/);expect(errors).toEqual([]);
});
