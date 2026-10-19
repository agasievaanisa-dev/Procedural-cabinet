const {test,expect}=require('@playwright/test');
const fs=require('node:fs/promises');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});
function fixtures(){
 const event={id:'visit-other-card',kind:'procedure',patient_id:'patient-other-card',patient:'Пациент другой карты',nurse_id:'nurse-test',nurse:'Тестовая Медсестра',shift_id:'shift-test',at:'2026-10-18T06:00:00Z',procedure_type:'Капельница',list_total:1600,charge_total:1600,initial_paid_total:1600,paid_total:1600,received_total:1600,lifetime_received_total:1600,debt_repayments_total:0,debt_total:0,payment_pending:false,editable:true,payments:{cash:400,terminal:0,owner_card:300,other_card:900},payment_scope_v45:'shift',shift_received_total_v45:1600,shift_payments_v45:{cash:400,terminal:0,owner_card:300,other_card:900,total:1600},received_other_shifts_v45:0,services:[{name:'Капельница',quantity:1,line_total:600}],items:[{name:'Препарат проверки',quantity:1,unit:'амп.',dose:'250 мг',line_total:1000}],own_medications:[]};
 return {from:'2026-10-18',to:'2026-10-18',shift:{id:'shift-test',date:'2026-10-18',started_at:'2026-10-18T05:30:00Z',planned_end_at:'2026-10-18T13:00:00Z',status:'closed'},staff:[{id:'nurse-test',full_name:'Тестовая Медсестра',amount:0}],patients_count:1,procedures_count:1,sales_count:0,procedures:[event],sales:[],receipts:[],revenue:{cash:400,terminal:0,owner_card:300,other_card:900,total:1600},charge_total:1600,debt_total:0,loan_debt_total:0,pending_total:0,payroll_total:0,payroll_complete:true,payroll_unknown:0,cash_drawer:{opening_confirmed:true,opening:0,received_cash:400,salary_paid:0,balance:400},used:[],stock:[],untracked:[],warnings:[],rows:[{label:'Группа проверки',patients_count:1,procedures_count:1,sales_count:0,revenue:{cash:400,terminal:0,owner_card:300,other_card:900,total:1600}}],shifts:[]};
}
async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.clock.setFixedTime(new Date('2026-10-18T07:30:00Z'));
 const origin=new URL(base).origin;await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(({data,role})=>{
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
  window.__otherReport=freeze(data);window.__otherBefore=JSON.stringify(data);window.__otherReads=[];window.__otherUnexpected=[];
  currentStaff={id:'nurse-test',full_name:'Тестовая Медсестра',role,active:true};shift={id:'shift-test',aId:'nurse-test',a:'Тестовая Медсестра'};window.print=()=>{};
  db.rpc=async(name,args={})=>{__otherReads.push({name,args});
   if(name==='crm_finance_v5'&&args.p_action==='shift_report')return {data:__otherReport};
   if(name==='crm_finance_v5'&&args.p_action==='summary')return {data:{...__otherReport,from:args.p_payload.from,to:args.p_payload.to}};
   __otherUnexpected.push({name,args});throw Error('Unexpected data access');
  };
  db.from=table=>{__otherUnexpected.push({table});throw Error('Unexpected table access')};show('workspace');
 },{data:fixtures(),role});return errors;
}
async function assertReadOnly(page){expect(await page.evaluate(()=>({unchanged:JSON.stringify(__otherReport)===__otherBefore,unexpected:__otherUnexpected}))).toEqual({unchanged:true,unexpected:[]})}

for(const role of ['nurse','admin','owner'])test(`${role}: shift screen and PDF show other-card separately without changing actual cash`,async({page})=>{
 const errors=await boot(page,role);await page.evaluate(()=>openReportByIdV5('shift-test'));await expect(page.locator('#report')).toBeVisible();await page.evaluate(()=>document.querySelectorAll('#reportBody details').forEach(node=>node.open=true));
 const visit=page.locator('#reportBody [data-event-id="visit-other-card"] .report-visit-payment-v39');await expect(visit.locator('[data-payment-method="other_card"]')).toHaveText(/Другая карта:\s*900\s*₽/);await expect(visit.locator('[data-payment-method="owner_card"]')).toHaveText(/Перевод на карту начальника:\s*300\s*₽/);await expect(visit.locator('[data-payment-method="cash"]')).toHaveText(/Наличные:\s*400\s*₽/);
 for(const [key,value]of [['other-card','900'],['owner-card','300'],['cash','400'],['cash-balance','400'],['revenue','1 600']])await expect(page.locator('#reportBody [data-summary-key="'+key+'"] > b')).toHaveText(new RegExp(value.replace(' ','\\s*')+'\\s*₽'));
 await page.locator('#reportPrintV5').click();await expect(page.locator('#crmPrintPreviewV40')).toBeVisible();const preview=page.locator('#crmPrintDocumentV40');await expect(preview).toContainText(/Другая карта:\s*900/);await expect(preview).toContainText(/Перевод на карту начальника:\s*300/);await expect(preview).toContainText('250 мг');
 const definition=await page.evaluate(()=>JSON.stringify(crmPdfDefinitionV40(document.getElementById('crmPrintDocumentV40'))));for(const text of ['Другая карта','Перевод на карту начальника','Препарат проверки','250 мг'])expect(definition).toContain(text);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await assertReadOnly(page);expect(errors).toEqual([]);
});

test('period report and downloaded CSV have a separate other-card total and grouping column',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openReportsV5());await expect(page.locator('#reportsV5')).toBeVisible();await expect(page.locator('#reportsV5Body [data-summary-key="other-card"] > b')).toHaveText(/900\s*₽/);await expect(page.locator('#reportsV5Body [data-summary-key="cash-balance"] > b')).toHaveText(/400\s*₽/);await expect(page.locator('#reportsV5Body .finance-rows-v5').first()).toContainText(/перевод на карту начальника\s*300\s*₽ · другая карта\s*900\s*₽/);
 const pending=page.waitForEvent('download');await page.locator('#reportsV5Csv').click();const download=await pending;const csv=await fs.readFile(await download.path(),'utf8');expect(csv).toContain('"Другая карта";"900"');expect(csv).toContain('"Переводы на карту начальника";"300"');
 const rows=csv.split('\r\n').map(row=>row.split(';').map(cell=>cell.replace(/^"|"$/g,''))),head=rows.find(row=>row[0]==='Группа'),group=rows.find(row=>row[0]==='Группа проверки');expect(group[head.indexOf('Другая карта')]).toBe('900');expect(group[head.indexOf('Переводы на карту начальника')]).toBe('300');expect(group[head.indexOf('Наличные')]).toBe('400');expect(group[head.indexOf('Получено')]).toBe('1600');await assertReadOnly(page);expect(errors).toEqual([]);
});
