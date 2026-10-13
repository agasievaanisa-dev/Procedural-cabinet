const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const clone=value=>JSON.parse(JSON.stringify(value));
function sample(){return {date:'2026-10-13',time_zone:'Europe/Moscow',working_day:{patients_count:14,procedures_count:18,sales_count:0,revenue:{cash:31500,terminal:3800,owner_card:0,total:35300},charge_total:35300,debt_total:0,debt_created_total:3800,debt_payments_total:3800,payroll_total:4000,payroll_unknown:0,payroll_complete:true,cash_after_salary:31300,has_open_shifts:true},receipts_day:{revenue:{cash:51100,terminal:9000,owner_card:0,total:60100},debt_payments_total:11300,breakdown:{current_day_shifts:{total:35300},previous_day_shifts:{total:24800}}}};}
function boot(role='admin'){
 const elements=new Map(),calls=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{id,innerHTML:'',classList:{contains:()=>false},appendChild(node){elements.set(node.id,node)}});return elements.get(id)};
 element('workspace');
 const c={Map,Set,Date,JSON,Math,Number,String,Promise,Error,crypto:require('node:crypto').webcrypto,
  currentStaff:{id:'admin-1',role},shift:null,meds:[],inventory:[],services:[],patients:[],nurses:[],
  document:{createElement:()=>({innerHTML:''})},$:id=>elements.get(id),window:{},
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  num:value=>Number(value||0),rub:value=>Number(value||0)+' ₽',qty:value=>String(value||0),
  isManager:()=>['owner','admin'].includes(c.currentStaff?.role),localDateValue:()=> '2026-10-13',
  loadInventory:async()=>true,enterApp:async()=>{},signOut:async()=>{c.currentStaff=null},refreshDashboard:async()=>{},
  prepareTreatment4:async()=>{},calcProcedure(){},calcSale(){},originalSaveTreatment4:async()=>{},
  setTimeout:callback=>callback(),db:{rpc:async(name,args)=>{calls.push({name,args});return {data:clone(sample())}}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../crm-finance-v5.js','utf8'),c);
 return {c,elements,calls};
}
test('dashboard separates distinct shift patients, repeated procedures and calendar payments',()=>{
 const {c}=boot(),html=c.financeDashboardHtmlV25(sample());
 assert.match(html,/Смены за 13\.10\.2026/);assert.match(html,/data-dashboard-stat="patients">Пациентов<b>14<\/b>/);
 assert.match(html,/data-dashboard-stat="procedures">Процедур<b>18<\/b>/);
 assert.match(html,/data-dashboard-stat="revenue">Выручка смен<b>35300 ₽<\/b>/);
 assert.match(html,/Поступления за календарный день · 13\.10\.2026/);
 assert.match(html,/В сменах прошлых дней<\/span><b>24800 ₽/);
 for(const text of ['60100 ₽','11300 ₽ · уже включены','Первоначально не оплачено','31300 ₽','Зарплата за эти смены: 4000 ₽','Каждый пациент учитывается один раз','Погашение старого долга не добавляет пациента'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('56100 ₽'),'Calendar cash must not be presented as the shift remainder');
 assert.ok(!html.includes('data-dashboard-stat="sales"'));
});
test('unknown payroll, sales and future/legacy shift contributions stay explicit and escaped',()=>{
 const {c}=boot(),data=sample();Object.assign(data.working_day,{sales_count:2,payroll_complete:false,payroll_unknown:1,cash_after_salary:null});
 data.receipts_day.breakdown.other_day_shifts={total:100};data.date='<img src=x onerror=bad()>';
 const html=c.financeDashboardHtmlV25(data);
 assert.ok(html.includes('Продаж<b>2</b>'));assert.ok(html.includes('В других сменах'));
 assert.ok(html.includes('Не рассчитан: укажите зарплату за прошлые смены'));assert.ok(html.includes('Не задана зарплата для 1'));
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
});
test('owner dashboard requests scoped read-only RPC while normal summaries stay unchanged',async()=>{
 const {c,elements,calls}=boot();await c.refreshOwnerDashboardV5();
 assert.deepEqual(clone(calls),[{name:'crm_dashboard_day_v25',args:{p_date:'2026-10-13'}}]);
 assert.ok(elements.get('ownerDashboardV5').innerHTML.includes('Пациентов<b>14'));
 await c.crmFinanceRpcV5('summary',{from:'2026-10-01',to:'2026-10-13'});
 assert.deepEqual(clone(calls[1]),{name:'crm_finance_v5',args:{p_action:'summary',p_payload:{from:'2026-10-01',to:'2026-10-13'}}});
});
test('a transient dashboard read retries once, business errors do not retry',async()=>{
 const {c}=boot();let attempts=0;c.db.rpc=async()=>{if(++attempts===1)throw new TypeError('Load failed');return {data:sample()}};
 assert.equal((await c.financeDashboardRpcV25('2026-10-13')).working_day.patients_count,14);assert.equal(attempts,2);
 attempts=0;c.db.rpc=async()=>{attempts++;return {error:{code:'42501',message:'Нет доступа'}}};
 await assert.rejects(c.financeDashboardRpcV25('2026-10-13'),/Нет доступа/);assert.equal(attempts,1);
});
test('nurses do not read owner dashboard and late owner responses cannot render in another account',async()=>{
 const {c,elements,calls}=boot('nurse');await c.refreshOwnerDashboardV5();assert.equal(calls.length,0);assert.ok(!elements.has('ownerDashboardV5'));
 await assert.rejects(c.financeDashboardRpcV25('2026-10-13'),/Учётная запись изменилась/);
 c.currentStaff={id:'admin-1',role:'admin'};let release;c.db.rpc=()=>new Promise(resolve=>release=resolve);
 const pending=c.refreshOwnerDashboardV5();c.currentStaff={id:'nurse-2',role:'nurse'};release({data:sample()});await pending;
 assert.equal(elements.get('ownerDashboardV5').innerHTML,'');
});
test('a slow older refresh cannot overwrite the latest dashboard result',async()=>{
 const {c,elements}=boot(),releases=[];c.db.rpc=()=>new Promise(resolve=>releases.push(resolve));
 const old=c.refreshOwnerDashboardV5(),latest=c.refreshOwnerDashboardV5();
 releases[1]({data:sample()});await latest;
 const stale=sample();stale.working_day.patients_count=9;releases[0]({data:stale});await old;
 assert.match(elements.get('ownerDashboardV5').innerHTML,/data-dashboard-stat="patients">Пациентов<b>14<\/b>/);
});
