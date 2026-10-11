const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

function boot() {
 const elements = new Map(),listeners = new Map(),messages = [];
 function element(id) {
  if (!elements.has(id)) {
   const classes = new Set();
   elements.set(id,{id,innerHTML:'',disabled:false,textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on??!classes.has(x))classes.add(x);else classes.delete(x)}},querySelector:()=>element('reportButton'),setAttribute(){},remove(){elements.delete(this.id)}});
  }
  return elements.get(id);
 }
 const document = {body:element('body'),getElementById:id=>elements.get(id),createElement:()=>({innerHTML:'',remove(){elements.delete(this.id)}})};
 document.body.appendChild=node=>elements.set(node.id,node);
 const c = {Map,Set,Date,JSON,Math,Number,String,Promise,Error,crypto:require('node:crypto').webcrypto,document,$:element,currentStaff:{id:'nurse-1',role:'nurse'},shift:{id:'shift-1'},
  num:value=>Number(value||0),qty:value=>String(value||0),rub:value=>Number(value||0)+' ₽',esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
  isManager:()=>c.currentStaff?.role==='owner',shiftLabel:()=> '08:30–16:00',message:(...args)=>messages.push(args),show:id=>element(id).classList.add('active'),
  window:{print(){c.printCalls++},addEventListener:(name,handler)=>listeners.set(name,handler)},printCalls:0,meds:[],services:[],patients:[],nurses:[],inventory:[],rows:()=>[],
  prepareTreatment4:async()=>{},calcProcedure(){},calcSale(){},originalSaveTreatment4:async()=>{},enterApp:async()=>{},signOut:async()=>{},refreshDashboard:async()=>{},db:{rpc:async()=>({error:{message:'TypeError: Load failed'}})}};
 let navigation=0;c.beginQuickNavigation4=()=>++navigation;c.quickNavigationCurrent4=(token,actor)=>token===navigation&&actor===c.currentStaff?.id;
 vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../crm-finance-v5.js','utf8'),c);
 return {c,element,elements,listeners,messages};
}

function report() {
 return {shift:{id:'shift-1',date:'2026-10-11',started_at:'2026-10-11T05:30:00Z',planned_end_at:'2026-10-11T13:00:00Z',status:'closed'},staff:[{id:'nurse-1',full_name:'Наталья <img src=x>',amount:99991},{id:'nurse-2',full_name:'Лилия',amount:99992}],patients_count:3,procedures_count:2,sales_count:1,
  revenue:{cash:700,terminal:300,owner_card:100,total:1100},charge_total:1300,debt_total:200,payroll_total:99993,cash_after_salary:99994,
  used:[{name:'Скрытое складское списание',quantity:7}],untracked:[{name:'Скрытая операция без списания',quantity:8}],stock:[{name:'Скрытый запас',reserve:99995,work:99996}],warnings:[{name:'Скрытое предупреждение'}],
  procedures:[{id:'later',at:'2026-10-11T09:00:00Z',patient:'Анна <script>bad()</script>',nurse:'Наталья',type:'Капельница',services:[{name:'Капельница со своими препаратами',quantity:1,line_total:500},{name:'Дополнительный внутримышечный укол',quantity:1,line_total:100}],items:[{name:'Милдронат 5 мл',quantity:2,unit:'амп.',line_total:600}],own_medications:[{name:'Препарат пациента 10 мл',quantity:1,unit:'фл.'}],list_total:1200,charge_total:1000,paid_total:800,debt_total:200,discount_amount:200,discount_reason:'Постоянная скидка',discount_comment:'Согласовано с владельцем',payments:{cash:500,terminal:300,owner_card:0}},
   {id:'free',at:'2026-10-11T10:00:00Z',patient:'Бесплатная процедура',nurse:'Лилия',type:'Внутривенный укол',own_medications:[{name:'Препарат пациента',quantity:1,unit:'амп.'}],items:[],list_total:300,charge_total:0,paid_total:0,debt_total:0,discount_amount:300,discount_reason:'Помощь пациенту'}],
  sales:[{id:'earlier',at:'2026-10-11T08:00:00Z',patient:'Первый пациент',nurse:'Лилия',items:[{name:'Физраствор 250 мл',quantity:1,unit:'фл.',line_total:300}],list_total:300,charge_total:300,paid_total:300,debt_total:0,payments:{cash:200,terminal:0,owner_card:100}}]};
}

test('shift PDF includes chronological patients, full services, medicines, discounts, debt and cash totals',()=>{
 const {c}=boot(),html=c.buildShiftPrintV5(report());
 assert.ok(html.indexOf('Первый пациент')<html.indexOf('Анна &lt;script&gt;'));
 assert.ok(html.indexOf('Анна &lt;script&gt;')<html.indexOf('Бесплатная процедура'));
 for (const expected of ['Наталья &lt;img','Лилия','08:30–16:00','11.10.2026, 12:00','Капельница со своими препаратами','Дополнительный внутримышечный укол','Милдронат 5 мл × 2 амп.','Препарат пациента 10 мл × 1 фл.','По прайсу:','Стоимость:','Оплачено:','В долг:','200 ₽','Согласовано с владельцем','Бесплатно','Итоги смены','1300 ₽','1100 ₽','700 ₽','300 ₽','100 ₽']) assert.ok(html.includes(expected),expected);
 for(const secret of ['Скрыт','9999','Зарплата','Списано со склада','Остатки','Без списания со склада','<script>bad()','<img src=x>']) assert.ok(!html.includes(secret),secret);
});

test('nurse own shift shows finances without warehouse while owner keeps stock on the application screen',()=>{
 const {c,element}=boot();c.renderShiftReportV5(report(),true);
 let html=element('reportBody').innerHTML;
 for (const expected of ['Общая выручка','1100 ₽','Стоимость процедур и продаж','1300 ₽','В долг','200 ₽','Согласовано с владельцем']) assert.ok(html.includes(expected),expected);
 for (const secret of ['Скрыт','9999','Зарплата','Списано со склада','Остатки']) assert.ok(!html.includes(secret),secret);
 c.currentStaff.role='owner';c.renderShiftReportV5(report(),true);html=element('reportBody').innerHTML;
 assert.ok(html.includes('Скрытый запас'));assert.ok(html.includes('99993'));assert.ok(html.includes('report-warehouse-v5'));
 assert.ok(!c.buildShiftPrintV5(report()).includes('99993'));
});

test('printing requires a current actor snapshot and print DOM is removed after printing or sign-out',async()=>{
 const {c,elements,listeners,messages,element}=boot();
 c.printShiftReportV5();assert.equal(c.printCalls,0);assert.match(messages.at(-1)[1],/Сначала откройте/);
 c.renderShiftReportV5(report(),true);c.printShiftReportV5();assert.equal(c.printCalls,1);assert.ok(elements.get('shiftPrintV5'));assert.equal(element('body').classList.contains('crm-shift-printing-v5'),true);
 listeners.get('afterprint')();assert.ok(!elements.get('shiftPrintV5'));assert.equal(element('body').classList.contains('crm-shift-printing-v5'),false);
 c.currentStaff.id='another-nurse';c.printShiftReportV5();assert.equal(c.printCalls,1);assert.ok(!elements.get('shiftPrintV5'));
 c.currentStaff.id='nurse-1';c.renderShiftReportV5(report(),true);c.printShiftReportV5();await c.signOut();assert.ok(!elements.get('shiftPrintV5'));c.printShiftReportV5();assert.equal(c.printCalls,2);
});

test('snapshot preserves report values and new failed loading cannot print a previous shift',async()=>{
 const {c,elements}=boot(),data=report();c.renderShiftReportV5(data,true);data.procedures[0].paid_total=123456;c.printShiftReportV5();assert.ok(!elements.get('shiftPrintV5').innerHTML.includes('123456'));
 c.db.rpc=async()=>({error:{code:'P0001',message:'Эта смена вам недоступна'}});
 await c.openReportByIdV5('another-shift');c.printShiftReportV5();assert.equal(c.printCalls,1);assert.ok(!elements.get('shiftPrintV5'));
});

test('additional collections are printed on their collection shift without becoming a second procedure charge',()=>{
 const {c}=boot(),data=report();
 data.procedures[0].received_total=1000;data.procedures[0].debt_total=0;
 data.receipts=[{id:'receipt-1',kind:'debt_payment',at:'2026-10-11T09:30:00Z',patient:'Погашение долга',nurse:'Лилия',paid_total:200,payments:{cash:200,terminal:0,owner_card:0},comment:'Закрыт прошлый долг'}];
 const html=c.buildShiftPrintV5(data);
 assert.ok(html.indexOf('Анна &lt;script&gt;')<html.indexOf('<h2>Погашение долга</h2>'));
 assert.ok(html.indexOf('<h2>Погашение долга</h2>')<html.indexOf('<h2>Бесплатная процедура</h2>'));
 assert.ok(html.includes('Оплачено всего:'));assert.ok(html.includes('Первоначальная оплата в этой смене: 800 ₽'));
 const receiptSection=html.split('<h2>Погашение долга</h2>')[1].split('</li>')[0];
 assert.ok(receiptSection.includes('Получено: 200 ₽'));assert.ok(receiptSection.includes('Закрыт прошлый долг'));assert.ok(!receiptSection.includes('По прайсу'));
 assert.ok(html.includes('1300 ₽'),'Debt repayment must not create a new charge');
});

test('period finance HTML and CSV distinguish collected cash from charges and current debt',()=>{
 const {c}=boot(),data={from:'2026-10-01',to:'2026-10-11',revenue:{cash:500,terminal:200,owner_card:300,total:1000},charge_total:2000,debt_created_total:1100,debt_total:900,debt_payments_total:100,debt_payments_count:1,rows:[{label:'Пациент',revenue:{total:1000},charge_total:2000,debt_created_total:1100,debt_total:900,debt_payments_total:100}],shifts:[]};
 const html=c.renderFinanceSummaryV5(data,'reportsV5'),csv=c.buildFinanceCsvV5(data);
 for(const phrase of ['Начислено за период','Остаток долга по записям периода','Первоначально в долг','Доплаты и погашение долга','момент формирования отчёта']) {assert.ok(html.includes(phrase),phrase);assert.ok(csv.includes(phrase),phrase);}
 for(const amount of ['2000','1100','900','1000']) {assert.ok(html.includes(amount),amount);assert.ok(csv.includes(amount),amount);}
 assert.ok(html.includes('по дате получения денег'));assert.ok(csv.includes('по дате получения денег'));
});
