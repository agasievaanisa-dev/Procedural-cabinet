const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Fixtures are server receipts, not a second implementation of payroll maths.
// Deliberately different legacy balances catch accidental use of actual payouts
// instead of the server's automatic salary deduction.
function report(overrides={}){
 return {shift:{id:'auto-salary-shift',date:'2026-10-16',started_at:'2026-10-16T05:30:00Z',planned_end_at:'2026-10-16T13:00:00Z',status:'closed'},
  staff:[{id:'nurse-1',full_name:'Марьям',amount:2000},{id:'nurse-2',full_name:'Патя <img src=x>',amount:2000}],
  patients_count:14,procedures_count:14,sales_count:0,revenue:{cash:35900,terminal:5400,owner_card:500,total:41800},charge_total:50900,loan_debt_total:9100,pending_total:0,
  payroll_total:4000,payroll_complete:true,payroll_unknown:0,procedures:[],sales:[],receipts:[],stock:[],used:[],untracked:[],warnings:[],
  cash_drawer:{salary_auto:true,salary_auto_total:4000,salary_auto_remaining:4000,salary_deduction:4000,cash_after_salary_auto:31900,
   opening_confirmed:false,opening:null,received_cash:35900,salary_paid:0,cash_in:0,cash_out:0,balance:null,movements:[],
   payroll:[{staff_id:'nurse-1',staff_name:'Марьям',configured:2000,paid:0,outstanding:2000},{staff_id:'nurse-2',staff_name:'Патя <img src=x>',configured:2000,paid:0,outstanding:2000}]},...overrides};
}
async function boot(page,data=report(),role='nurse'){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(({data,role})=>{
  currentStaff={id:role==='nurse'?'nurse-1':'admin-1',full_name:role==='nurse'?'Марьям':'Аниса',role,active:true};shift=null;
  window.__autoSalaryReport=data;window.__autoSalaryCalls=[];
  db.rpc=async(name,args={})=>{__autoSalaryCalls.push({name,args:JSON.parse(JSON.stringify(args))});
   if(name==='crm_cash_drawer_v30'&&args.p_action==='status')return {data:JSON.parse(JSON.stringify(__autoSalaryReport.cash_drawer))};
   if(name==='crm_finance_v5'&&args.p_action==='shift_report')return {data:JSON.parse(JSON.stringify(__autoSalaryReport))};
   throw Error('Unexpected write while viewing automatic salary: '+name+' '+args.p_action);
  };
  refreshDashboard=async()=>{};refreshOwnerDashboardV5=async()=>{};
  window.print=()=>window.__autoSalaryPrints=(window.__autoSalaryPrints||0)+1;
  show('workspace');renderShiftReportV5(__autoSalaryReport,true);
 },{data,role});return errors;
}
const amount=(page,key)=>page.locator(`#reportBody [data-summary-key="${key}"]`);
const writes=page=>page.evaluate(()=>__autoSalaryCalls.filter(call=>!(call.name==='crm_cash_drawer_v30'&&call.args.p_action==='status')&&!(call.name==='crm_finance_v5'&&call.args.p_action==='shift_report')));
async function openDrawer(page){await page.click('#cashDrawerButtonV30');await expect(page.locator('#cashDrawerV30')).toBeVisible()}

test('two nurses automatically deduct 4,000 without entering opening cash or posting payouts',async({page})=>{
 const errors=await boot(page);await expect(amount(page,'payroll-total')).toContainText(/4\s*000/);await expect(amount(page,'cash-balance')).toContainText(/31\s*900/);
 await expect(amount(page,'cash-balance')).not.toContainText('Не рассчитан');await expect(amount(page,'cash-balance')).toContainText('после зарплаты');
 await openDrawer(page);await expect(page.locator('#cashBalanceV30')).toContainText(/31\s*900/);await expect(page.locator('#cashDrawerV30')).toContainText(/4\s*000/);
 expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>__autoSalaryReport.cash_drawer.movements)).toEqual([]);expect(errors).toEqual([]);
});

test('one nurse deducts 2,000 and a nurse can see the final cash in the printed report',async({page})=>{
 const data=report();data.staff=data.staff.slice(0,1);data.payroll_total=2000;Object.assign(data.cash_drawer,{salary_auto_total:2000,salary_auto_remaining:2000,salary_deduction:2000,cash_after_salary_auto:33900,payroll:data.cash_drawer.payroll.slice(0,1)});
 const errors=await boot(page,data);await expect(amount(page,'payroll-total')).toContainText(/2\s*000/);await expect(amount(page,'cash-balance')).toContainText(/33\s*900/);
 await page.click('#reportPrintV5');await page.emulateMedia({media:'print'});await expect(page.locator('#shiftPrintV5 [data-summary-key="cash-balance"]')).toContainText(/33\s*900/);
 await expect(page.locator('#shiftPrintV5 [data-summary-key="payroll-total"]')).toContainText(/2\s*000/);await expect(page.locator('#shiftPrintV5 input,#shiftPrintV5 button')).toHaveCount(0);expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

for(const [paid,remaining,actual] of [[1000,3000,34900],[4000,0,31900]])test(`recorded salary ${paid} does not cause a second deduction`,async({page})=>{
 const data=report();Object.assign(data.cash_drawer,{opening_confirmed:true,opening:0,salary_paid:paid,salary_auto_remaining:remaining,balance:actual});
 const errors=await boot(page,data);await expect(amount(page,'cash-balance')).toContainText(/31\s*900/);await openDrawer(page);await expect(page.locator('#cashBalanceV30')).toContainText(/31\s*900/);expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('a zero salary and a 2,500 override remain intact in the automatic report and editor',async({page})=>{
 const data=report();data.staff[0].amount=0;data.staff[1].amount=2500;data.payroll_total=2500;Object.assign(data.cash_drawer,{salary_auto_total:2500,salary_auto_remaining:2500,salary_deduction:2500,cash_after_salary_auto:33400});data.cash_drawer.payroll[0].configured=0;data.cash_drawer.payroll[0].outstanding=0;data.cash_drawer.payroll[1].configured=2500;data.cash_drawer.payroll[1].outstanding=2500;
 const errors=await boot(page,data,'admin');await expect(amount(page,'payroll-total')).toContainText(/2\s*500/);await expect(amount(page,'cash-balance')).toContainText(/33\s*400/);
 await expect(page.locator('#salaryAmount5-nurse-1')).toHaveValue('0');await expect(page.locator('#salaryAmount5-nurse-2')).toHaveValue('2500');
 expect(await page.evaluate(()=>__autoSalaryReport.staff.map(person=>person.amount))).toEqual([0,2500]);expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('known opening, deposits and other cash outflow are retained in the server final balance',async({page})=>{
 const data=report();Object.assign(data.cash_drawer,{opening_confirmed:true,opening:500,cash_in:100,cash_out:200,balance:36300,cash_after_salary_auto:32300});
 const errors=await boot(page,data);await expect(amount(page,'cash-balance')).toContainText(/32\s*300/);await openDrawer(page);await expect(page.locator('#cashBalanceV30')).toContainText(/32\s*300/);expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('a cash shortage remains negative rather than clamping it to zero',async({page})=>{
 const data=report();Object.assign(data.revenue,{cash:1000,terminal:5400,owner_card:500,total:6900});Object.assign(data.cash_drawer,{received_cash:1000,balance:null,cash_after_salary_auto:-3000});
 const errors=await boot(page,data);await expect(amount(page,'cash-balance')).toContainText(/[-−]\s*3\s*000/);await openDrawer(page);await expect(page.locator('#cashBalanceV30')).toContainText(/[-−]\s*3\s*000/);expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('terminal, card, waiting patients and separate debt repayment never inflate salary-adjusted cash',async({page})=>{
 const data=report({pending_total:7000,loan_debt_total:15000,debt_repayments_total:80000});data.revenue={cash:35900,terminal:120000,owner_card:90000,total:245900};
 data.receipts=[{id:'old-loan',receipt_kind:'debt_repayment',at:'2026-10-16T07:00:00Z',patient:'Старый долг отдельно',paid_total:80000,payments:{cash:80000}}];
 const errors=await boot(page,data);await expect(amount(page,'cash')).toContainText(/35\s*900/);await expect(amount(page,'cash-balance')).toContainText(/31\s*900/);await expect(amount(page,'pending')).toContainText('Это не долг');
 const printed=await page.evaluate(()=>buildShiftPrintV5(__autoSalaryReport));expect(printed).not.toContain('Старый долг отдельно');expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('screen, PDF and CSV use the same server payroll and cash and escape employee names',async({page})=>{
 const errors=await boot(page,report(),'admin');const screen=await amount(page,'cash-balance').textContent();
 await page.click('#reportPrintV5');await page.emulateMedia({media:'print'});await expect(page.locator('#shiftPrintV5 [data-summary-key="cash-balance"]')).toHaveText(screen);
 await expect(page.locator('#shiftPrintV5')).toContainText('Патя <img src=x>');await expect(page.locator('#shiftPrintV5 img,#shiftPrintV5 script,#shiftPrintV5 input')).toHaveCount(0);
 const csv=await page.evaluate(()=>buildFinanceCsvV5(__autoSalaryReport));expect(csv).toMatch(/"[^"]*после зарплаты[^"]*";"31900"/);expect(csv).toMatch(/"Зарплата[^\r\n]*"4000"/);expect(csv).not.toContain('Не рассчитан');expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('period totals are distinct from the last shift cash and an entity filter cannot borrow that cash',async({page})=>{
 const data=report({from:'2026-10-15',to:'2026-10-16',rows:[],shifts:[],payroll_total:8000});data.cash_drawer.scope='latest_shift';data.cash_drawer.shift_id='auto-salary-shift';data.revenue={cash:95900,terminal:12000,owner_card:9000,total:116900};
 const errors=await boot(page,data,'admin');const summaries=await page.evaluate(()=>{
  const full=renderFinanceSummaryV5(__autoSalaryReport,'reportsV5'),filtered={...__autoSalaryReport,payroll_scope:'not_applicable_to_entity_filter'};
  return {full,filtered:renderFinanceSummaryV5(filtered,'reportsV5'),csv:buildFinanceCsvV5(filtered)};
 });
 await page.evaluate(html=>{document.getElementById('reportBody').innerHTML=html},summaries.full);await expect(amount(page,'payroll-total')).toContainText(/8\s*000/);await expect(amount(page,'cash-balance')).toContainText('последней смены');await expect(amount(page,'cash-balance')).toContainText(/31\s*900/);await expect(amount(page,'cash-balance')).not.toContainText(/91\s*900/);
 await page.evaluate(html=>{document.getElementById('reportBody').innerHTML=html},summaries.filtered);await expect(amount(page,'cash-balance')).toContainText('Не применяется к этому фильтру');expect(summaries.csv).toContain('Не применяется к этому фильтру');expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('an older server response without automatic payroll keeps the explicit physical balance',async({page})=>{
 const data=report();for(const key of ['salary_auto','salary_auto_total','salary_auto_remaining','salary_deduction','cash_after_salary_auto'])delete data.cash_drawer[key];Object.assign(data.cash_drawer,{opening_confirmed:true,opening:0,salary_paid:1000,balance:34900});
 const errors=await boot(page,data);await expect(amount(page,'cash-balance')).toContainText(/34\s*900/);await openDrawer(page);await expect(page.locator('#cashBalanceV30')).toContainText(/34\s*900/);expect(await writes(page)).toEqual([]);expect(errors).toEqual([]);
});
