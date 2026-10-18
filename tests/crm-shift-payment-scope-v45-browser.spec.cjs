const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

function fixtures(){
 const event={id:'visit-a',kind:'procedure',patient_id:'patient-a',patient:'Пациент другой смены',nurse_id:'nurse-a',nurse:'Медсестра А',shift_id:'shift-a',at:'2026-10-17T06:00:00Z',procedure_type:'Капельница',list_total:1600,charge_total:1600,initial_paid_total:500,paid_total:500,received_total:1600,lifetime_received_total:1600,debt_repayments_total:0,debt_total:0,payment_pending:false,editable:true,payments:{cash:1000,terminal:400,owner_card:200},payment_scope_v45:'shift',shift_received_total_v45:500,shift_payments_v45:{cash:300,terminal:0,owner_card:200,unclassified:0,total:500},received_other_shifts_v45:1100,services:[{name:'Капельница',quantity:1,line_total:600}],items:[{name:'Сохранённый препарат',quantity:1,unit:'амп.',dose:'250 мг',line_total:1000}],own_medications:[]};
 const receipt={id:'receipt-b',kind:'procedure',record_id:'visit-a',patient_id:'patient-a',patient:event.patient,nurse_id:'nurse-a',nurse:'Медсестра Б',at:'2026-10-17T14:00:00Z',paid_total:1100,payments:{cash:700,terminal:400,owner_card:0},is_debt_repayment:false,receipt_kind:'after_procedure_payment'};
 const report=(id,overrides={})=>({shift:{id,date:'2026-10-17',started_at:'2026-10-17T05:30:00Z',planned_end_at:'2026-10-17T13:00:00Z',status:'closed'},staff:[{id:'nurse-a',full_name:'Медсестра А',amount:0}],patients_count:1,procedures_count:1,sales_count:0,procedures:[event],sales:[],receipts:[],revenue:{cash:300,terminal:0,owner_card:200,unclassified:0,total:500},charge_total:1600,debt_total:0,loan_debt_total:0,pending_total:0,payroll_total:0,payroll_complete:true,payroll_unknown:0,cash_drawer:{opening_confirmed:true,opening:0,received_cash:300,salary_paid:0,balance:300},used:[],stock:[],untracked:[],warnings:[],...overrides});
 const first=report('shift-a'),second=report('shift-b',{shift:{id:'shift-b',date:'2026-10-17',started_at:'2026-10-17T13:00:00Z',status:'closed'},procedures:[],procedures_count:0,patients_count:0,receipts:[receipt],revenue:{cash:700,terminal:400,owner_card:0,unclassified:0,total:1100},charge_total:0,cash_drawer:{opening_confirmed:true,opening:0,received_cash:700,salary_paid:0,balance:700}});
 return {first,second};
}
async function boot(page,role='nurse'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const origin=new URL(base).origin;
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(({data,role})=>{
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
  window.__scopeV45=freeze(data);window.__scopeBeforeV45=JSON.stringify(data);window.__scopeCallsV45=[];window.__scopeWritesV45=[];
  currentStaff={id:'nurse-a',full_name:'Медсестра А',role,active:true};shift={id:'shift-a',aId:'nurse-a',a:'Медсестра А'};window.print=()=>{};
  db.rpc=async(name,args={})=>{__scopeCallsV45.push({name,args});
   if(name==='crm_finance_v5'&&args.p_action==='shift_report')return {data:args.p_payload.shift_id==='shift-b'?__scopeV45.second:__scopeV45.first};
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,reports:[__scopeV45.first]}};
   __scopeWritesV45.push({name,args});throw Error('Unexpected data access');
  };
  db.from=table=>{__scopeWritesV45.push({table});throw Error('Unexpected table access')};show('workspace');
 },{data:fixtures(),role});
 return errors;
}
async function assertReadOnly(page){expect(await page.evaluate(()=>({unchanged:JSON.stringify(__scopeV45)===__scopeBeforeV45,writes:__scopeWritesV45}))).toEqual({unchanged:true,writes:[]})}
async function openReport(page,id){await page.evaluate(id=>openReportByIdV5(id),id);await expect(page.locator('#report')).toBeVisible()}
async function printPreview(page){await page.click('#reportPrintV5');await expect(page.locator('#crmPrintPreviewV40')).toBeVisible();return page.locator('#crmPrintDocumentV40')}

for(const role of ['nurse','owner'])test(`${role}: original shift screen and PDF count only that shift's exact initial methods`,async({page})=>{
 const errors=await boot(page,role);await openReport(page,'shift-a');
 await page.evaluate(()=>document.querySelectorAll('#reportBody details').forEach(node=>node.open=true));
 const event=page.locator('#reportBody [data-event-id="visit-a"] .report-visit-payment-v39');
 await expect(event.locator('[data-payment-method="cash"]')).toHaveText(/Наличные:\s*300\s*₽/);await expect(event.locator('[data-payment-method="owner_card"]')).toHaveText(/Перевод на карту начальника:\s*200\s*₽/);await expect(event.locator('[data-payment-method="terminal"]')).toHaveCount(0);
 await expect(event).toContainText(/Оплата в других сменах:\s*1\s*100\s*₽/);await expect(page.locator('#reportBody [data-summary-key="cash"] > b')).toHaveText(/300\s*₽/);
 const document=await printPreview(page),visit=document.locator('.shift-print-event-v5');await expect(visit).toHaveCount(1);
 await expect(visit.locator('[data-payment-method="cash"]')).toHaveText(/300\s*₽/);await expect(visit.locator('[data-payment-method="owner_card"]')).toHaveText(/200\s*₽/);await expect(visit.locator('[data-payment-method="terminal"]')).toHaveCount(0);
 await expect(document.locator('[data-summary-key="revenue"] > b')).toHaveText(/500\s*₽/);await expect(document.locator('[data-summary-key="cash-balance"] > b')).toHaveText(/300\s*₽/);
 const definition=await page.evaluate(()=>JSON.stringify(crmPdfDefinitionV40(document.getElementById('crmPrintDocumentV40'))));
 for(const text of ['Сохранённый препарат','250 мг','Оплата в других сменах','В сумму и кассу этой смены не входит'])expect(definition).toContain(text);
 await assertReadOnly(page);expect(errors).toEqual([]);
});

test('the receiving shift prints one other-visit receipt with the correct channels and no additional patient',async({page})=>{
 const errors=await boot(page);await openReport(page,'shift-b');const document=await printPreview(page);
 await expect(document.locator('[data-receipt-id="receipt-b"]')).toHaveCount(1);await expect(document.locator('.shift-print-other-payments-v39')).toContainText('Пациент другой смены');
 await expect(document.locator('[data-receipt-id="receipt-b"] [data-payment-method="cash"]')).toHaveText(/Наличные:\s*700\s*₽/);await expect(document.locator('[data-receipt-id="receipt-b"] [data-payment-method="terminal"]')).toHaveText(/Терминал:\s*400\s*₽/);
 await expect(document.locator('[data-summary-key="revenue"] > b')).toHaveText(/1\s*100\s*₽/);await expect(document.locator('[data-summary-key="cash"] > b')).toHaveText(/700\s*₽/);await expect(document.locator('.shift-print-event-v5')).toHaveCount(0);
 await assertReadOnly(page);expect(errors).toEqual([]);
});

test('nurse journal uses shift-scoped money while raw patient history keeps lifetime collections',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openShiftJournalV12('2026-10-17'));await expect(page.locator('#shiftJournalV12')).toBeVisible();
 const entry=page.locator('#journalBodyV12 [data-event-id="visit-a"]');await expect(entry).toContainText(/Оплачено в этой смене:\s*500\s*₽/);await expect(entry.locator('[data-payment-method="cash"]')).toHaveText(/300\s*₽/);await expect(entry.locator('[data-payment-method="terminal"]')).toHaveCount(0);await expect(entry).toContainText(/Оплата в других сменах:\s*1\s*100\s*₽/);
 const history=await page.evaluate(()=>{const copy=JSON.parse(JSON.stringify(__scopeV45.first.procedures[0]));for(const key of ['payment_scope_v45','shift_received_total_v45','shift_payments_v45','received_other_shifts_v45'])delete copy[key];return {amount:financeEventAmountsV5(copy).received,methods:financeEventMethodsV34(copy),html:financeEventPaymentHtmlV5(copy)}});
 expect(history.amount).toBe(1600);expect(history.methods).toEqual({cash:1000,terminal:400,owner_card:200,unclassified:0,debt_repayments_total:0});expect(history.html).toContain('Оплачено всего');
 await assertReadOnly(page);expect(errors).toEqual([]);
});
