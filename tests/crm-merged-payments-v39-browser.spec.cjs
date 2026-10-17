const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

function procedure(overrides={}) {
 return {id:'procedure-1',kind:'procedure',patient_id:'patient-1',patient:'Анна',nurse:'Наталья',at:'2026-10-11T07:00:00Z',services:[{name:'Капельница',quantity:1,line_total:1000}],items:[],own_medications:[],list_total:1000,charge_total:1000,initial_paid_total:0,paid_total:0,received_total:0,lifetime_received_total:0,debt_repayments_total:0,debt_total:1000,payment_pending:true,payments:{cash:0,terminal:0,owner_card:0},...overrides};
}
function receipt(overrides={}) {
 return {id:'receipt-1',kind:'procedure',record_id:'procedure-1',receipt_kind:'after_procedure_payment',is_debt_repayment:false,patient_id:'patient-1',patient:'Анна',nurse:'Наталья',at:'2026-10-11T08:15:00Z',paid_total:1000,payments:{cash:600,terminal:400,owner_card:0},comment:'Оплата после окончания процедуры',...overrides};
}
function report({procedures=[procedure()],sales=[],receipts=[]}={}) {
 const events=[...procedures,...sales],ordinary=receipts.filter(item=>item.receipt_kind!=='debt_repayment'&&item.payment_kind!=='debt_repayment'&&item.is_debt_repayment!==true&&item.payment_scope!=='debt');
 // These fixtures save each record unpaid. Its initial paid_total remains zero
 // after collection; cumulative received_total and the receipt are separate.
 const revenue={cash:0,terminal:0,owner_card:0,total:0};
 for(const item of ordinary){for(const method of ['cash','terminal','owner_card'])revenue[method]+=item.payments?.[method]||0;revenue.total+=item.paid_total;}
 return {shift:{id:'shift-1',date:'2026-10-11',started_at:'2026-10-11T05:30:00Z',planned_end_at:'2026-10-11T13:00:00Z',status:'closed'},staff:[{id:'staff-1',full_name:'Наталья',amount:2000},{id:'staff-2',full_name:'Лилия',amount:2000}],patients_count:new Set(events.map(item=>item.patient_id)).size,procedures_count:procedures.length,sales_count:sales.length,procedures,sales,receipts,revenue,charge_total:events.reduce((sum,item)=>sum+item.charge_total,0),debt_total:events.reduce((sum,item)=>sum+item.debt_total,0),loan_debt_total:events.filter(item=>!item.payment_pending).reduce((sum,item)=>sum+item.debt_total,0),pending_total:events.filter(item=>item.payment_pending).reduce((sum,item)=>sum+item.debt_total,0),payroll_total:4000,payroll_complete:true,payroll_unknown:0,cash_drawer:{opening_confirmed:true,opening:5000,received_cash:revenue.cash,salary_paid:4000,cash_in:0,cash_out:0,balance:1000+revenue.cash},used:[],untracked:[],stock:[],warnings:[]};
}

async function boot(page,data) {
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const origin=new URL(base).origin;
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:`window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})}}};`}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(data=>{
  currentStaff={id:'staff-1',full_name:'Наталья',role:'nurse',active:true};shift={id:'shift-1',a:'Наталья',b:'Лилия',type:'08:30–16:00'};
  financeAccountingMode5={payment_only:true,stock_deducted:false};
  window.__mergedCalls=[];window.__mergedUnexpected=[];window.__mergedPrintCalls=0;window.print=()=>__mergedPrintCalls++;
  window.__setMergedReport=value=>{
   const freeze=item=>{if(item&&typeof item==='object'){Object.values(item).forEach(freeze);Object.freeze(item);}return item;};
   window.__mergedReport=freeze(value);window.__mergedExpected=JSON.stringify(value);
  };
  __setMergedReport(data);
  db.rpc=async(name,args={})=>{
   __mergedCalls.push({name,args:JSON.parse(JSON.stringify(args))});
   if(name==='crm_finance_v5'&&args.p_action==='shift_report'&&args.p_payload?.shift_id==='shift-1')return {data:__mergedReport,error:null};
   __mergedUnexpected.push({name,args});throw Error('Unexpected report RPC '+name+' '+args.p_action);
  };
  db.from=table=>{__mergedUnexpected.push({table});throw Error('Unexpected report table access '+table);};
  show('workspace');
 },data);
 return errors;
}
async function openReport(page) {
 await page.evaluate(()=>openReportByIdV5('shift-1'));
 await expect(page.locator('#report')).toBeVisible();
 await page.evaluate(()=>document.querySelectorAll('#reportBody details').forEach(item=>item.open=true));
}
async function printReport(page) {
 await page.click('#reportPrintV5');await page.emulateMedia({media:'print'});
 await expect(page.locator('#shiftPrintV5')).toBeVisible();await expect(page.locator('.app')).toBeHidden();
}
async function finishPrint(page) {
 await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
 await expect(page.locator('#shiftPrintV5')).toHaveCount(0);
 await expect(page.locator('#crmPrintPreviewV40')).toBeVisible();await page.click('#crmPrintCloseV40');await expect(page.locator('#crmPrintPreviewV40')).toBeHidden();
}
async function expectReadOnly(page) {
 const state=await page.evaluate(()=>({calls:__mergedCalls,unexpected:__mergedUnexpected,unchanged:JSON.stringify(__mergedReport)===__mergedExpected,frozen:Object.isFrozen(__mergedReport)&&Object.isFrozen(__mergedReport.procedures)&&Object.isFrozen(__mergedReport.receipts),decorated:__mergedReport.procedures.some(item=>Object.hasOwn(item,'shift_receipts_v39'))||__mergedReport.sales.some(item=>Object.hasOwn(item,'shift_receipts_v39'))}));
 expect(state.calls.length).toBeGreaterThan(0);expect(state.unexpected).toEqual([]);
 expect(state.calls.every(item=>item.name==='crm_finance_v5'&&item.args.p_action==='shift_report')).toBe(true);
 expect(state.unchanged).toBe(true);expect(state.frozen).toBe(true);expect(state.decorated).toBe(false);
}
const entries=page=>page.locator('#shiftPrintV5 .shift-print-events-v5 > .shift-print-event-v5');

test('an initially unpaid procedure remains one numbered visit after a same-shift receipt, with its payment time and methods nested inside',async({page})=>{
 const errors=await boot(page,report());await openReport(page);
 await expect(page.locator('#reportBody .report-event-v5')).toHaveCount(1);
 await expect(page.locator('#reportBody [data-summary-key="revenue"] > b')).toHaveText(/0\s*₽/);
 await expect(page.locator('#reportBody [data-summary-key="loan"] > b')).toHaveText(/0\s*₽/);
 await expect(page.locator('#reportBody [data-summary-key="pending"]')).toContainText(/1\s*000\s*₽/);
 await printReport(page);await expect(entries(page)).toHaveCount(1);
 await expect(entries(page).first()).toContainText(/Оплачено:\s*0\s*₽/);
 await expect(entries(page).first()).not.toContainText('Оплачено всего:');
 await expect(entries(page).first()).toContainText('Ожидает оплаты');await finishPrint(page);

 // The server now reports the same saved record after collection. No payment
 // mutation belongs to opening, rendering, or printing either snapshot.
 const paid=procedure({received_total:1000,lifetime_received_total:1000,debt_total:0,payment_pending:false,payments:{cash:600,terminal:400,owner_card:0}});
 await page.evaluate(data=>__setMergedReport(data),report({procedures:[paid],receipts:[receipt()]}));
 await openReport(page);
 const screen=page.locator('#reportBody .report-event-v5');await expect(screen).toHaveCount(1);
 await expect(screen.locator('.report-inline-receipt-v39')).toHaveCount(1);
 await expect(screen.locator('.report-inline-receipt-v39 time')).toHaveText('11:15');
 await expect(screen.locator('.report-inline-receipt-v39 [data-payment-method="cash"]')).toContainText(/600\s*₽/);
 await expect(screen.locator('.report-inline-receipt-v39 [data-payment-method="terminal"]')).toContainText(/400\s*₽/);
 await printReport(page);await expect(entries(page)).toHaveCount(1);
 const visit=entries(page).first();await expect(visit.locator('.report-inline-receipt-v39')).toHaveCount(1);
 await expect(visit.locator('time')).toHaveText('11:15');await expect(visit).toContainText('11.10.2026, 10:00');
 await expect(visit).toContainText(/Оплачено:\s*Наличные:\s*600\s*₽\s*·\s*Терминал:\s*400\s*₽/);
 await expect(visit).not.toContainText('Оплачено всего:');
 await expect(visit.locator('.report-inline-receipt-v39')).toContainText('Время оплаты:');await expect(visit.locator('.report-inline-receipt-v39')).not.toContainText('Оплата после процедуры');
 await expect(page.locator('#shiftPrintV5 .shift-print-other-payments-v39')).toHaveCount(0);
 await expect(page.locator('#shiftPrintV5 footer [data-summary-key="revenue"] > b')).toHaveText(/1\s*000\s*₽/);
 await expect(page.locator('#shiftPrintV5 footer [data-summary-key="cash"] > b')).toHaveText(/600\s*₽/);
 await expect(page.locator('#shiftPrintV5 footer [data-summary-key="pending"]')).toHaveCount(0);
 await expectReadOnly(page);expect(errors).toEqual([]);
});

test('repeated visits by one patient and a sale/procedure ID collision keep their own exact receipt references',async({page})=>{
 const first=procedure({id:'repeat-1',received_total:1000,lifetime_received_total:1000,debt_total:0,payment_pending:false,payments:{cash:600,terminal:400,owner_card:0}});
 const second=procedure({id:'shared-id',at:'2026-10-11T08:00:00Z',received_total:1000,lifetime_received_total:1000,debt_total:0,payment_pending:false,payments:{cash:0,terminal:1000,owner_card:0}});
 const sale=procedure({id:'shared-id',kind:'sale',at:'2026-10-11T08:30:00Z',services:[],items:[{name:'Проданный препарат',quantity:1,unit:'амп.',line_total:200}],list_total:200,charge_total:200,received_total:200,lifetime_received_total:200,debt_total:0,payment_pending:false,payments:{cash:0,terminal:0,owner_card:200}});
 const receipts=[receipt({id:'receipt-repeat-1',record_id:'repeat-1',at:'2026-10-11T08:15:00Z',paid_total:600,comment:'Только первое посещение',payments:{cash:600,terminal:0,owner_card:0}}),receipt({id:'receipt-repeat-2',record_id:'repeat-1',at:'2026-10-11T08:25:00Z',paid_total:400,comment:'Остаток за первое посещение',payments:{cash:0,terminal:400,owner_card:0}}),receipt({id:'receipt-procedure-shared',record_id:'shared-id',at:'2026-10-11T09:10:00Z',comment:'Только вторая процедура',payments:{cash:0,terminal:1000,owner_card:0}}),receipt({id:'receipt-sale-shared',kind:'sale',record_id:'shared-id',at:'2026-10-11T09:20:00Z',paid_total:200,comment:'Только продажа',payments:{cash:0,terminal:0,owner_card:200}})];
 const errors=await boot(page,report({procedures:[first,second],sales:[sale],receipts}));await openReport(page);
 const screen=page.locator('#reportBody .report-event-v5');await expect(screen).toHaveCount(3);
 const expectedIds=[['receipt-repeat-1','receipt-repeat-2'],['receipt-procedure-shared'],['receipt-sale-shared']];
 for(const [index,ids] of expectedIds.entries()){
  const nested=screen.nth(index).locator('.report-inline-receipt-v39');await expect(nested).toHaveCount(ids.length);
  for(const [receiptIndex,id] of ids.entries())await expect(nested.nth(receiptIndex)).toHaveAttribute('data-receipt-id',id);
 }
 await printReport(page);await expect(entries(page)).toHaveCount(3);
 for(const [index,ids] of expectedIds.entries()){
  const nested=entries(page).nth(index).locator('.report-inline-receipt-v39');await expect(nested).toHaveCount(ids.length);
  for(const [receiptIndex,id] of ids.entries())await expect(nested.nth(receiptIndex)).toHaveAttribute('data-receipt-id',id);
 }
 await expect(entries(page).first().locator('.report-inline-receipt-v39 time')).toHaveText(['11:15','11:25']);
 await expect(entries(page).first().locator('.report-inline-receipt-v39').nth(0).locator('[data-payment-method="cash"]')).toContainText(/600\s*₽/);
 await expect(entries(page).first().locator('.report-inline-receipt-v39').nth(1).locator('[data-payment-method="terminal"]')).toContainText(/400\s*₽/);
 await expect(entries(page).nth(0)).toContainText('Только первое посещение');await expect(entries(page).nth(0)).not.toContainText('Только вторая процедура');
 await expect(entries(page).nth(1)).toContainText('Только вторая процедура');await expect(entries(page).nth(1)).not.toContainText('Только продажа');
 await expect(entries(page).nth(2)).toContainText('Продажа препарата');await expect(entries(page).nth(2)).toContainText('Только продажа');
 await expect(page.locator('#shiftPrintV5 .shift-print-other-payments-v39')).toHaveCount(0);
 await expect(page.locator('#shiftPrintV5 footer [data-summary-key="revenue"] > b')).toHaveText(/2\s*200\s*₽/);
 await expectReadOnly(page);expect(errors).toEqual([]);
});

test('other-shift and unknown references remain visible without visit numbers or patient-name guessing; true debt receipts stay outside shift income',async({page})=>{
 const current=procedure({list_total:100,charge_total:100,debt_total:100});
 const receipts=[receipt({id:'previous-shift-receipt',record_id:'procedure-from-yesterday',patient_id:'previous-patient',patient:'Пациент вчерашней смены',paid_total:30,payments:{cash:30,terminal:0,owner_card:0},comment:'Сегодня оплачена запись предыдущей смены'}),receipt({id:'unknown-same-name',record_id:'missing-record',paid_total:40,payments:{cash:0,terminal:40,owner_card:0},comment:'Тёзка не определяет запись'}),receipt({id:'missing-kind',kind:null,record_id:'procedure-1',paid_total:50,payments:{cash:0,terminal:0,owner_card:50},comment:'Без вида нельзя связать запись'}),...[
  {receipt_kind:'debt_repayment'},{payment_kind:'debt_repayment'},{is_debt_repayment:true},{payment_scope:'debt'}
 ].map((flags,index)=>receipt({id:'true-debt-'+index,paid_total:9000,payments:{cash:9000,terminal:0,owner_card:0},comment:'Скрытое погашение долга '+index,...flags}))];
 const errors=await boot(page,report({procedures:[current],receipts}));await openReport(page);
 await expect(page.locator('#reportBody .report-event-v5')).toHaveCount(1);await expect(page.locator('#reportBody .report-event-v5 .report-inline-receipt-v39')).toHaveCount(0);
 await expect(page.locator('#reportBody .shift-print-other-payments-v39 .report-inline-receipt-v39')).toHaveCount(3);
 await printReport(page);await expect(entries(page)).toHaveCount(1);await expect(entries(page).first().locator('.report-inline-receipt-v39')).toHaveCount(0);
 const other=page.locator('#shiftPrintV5 > .shift-print-other-payments-v39');await expect(other).toBeVisible();
 await expect(other.locator('.report-inline-receipt-v39')).toHaveCount(3);await expect(other.locator('li,ol')).toHaveCount(0);
 await expect(other.locator('[data-receipt-id="previous-shift-receipt"] time')).toHaveText('11.10.2026, 11:15');await expect(other.locator('[data-receipt-id="previous-shift-receipt"]')).toContainText('Наталья');
 for(const text of ['Пациент вчерашней смены','Сегодня оплачена запись предыдущей смены','Тёзка не определяет запись','Без вида нельзя связать запись','в число посещений не входят'])await expect(other).toContainText(text);
 await expect(page.locator('#reportBody')).not.toContainText('Скрытое погашение долга');await expect(page.locator('#shiftPrintV5')).not.toContainText('Скрытое погашение долга');
 for(const scope of ['#reportBody','#shiftPrintV5 footer']){
  await expect(page.locator(scope+' [data-summary-key="revenue"] > b')).toHaveText(/120\s*₽/);
  await expect(page.locator(scope+' [data-summary-key="loan"] > b')).toHaveText(/0\s*₽/);
  await expect(page.locator(scope+' [data-summary-key="pending"]')).toContainText(/100\s*₽/);
  await expect(page.locator(scope+' [data-summary-key="pending"]')).toContainText('Это не долг');
 }
 await expectReadOnly(page);expect(errors).toEqual([]);
});

test('captured dosage, discounts and receipt fields are escaped and repeated rendering/printing cannot alter finance snapshots or write money',async({page})=>{
 const unsafe={patient:'Анна <script>window.reportInjection=1</script>',dosage:'5 мл <img src=x onerror="window.reportInjection=2">',dose:'1 <svg onload="window.reportInjection=3">',reason:'Скидка <b>постоянная</b>',discount:'Решение <script>window.reportInjection=4</script>',nurse:'Лилия <img src=x onerror="window.reportInjection=5">',comment:'Квитанция <svg onload="window.reportInjection=6">',id:'receipt"><img src=x onerror="window.reportInjection=7">'};
 const event=procedure({patient:unsafe.patient,services:[{name:'Капельница',quantity:1,line_total:300,dosage:unsafe.dosage}],items:[{name:'Сохранённый препарат',quantity:1,unit:'фл.',line_total:700,dose:unsafe.dose}],list_total:1000,charge_total:800,received_total:800,lifetime_received_total:800,debt_total:0,payment_pending:false,discount_amount:200,discount_reason:unsafe.reason,discount_comment:unsafe.discount,payments:{cash:800,terminal:0,owner_card:0}});
 const payment=receipt({id:unsafe.id,patient:unsafe.patient,nurse:unsafe.nurse,paid_total:800,payments:{cash:800,terminal:0,owner_card:0},comment:unsafe.comment});
 const errors=await boot(page,report({procedures:[event],receipts:[payment]}));await openReport(page);
 await page.evaluate(()=>{renderShiftReportV5(__mergedReport,true);renderShiftReportV5(__mergedReport,true);});
 await printReport(page);await expect(entries(page)).toHaveCount(1);const visit=entries(page).first();
 for(const text of [unsafe.patient,unsafe.dosage,unsafe.dose,unsafe.reason,unsafe.discount,unsafe.comment]){
  await expect(page.locator('#reportBody')).toContainText(text);await expect(visit).toContainText(text);
 }
 await expect(page.locator('#reportBody')).not.toContainText(unsafe.nurse);await expect(visit).not.toContainText(unsafe.nurse);
 await expect(visit.locator('.report-inline-receipt-v39')).toHaveAttribute('data-receipt-id',unsafe.id);
 await expect(page.locator('#reportBody script,#reportBody img,#reportBody svg,#shiftPrintV5 script,#shiftPrintV5 img,#shiftPrintV5 svg')).toHaveCount(0);
 expect(await page.evaluate(()=>window.reportInjection)).toBeUndefined();
 await expect(visit).toContainText(/Оплата по прайсу:\s*1\s*000\s*₽/);await expect(visit).toContainText(/со скидкой\s*200\s*₽/);await expect(visit).toContainText(/Оплачено:\s*Наличные:\s*800\s*₽/);
 for(const redundant of ['К оплате:','Оплачено всего:','Сотрудник:'])await expect(visit).not.toContainText(redundant);
 await expect(page.locator('#shiftPrintV5 footer [data-summary-key="revenue"] > b')).toHaveText(/800\s*₽/);
 await finishPrint(page);await printReport(page);await expect(entries(page)).toHaveCount(1);
 await expect(entries(page).first().locator('.report-inline-receipt-v39')).toHaveCount(1);
 expect(await page.evaluate(()=>__mergedPrintCalls)).toBe(2);await expectReadOnly(page);expect(errors).toEqual([]);
});

test('mobile print uses compact A4 flow: long visits and the footer can split while receipt and amount lines stay together',async({page})=>{
 const procedures=Array.from({length:12},(_,index)=>procedure({id:'compact-'+index,patient_id:'compact-patient-'+index,patient:'Пациент '+(index+1),at:'2026-10-11T07:'+String(index).padStart(2,'0')+':00Z',list_total:100,charge_total:100,received_total:100,lifetime_received_total:100,debt_total:0,payment_pending:false,payments:{cash:100,terminal:0,owner_card:0}}));
 const receipts=procedures.map((item,index)=>receipt({id:'compact-receipt-'+index,record_id:item.id,patient_id:item.patient_id,patient:item.patient,paid_total:100,payments:{cash:100,terminal:0,owner_card:0}}));
 const errors=await boot(page,report({procedures,receipts}));await openReport(page);await printReport(page);
 await expect(entries(page)).toHaveCount(12);await expect(page.locator('#shiftPrintV5 .report-inline-receipt-v39')).toHaveCount(12);
 const css=await page.evaluate(()=>{
  const style=selector=>getComputedStyle(document.querySelector(selector));
  const article=style('#shiftPrintV5'),event=style('#shiftPrintV5 .shift-print-event-v5'),footer=style('#shiftPrintV5 footer'),prices=style('#shiftPrintV5 .report-price-line-v41'),receipt=style('#shiftPrintV5 .report-inline-receipt-v39'),totals=style('#shiftPrintV5 .finance-totals-v5'),stat=style('#shiftPrintV5 .finance-simple-summary-v29 .stat');
  const pages=Array.from(document.styleSheets).flatMap(sheet=>Array.from(sheet.cssRules||[])).filter(rule=>rule.type===CSSRule.PAGE_RULE).map(rule=>({
   selector:rule.selectorText,size:rule.style.getPropertyValue('size').toLowerCase().trim().split(/\s+/),
   margins:['top','right','bottom','left'].map(side=>CSSNumericValue.parse(rule.style.getPropertyValue('margin-'+side)).to('mm').value)
  }));
  return {page:article.getPropertyValue('page'),fontSize:parseFloat(article.fontSize),lineHeight:parseFloat(article.lineHeight),maxWidth:article.maxWidth,eventBreak:event.breakInside,eventPadding:parseFloat(event.paddingTop),footerBreak:footer.breakInside,pricesDisplay:prices.display,pricesBreak:prices.breakInside,receiptBreak:receipt.breakInside,totalsDisplay:totals.display,statDisplay:stat.display,statPadding:parseFloat(stat.paddingTop),pages};
 });
 expect(css.page).toBe('crm-shift-report-v39');
 const paper=css.pages.find(rule=>rule.selector===css.page);expect(paper).toBeDefined();
 expect(paper.size).toContain('a4');expect(paper.size).not.toContain('landscape');
 for(const margin of paper.margins)expect(margin).toBeCloseTo(10,3);
 expect(css.fontSize).toBeLessThanOrEqual(14.1);expect(css.lineHeight/css.fontSize).toBeLessThanOrEqual(1.26);expect(css.maxWidth).toBe('none');
 expect(css.eventBreak).toBe('auto');expect(css.footerBreak).toBe('auto');expect(css.eventPadding).toBeLessThanOrEqual(7);
 expect(css.pricesDisplay).toBe('block');expect(css.pricesBreak).toBe('avoid');expect(css.receiptBreak).toBe('avoid');
 expect(css.totalsDisplay).toBe('block');expect(css.statDisplay).toBe('flex');expect(css.statPadding).toBeLessThanOrEqual(4.1);
 await expect(page.locator('#shiftPrintV5 input,#shiftPrintV5 button')).toHaveCount(0);await expectReadOnly(page);expect(errors).toEqual([]);
});
