const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
const fixture=()=>({date:'2026-10-13',time_zone:'Europe/Moscow',working_day:{patients_count:14,procedures_count:18,sales_count:0,revenue:{cash:31500,terminal:3800,owner_card:0,total:35300},charge_total:35300,debt_total:0,debt_created_total:3800,debt_payments_total:3800,payroll_total:4000,payroll_unknown:0,payroll_complete:true,cash_after_salary:31300,cash_drawer:{opening_confirmed:true,opening:500,received_cash:31500,salary_paid:2000,cash_in:0,cash_out:300,balance:29700},has_open_shifts:false},receipts_day:{revenue:{cash:51100,terminal:9000,owner_card:0,total:60100},debt_payments_total:11300,breakdown:{current_day_shifts:{total:35300},previous_day_shifts:{total:24800}}}});
async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await page.evaluate(async({role,data})=>{
  currentStaff={id:'dashboard-admin',full_name:'Администратор',role,active:true};inventory=[];meds=[];
  __dashboardData=data;__dashboardCalls=[];__dashboardLost=false;__dashboardHold=false;
  loadInventory=async()=>true;
  db.rpc=async(name,args)=>{__dashboardCalls.push({name,args});if(__dashboardLost){__dashboardLost=false;throw new TypeError('Load failed')}
   if(__dashboardHold){__dashboardHold=false;await new Promise(resolve=>window.__dashboardRelease=resolve)}
   return {data:structuredClone(__dashboardData),error:null};};
  show('workspace');await refreshOwnerDashboardV5();
 },{role,data:fixture()});return errors;
}
test('dashboard shows 14 distinct shift patients and 18 procedures with separately explained calendar revenue',async({page})=>{
 const errors=await boot(page),working=page.locator('[data-dashboard-section="shifts"]'),calendar=page.locator('[data-dashboard-section="calendar"]');
 await expect(working).toContainText('Смены за 13.10.2026');await expect(working.locator('[data-dashboard-stat="patients"] b')).toHaveText('14');
 await expect(working.locator('[data-dashboard-stat="procedures"] b')).toHaveText('18');await expect(working.locator('[data-summary-key="revenue"]')).toContainText(/35\s*300/);
 await expect(working).toContainText(/29\s*700/);await expect(working).not.toContainText(/60\s*100/);
 await expect(calendar).toContainText('Подробнее: оплаты за календарный день');await expect(calendar).toContainText(/60\s*100/);
 await expect(calendar).toContainText('Обычные оплаты по дате получения');
 await expect(calendar).toContainText('Погашения долгов сюда не входят');expect(await page.evaluate(()=>__dashboardCalls)).toHaveLength(1);expect(errors).toEqual([]);
});
test('both dashboard sections fit a narrow phone screen',async({page})=>{
 await page.setViewportSize({width:375,height:812});const errors=await boot(page);
 await expect(page.locator('[data-dashboard-stat="patients"] b')).toHaveText('14');
 const widths=await page.evaluate(()=>({viewport:innerWidth,body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));
 expect(widths.body).toBeLessThanOrEqual(widths.viewport+1);expect(widths.document).toBeLessThanOrEqual(widths.viewport+1);expect(errors).toEqual([]);
});
test('transient reads recover while a late result cannot show administrator finances to a nurse',async({page})=>{
 const errors=await boot(page);await page.evaluate(async()=>{__dashboardLost=true;await refreshOwnerDashboardV5()});
 await expect(page.locator('[data-dashboard-stat="patients"] b')).toHaveText('14');expect(await page.evaluate(()=>__dashboardCalls.length)).toBe(3);
 await page.evaluate(()=>{__dashboardHold=true;void refreshOwnerDashboardV5()});await page.waitForFunction(()=>typeof __dashboardRelease==='function');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'dashboard-nurse',role:'nurse',active:true};__dashboardRelease()});
 await expect(page.locator('#ownerDashboardV5')).toBeEmpty();
 await expect(page.locator('[data-dashboard-section]')).toHaveCount(0);expect(errors).toEqual([]);
});
test('nurse workspace never asks for manager daily totals',async({page})=>{
 const errors=await boot(page,'nurse');await expect(page.locator('#ownerDashboardV5')).toHaveCount(0);
 expect(await page.evaluate(()=>__dashboardCalls)).toEqual([]);expect(errors).toEqual([]);
});
