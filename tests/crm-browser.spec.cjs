const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page,role='owner'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:`window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]}),createSignedUrl:async()=>({data:{signedUrl:'#'}})})},rpc:async()=>({data:[]})}}};`}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  window.__crmCalls=[];window.__crmRecords=[];window.__crmSaveError=null;window.__crmSummaryOverrides={};
  const actor={id:role==='owner'?'owner-1':'nurse-1',full_name:role==='owner'?'Аниса':'Наталья',role,active:true};
  const staff=[{id:'nurse-1',full_name:'Наталья'},{id:'nurse-2',full_name:'Лилия'}];
  const opened={id:'shift-1',started_at:'2026-10-06T05:30:00Z',planned_end_at:'2026-10-06T13:00:00Z',staff};
  patients=[{id:'patient-1',full_name:'Анна',phone:''}];nurses=staff;
  meds=[{id:'med-1',name:'Самыр',dosage:'400 мг',consumption_unit:'амп.',sale_price:10,work_qty:20}];
  services=[{id:'service-1',name:'Инъекция',work_price:100,consumables_price:0,active:true}];
  inventory=[{...meds[0],reserve_qty:40,reserve_available:40,work_available:20,min_total_stock:10,work_threshold:5,units_per_package:5,purchase_price:30,active:true,nearest_expiry:'2027-12-31'}];
  window.__crmShiftReport={shift:{id:'shift-1',date:'2026-10-06',started_at:opened.started_at,planned_end_at:opened.planned_end_at,status:'open'},staff:staff.map(s=>({...s,amount:2000})),patients_count:1,procedures_count:1,sales_count:0,revenue:{cash:40,terminal:40,owner_card:40,total:120,unclassified:0},payroll_total:4000,payroll_unknown:0,payroll_complete:true,cash_after_salary:-3880,used:[{id:'med-1',name:'Самыр',unit:'амп.',procedure_qty:2,sale_qty:0,quantity:2}],stock:[{id:'med-1',name:'Самыр',unit:'амп.',work:18,reserve:40}],warnings:[],procedures:[{id:'procedure-1',at:'2026-10-06T10:00:00Z',patient:'Анна',nurse:'Наталья',type:'Инъекция',paid_total:120,items:[{name:'Самыр',quantity:2,unit:'амп.',line_total:20}]}],sales:[]};
  db.from=()=>{const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:actor})};return q};
  db.rpc=async(name,args={})=>{
   window.__crmCalls.push({name,args});
   if(name==='record_treatment_v5'){
    if(window.__crmSaveError)return {error:window.__crmSaveError};
    window.__crmRecords.push(args);return {data:{id:'saved-1',paid_total:args.p_payload.paid_total,payments:args.p_payload.payments}};
   }
   if(name==='crm_finance_v5'){
    if(args.p_action==='settings_get')return {data:{float_amount:50000,time_zone:'Europe/Moscow'}};
    if(args.p_action==='summary')return {data:{from:args.p_payload.from,to:args.p_payload.to,time_zone:'Europe/Moscow',group_by:args.p_payload.group_by,patients_count:1,procedures_count:1,sales_count:0,revenue:{cash:40,terminal:40,owner_card:40,total:120,unclassified:0},payroll_total:4000,payroll_closed:0,payroll_open:4000,payroll_unknown:0,payroll_complete:true,cash_after_salary:-3880,has_open_shifts:true,days_complete:false,rows:[{id:'day',label:'2026-10-06',patients_count:1,procedures_count:1,sales_count:0,revenue:{cash:40,terminal:40,owner_card:40,total:120}}],shifts:[{...opened,shift_date:'2026-10-06',status:'open',payroll_total:4000,payroll_complete:true}],...window.__crmSummaryOverrides}};
    if(args.p_action==='close'){window.__crmShiftReport.shift.status='closed';return {data:window.__crmShiftReport}}
    if(args.p_action==='salary'){const s=window.__crmShiftReport.staff.find(s=>s.id===args.p_payload.staff_id);s.amount=args.p_payload.amount;s.reason=args.p_payload.reason;return {data:window.__crmShiftReport}}
    return {data:window.__crmShiftReport};
   }
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='work_catalog_v2')return {data:meds};
   if(name.includes('warehouse'))return {data:inventory};
   if(name==='get_my_open_shift_v82')return {data:opened};
   if(name==='crm_management_v5')return {data:[]};
   return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};
  loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'mock-auth'});
  shift={id:'shift-1',aId:'nurse-1',a:'Наталья',bId:'nurse-2',b:'Лилия',type:'08:30–16:00'};
  show('workspace');
 },role);
 await expect(page.locator('#workspace')).toBeVisible();
 return errors;
}
async function procedure(page){
 await page.evaluate(()=>openProcedure('patient-1'));
 await expect(page.locator('#procedure')).toBeVisible();
 await page.selectOption('#procService','service-1');
 await page.evaluate(()=>chooseMedication('procMeds','med-1'));
 await page.fill('#procMeds .medqty','2');
 await expect(page.locator('#procPaid')).toHaveValue('120.00');
}
async function noOverflow(page){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
}

test('warehouse interval report has CSV, preserves Moscow dates and recovers when filters change during a request',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{
  const original=db.rpc;
  window.__warehouseCalls=[];
  db.rpc=async(name,args)=>{
   if(name!=='crm_warehouse_report_v5')return original(name,args);
   __warehouseCalls.push(args);
   const data={...args.p_payload,generated_at:'2026-10-07T09:00:00Z',movements_count:1,medications_count:1,
    catalog:[{id:'12345678-1234-1234-1234-123456789abc',name:'Самыр',active:true}],
    medications:[{id:'12345678-1234-1234-1234-123456789abc',name:'Самыр',unit:'амп.',active:true,reserve_current:12,work_current:3,total_current:15,reserve_delta:5,work_delta:1,movement_count:1}],
    movements:[{at:'2026-10-07T09:00:00Z',name:'<script>Самыр</script>',unit:'амп.',type:'purchase',quantity:7,to_location:'reserve',actor_name:'Аниса',comment:'Поставка'}]};
   if(window.__warehousePending)return new Promise(resolve=>{window.__warehouseFinish=()=>resolve({data})});
   return {data};
  };
  show('admin');
 });
 await page.click('#adminWarehouseReportLinkV5');
 await expect(page.locator('#warehouseReportV5Body')).toContainText('Текущие остатки');
 await expect(page.locator('#warehouseReportV5Body')).toContainText('<script>Самыр</script>');
 expect(await page.locator('#warehouseReportV5Body script').count()).toBe(0);
 await noOverflow(page);
 const downloadPromise=page.waitForEvent('download');
 await page.click('#warehouseReportV5Csv');
 const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/^warehouse-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
 await page.fill('#warehouseReportV5From','2026-10-01');await page.fill('#warehouseReportV5To','2026-10-07');
 await page.evaluate(()=>{window.__warehousePending=true});
 await page.click('#warehouseReportV5Load');await page.waitForFunction(()=>!!window.__warehouseFinish);
 await page.fill('#warehouseReportV5To','2026-10-08');
 await expect(page.locator('#warehouseReportV5Load')).toBeEnabled();
 await page.evaluate(()=>{window.__warehousePending=false;window.__warehouseFinish()});
 await expect(page.locator('#warehouseReportV5Body')).toBeEmpty();
 await page.click('#warehouseReportV5Load');await expect(page.locator('#warehouseReportV5Body')).toContainText('2026-10-08');
 expect(await page.evaluate(()=>__warehouseCalls.at(-1).p_payload)).toEqual({from:'2026-10-01',to:'2026-10-08'});
 const calls=await page.evaluate(()=>__warehouseCalls.length);
 await page.evaluate(()=>{currentStaff.role='nurse';show('warehouseReportV5')});
 await expect(page.locator('#warehouseReportV5')).not.toBeVisible();
 expect(await page.evaluate(()=>__warehouseCalls.length)).toBe(calls);expect(errors).toEqual([]);
});

test('390px owner workspace, confirmed mixed payment, exact tender/change and one atomic save',async({page})=>{
 const errors=await boot(page);
 await expect(page.locator('#workspace .home-actions>button')).toHaveCount(9);
 await noOverflow(page);await procedure(page);
 await page.click('#procedure button[onclick="saveProcedure()"]');
 await expect(page.locator('#procedureMessage')).toContainText('подтверждение');
 expect(await page.evaluate(()=>window.__crmRecords.length)).toBe(0);
 await page.click('#procPaymentV5 [data-pay-method="mixed"]');
 await page.fill('#procPayCash','40');await page.fill('#procPayTerminal','40');await page.fill('#procPayOwnerCard','40');
 await page.fill('#procPayTender','100');
 await expect(page.locator('#procPaySummary')).toContainText('Сдача: 60');
 await page.check('#procPayConfirmed');await noOverflow(page);
 await page.click('#procedure button[onclick="saveProcedure()"]');
 await expect(page.locator('#workspace')).toBeVisible();
 const records=await page.evaluate(()=>window.__crmRecords);
 expect(records).toHaveLength(1);expect(records[0].p_payload.payments).toEqual({cash:40,terminal:40,owner_card:40,cash_received:100});
 expect(errors).toEqual([]);
});

test('terminal payment and failed save preserve every allocation and request identity for retry',async({page})=>{
 const errors=await boot(page);await procedure(page);
 await page.click('#procPaymentV5 [data-pay-method="terminal"]');
 await expect(page.locator('#procPayTenderBox')).toBeHidden();await page.check('#procPayConfirmed');
 await page.evaluate(()=>{window.__crmSaveError={message:'Ответ сервера потерян'}});
 await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#procedureMessage')).toContainText('Ответ сервера потерян');
 await expect(page.locator('#procPaid')).toHaveValue('120.00');await expect(page.locator('#procPayConfirmed')).toBeChecked();
 await page.evaluate(()=>{window.__crmSaveError=null});
 await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();
 const calls=await page.evaluate(()=>window.__crmCalls.filter(x=>x.name==='record_treatment_v5'));
 expect(calls).toHaveLength(2);expect(calls[0].args.p_request_id).toEqual(calls[1].args.p_request_id);
 expect(calls[1].args.p_payload.payments).toEqual({cash:0,terminal:120,owner_card:0,cash_received:0});expect(errors).toEqual([]);
});

test('nurse has five actions, fixed price and operational report without owner amounts or reserve',async({page})=>{
 const errors=await boot(page,'nurse');await expect(page.locator('#workspace .home-actions>button')).toHaveCount(5);
 await expect(page.locator('#ownerDashboardV5')).toHaveCount(0);await noOverflow(page);await procedure(page);
 await expect(page.locator('#procPaid')).toHaveAttribute('readonly','');
 await page.evaluate(()=>{document.getElementById('procPaid').value='1.00';calcProcedure(false)});
 await expect(page.locator('#procPaid')).toHaveValue('120.00');await expect(page.locator('#procDiscountBox')).toBeHidden();
 await page.evaluate(()=>openReport());await expect(page.locator('#report')).toBeVisible();
 const report=await page.locator('#reportBody').innerText();
 expect(report).toContain('Наталья');expect(report).toContain('Самыр');
 for(const forbidden of ['Выручка','Общая выручка','Зарплата','Заработная','запас:','120 ₽','4 000','4000'])expect(report).not.toContain(forbidden);
 await page.evaluate(()=>show('cashV5'));await expect(page.locator('#workspace')).toBeVisible();
 expect(await page.evaluate(()=>window.__crmCalls.filter(x=>x.name==='crm_finance_v5'&&x.args.p_action==='summary').length)).toBe(0);
 await noOverflow(page);expect(errors).toEqual([]);
});

test('cash separates float from receipts; summary distinguishes historic unknown and entity-filter inapplicable wages',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openCashV5());await expect(page.locator('#cashV5')).toBeVisible();
 await expect(page.locator('#cashV5Body')).toContainText('Разменный фонд');await expect(page.locator('#cashV5Body')).toContainText('50');
 await expect(page.locator('#cashV5Body')).toContainText('не включается');await noOverflow(page);
 await page.evaluate(()=>{window.__crmSummaryOverrides={cash_after_salary:null,payroll_unknown:1,payroll_complete:false};return openReportsV5()});
 await expect(page.locator('#reportsV5Body')).toContainText('Не рассчитан: укажите зарплату за прошлые смены');
 await page.evaluate(()=>{window.__crmSummaryOverrides={cash_after_salary:null,payroll_total:null,payroll_closed:null,payroll_open:null,payroll_unknown:null,payroll_complete:null,payroll_scope:'not_applicable_to_entity_filter',has_open_shifts:false,days_complete:true};return loadFinanceSummaryV5('reportsV5')});
 await expect(page.locator('#reportsV5Body')).toContainText('Не применяется к этому фильтру');
 expect(await page.locator('#reportsV5Body').innerText()).not.toContain('Есть незакрытые смены');
 await noOverflow(page);expect(errors).toEqual([]);
});

test('owner salary requires reason; nurse close produces an operational saved report',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openReport());await expect(page.locator('#report')).toBeVisible();
 await page.locator('.salary-v5 summary').first().click();await page.fill('#salaryAmount5-nurse-1','2500');
 await page.click('.salary-v5 button[onclick="saveSalaryV5(\'nurse-1\')"]');await expect(page.locator('#salaryMessageV5')).toContainText('причину');
 await page.fill('#salaryReason5-nurse-1','Подмена сотрудника');await page.click('.salary-v5 button[onclick="saveSalaryV5(\'nurse-1\')"]');
 const salaries=await page.evaluate(()=>window.__crmCalls.filter(x=>x.name==='crm_finance_v5'&&x.args.p_action==='salary'));
 expect(salaries).toHaveLength(1);expect(salaries[0].args.p_payload).toMatchObject({amount:2500,reason:'Подмена сотрудника'});
 await page.evaluate(()=>{currentStaff={id:'nurse-1',full_name:'Наталья',role:'nurse'};return openReport()});
 await page.click('#report button[onclick="closeShift()"]');await expect(page.locator('#reportBody')).toContainText('Смена закрыта');
 await expect(page.locator('#report button[onclick="closeShift()"]')).toBeHidden();
 expect(await page.evaluate(()=>shift)).toBeNull();await noOverflow(page);expect(errors).toEqual([]);
});
