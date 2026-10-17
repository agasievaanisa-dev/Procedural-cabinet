const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

function fixture(){
 const procedure=(id,overrides={})=>({id,kind:'procedure',patient_id:id,patient:'Пациент '+id,nurse:'Наталья',at:'2026-10-16T15:35:00Z',services:[{name:'Капельница',quantity:1,line_total:600}],items:[{name:'Сохранённый препарат',quantity:2,unit:'амп.',dose:'250 мг',line_total:200}],own_medications:[],list_total:800,charge_total:800,initial_paid_total:0,paid_total:0,received_total:800,lifetime_received_total:800,debt_repayments_total:0,debt_total:0,payment_pending:false,payments:{cash:800,terminal:0,owner_card:0},...overrides});
 const receipt=(id,record_id,overrides={})=>({id,kind:'procedure',record_id,receipt_kind:'after_procedure_payment',is_debt_repayment:false,at:'2026-10-16T16:12:00Z',nurse:'Наталья',paid_total:800,payments:{cash:800,terminal:0,owner_card:0},...overrides});
 return {shift:{id:'shift-v41',date:'2026-10-16',started_at:'2026-10-16T05:30:00Z',planned_end_at:'2026-10-16T13:00:00Z',ended_at:'2026-10-16T13:00:00Z',status:'closed'},staff:[{id:'staff-v41',full_name:'Наталья',amount:2000}],patients_count:4,procedures_count:4,sales_count:0,
  procedures:[procedure('cash',{patient:'Тестовая пациентка',notes:'Наш физраствор и расходники'}),procedure('discount',{patient:'Пациент со скидкой',charge_total:500,initial_paid_total:500,paid_total:500,received_total:500,lifetime_received_total:500,payments:{cash:0,terminal:500,owner_card:0},discount_amount:300,discount_reason:'Скидка от начальника',discount_comment:'Скидка от начальника'}),procedure('mixed',{patient:'Пациент с доплатой',charge_total:700,initial_paid_total:100,paid_total:100,received_total:700,lifetime_received_total:700,payments:{cash:100,terminal:0,owner_card:600}}),procedure('waiting',{patient:'Ожидающий пациент',received_total:0,lifetime_received_total:0,payments:{},debt_total:800,payment_pending:true})],
  sales:[],receipts:[receipt('cash-after','cash'),receipt('mixed-after','mixed',{paid_total:600,payments:{cash:0,terminal:0,owner_card:600},nurse:'Лилия',comment:'После завершения процедуры'})],revenue:{cash:900,terminal:500,owner_card:600,total:2000},charge_total:2800,debt_total:800,loan_debt_total:0,pending_total:800,payroll_total:2000,payroll_complete:true,payroll_unknown:0,cash_drawer:{opening_confirmed:true,opening:5000,received_cash:900,salary_paid:2000,cash_in:0,cash_out:0,balance:3900},used:[],untracked:[],stock:[],warnings:[]};
}
async function boot(page,role='nurse',data=fixture()){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));const origin=new URL(base).origin;
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(({role,data})=>{
  currentStaff={id:'staff-v41',full_name:'Наталья',role,active:true};shift={id:'shift-v41',a:'Наталья',b:'Лилия',type:'08:30–16:00'};financeAccountingMode5={payment_only:true,stock_deducted:false};
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};window.__reportV41=freeze(data);window.__beforeReportV41=JSON.stringify(data);window.__callsV41=[];window.__unexpectedV41=[];window.print=()=>{};
  db.rpc=async(name,args={})=>{__callsV41.push({name,args});if(name==='crm_finance_v5'&&args.p_action==='shift_report')return {data:__reportV41,error:null};__unexpectedV41.push({name,args});throw Error('Unexpected write or read')};
  db.from=table=>{__unexpectedV41.push({table});throw Error('Unexpected table access')};show('workspace');
 },{role,data});await page.evaluate(()=>openReportByIdV5('shift-v41'));await expect(page.locator('#report')).toBeVisible();return errors;
}
async function preview(page){await page.click('#reportPrintV5');await expect(page.locator('#crmPrintPreviewV40')).toBeVisible();return page.locator('#crmPrintDocumentV40')}
async function expectReadOnly(page){expect(await page.evaluate(()=>({unchanged:JSON.stringify(__reportV41)===__beforeReportV41,unexpected:__unexpectedV41,readonly:__callsV41.every(call=>call.name==='crm_finance_v5'&&call.args.p_action==='shift_report')}))).toEqual({unchanged:true,unexpected:[],readonly:true})}

for(const role of ['nurse','owner'])test(`${role}: shift print uses day-first dates and a single payment description per collection`,async({page})=>{
 const errors=await boot(page,role),document=await preview(page),visits=document.locator('.shift-print-event-v5');await expect(visits).toHaveCount(4);
 await expect(document.locator('header')).toContainText('16.10.2026');await expect(document.locator('header')).not.toContainText('2026-10-16');
 const cash=visits.filter({hasText:'Тестовая пациентка'}).locator('.report-visit-payment-v39');await expect(cash).toContainText(/Оплата по прайсу:\s*800\s*₽/);await expect(cash).toContainText(/Оплачено:.*Наличные:\s*800\s*₽/);
 expect((await cash.innerText()).match(/800\s*₽/g)).toHaveLength(2);await expect(cash.locator('[data-payment-method="cash"]')).toHaveCount(1);await expect(cash.locator('.report-inline-receipt-v39')).toHaveCount(1);
 const paymentDate=cash.locator('.report-inline-receipt-v39 time');await expect(paymentDate).toHaveText('16.10.2026, 19:12');await expect(paymentDate.locator('..')).toContainText('Наталья');
 const discount=visits.filter({hasText:'Пациент со скидкой'}).locator('.report-visit-payment-v39');await expect(discount).toContainText(/Оплачено:.*Терминал:\s*500\s*₽.*со скидкой\s*300\s*₽/);
 expect((await discount.innerText()).match(/Скидка от начальника/g)).toHaveLength(1);
 const mixed=visits.filter({hasText:'Пациент с доплатой'}).locator('.report-visit-payment-v39');await expect(mixed).toContainText(/Наличные:\s*100\s*₽/);await expect(mixed).toContainText(/Перевод на карту начальника:\s*600\s*₽/);await expect(mixed).not.toContainText(/700\s*₽/);
 await expect(document).not.toContainText('Оплачено всего:');await expect(document).not.toContainText('К оплате:');await expect(document).not.toContainText('Сотрудник:');
 const waiting=visits.filter({hasText:'Ожидающий пациент'});await expect(waiting).toContainText(/Ожидает оплаты:\s*800\s*₽/);await expect(waiting).toContainText('Это не долг');
 for(const event of await visits.all())await expect(event).toContainText('250 мг');await expect(document.locator('[data-summary-key="cash"] > b')).toHaveText(/900\s*₽/);await expect(document.locator('[data-summary-key="cash-balance"] > b')).toHaveText(/3\s*900\s*₽/);
 await expectReadOnly(page);expect(errors).toEqual([]);
});

test('screen and printable visit payment descriptions agree and comments remain escaped',async({page})=>{
 const data=fixture();data.procedures[1].discount_reason='Причина <script>bad()</script>';data.procedures[1].discount_comment='Комментарий <img src=x>';data.receipts[0].comment='Получено <svg onload=bad()>';const errors=await boot(page,'owner',data);
 await page.evaluate(()=>document.querySelectorAll('#reportBody details').forEach(element=>element.open=true));
 const screen=await page.locator('#reportBody [data-event-id="discount"] .report-visit-payment-v39').innerText();const document=await preview(page),printed=document.locator('.shift-print-event-v5').filter({hasText:'Пациент со скидкой'}).locator('.report-visit-payment-v39');
 expect((await printed.innerText()).replace(/\s+/g,' ')).toBe(screen.replace(/\s+/g,' '));await expect(printed).toContainText('Причина <script>bad()</script>');await expect(printed).toContainText('Комментарий <img src=x>');await expect(document).toContainText('Получено <svg onload=bad()>');await expect(document.locator('script,img,svg,[onload]')).toHaveCount(0);
 await expectReadOnly(page);expect(errors).toEqual([]);
});

test('downloaded PDF retains the compact payment language, Russian text and the full clinical snapshot',async({page},testInfo)=>{
 const errors=await boot(page),document=await preview(page);await expect(document.locator('.shift-print-event-v5')).toHaveCount(4);
 const promised=page.waitForEvent('download');await page.click('#crmPrintPdfV40');const download=await promised;await download.saveAs(testInfo.outputPath('compact-payments-v41.pdf'));const bytes=fs.readFileSync(await download.path());expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(bytes.length).toBeGreaterThan(3000);expect(bytes.subarray(-1024).toString()).toContain('%%EOF');
 const definition=await page.evaluate(()=>JSON.stringify(crmPdfDefinitionV40(document.getElementById('crmPrintDocumentV40'),{title:'Отчёт смены'})));
 for(const text of ['Тестовая пациентка','16.10.2026','Оплата по прайсу','Наталья','Сохранённый препарат','250 мг','со скидкой','Скидка от начальника','Перевод на карту начальника','Остаток наличных в кассе'])expect(definition).toContain(text);
 for(const old of ['Оплачено всего:','Сотрудник:','2026-10-16'])expect(definition).not.toContain(old);await expectReadOnly(page);expect(errors).toEqual([]);
});
