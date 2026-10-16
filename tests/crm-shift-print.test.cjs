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
 return {shift:{id:'shift-1',date:'2026-10-11',started_at:'2026-10-11T05:30:00Z',planned_end_at:'2026-10-11T13:00:00Z',status:'closed'},staff:[{id:'nurse-1',full_name:'Наталья <img src=x>',amount:2000,reason:'Скрытая причина зарплаты'},{id:'nurse-2',full_name:'Лилия',amount:2500}],patients_count:3,procedures_count:2,sales_count:1,
  revenue:{cash:700,terminal:300,owner_card:100,total:1100},charge_total:1300,debt_total:200,payroll_total:4500,payroll_complete:true,payroll_unknown:0,cash_after_salary:-3400,cash_drawer:{opening_confirmed:true,opening:5000,received_cash:700,salary_paid:2000,cash_in:0,cash_out:300,balance:3400},
  used:[{name:'Скрытое складское списание',quantity:7}],untracked:[{name:'Скрытая операция без списания',quantity:8}],stock:[{name:'Скрытый запас',reserve:99995,work:99996}],warnings:[{name:'Скрытое предупреждение'}],
  procedures:[{id:'later',at:'2026-10-11T09:00:00Z',patient:'Анна <script>bad()</script>',nurse:'Наталья',type:'Капельница',services:[{name:'Капельница со своими препаратами',quantity:1,line_total:500},{name:'Дополнительный внутримышечный укол',quantity:1,line_total:100}],items:[{name:'Милдронат 5 мл',quantity:2,unit:'амп.',line_total:600}],own_medications:[{name:'Препарат пациента 10 мл',quantity:1,unit:'фл.'}],list_total:1200,charge_total:1000,paid_total:800,debt_total:200,discount_amount:200,discount_reason:'Постоянная скидка',discount_comment:'Согласовано с владельцем',payments:{cash:500,terminal:300,owner_card:0}},
   {id:'free',at:'2026-10-11T10:00:00Z',patient:'Бесплатная процедура',nurse:'Лилия',type:'Внутривенный укол',own_medications:[{name:'Препарат пациента',quantity:1,unit:'амп.'}],items:[],list_total:300,charge_total:0,paid_total:0,debt_total:0,discount_amount:300,discount_reason:'Помощь пациенту'}],
  sales:[{id:'earlier',at:'2026-10-11T08:00:00Z',patient:'Первый пациент',nurse:'Лилия',items:[{name:'Физраствор 250 мл',quantity:1,unit:'фл.',line_total:300}],list_total:300,charge_total:300,paid_total:300,debt_total:0,payments:{cash:200,terminal:0,owner_card:100}}]};
}

test('shift PDF includes chronological patients, full services, medicines, discounts, debt and cash totals',()=>{
 const {c}=boot(),html=c.buildShiftPrintV5(report());
 assert.ok(html.indexOf('Первый пациент')<html.indexOf('Анна &lt;script&gt;'));
 assert.ok(html.indexOf('Анна &lt;script&gt;')<html.indexOf('Бесплатная процедура'));
 for (const expected of ['Наталья &lt;img','Лилия','08:30–16:00','11.10.2026, 12:00','Капельница со своими препаратами','Дополнительный внутримышечный укол','Милдронат 5 мл × 2 амп.','Препарат пациента 10 мл × 1 фл.','По прайсу:','К оплате:','Оплачено:','Долг:','200 ₽','Согласовано с владельцем','Бесплатно','Итоги смены','1300 ₽','1100 ₽','700 ₽','300 ₽','100 ₽','Зарплата за смену','2000 ₽','2500 ₽','4500 ₽','Остаток наличных в кассе','3400 ₽']) assert.ok(html.includes(expected),expected);
 for(const secret of ['Скрыт','99995','99996','Списано со склада','Остатки','Без списания со склада','salaryAmount5-','salaryReason5-','saveSalaryV5(','<script>bad()','<img src=x>']) assert.ok(!html.includes(secret),secret);
});

test('patient-assigned dose is escaped in shift journal and PDF without changing captured prices or totals',()=>{
 const {c,element}=boot(),data=report();
 Object.assign(data.procedures[0].items[0],{dosage:'500 мг / 5 мл',dose:'250 мг <img src=x onerror="bad()">'});
 c.renderShiftReportV5(data,true);
 const journal=element('reportBody').innerHTML,printed=c.buildShiftPrintV5(data);
 const row='Милдронат 5 мл · 500 мг / 5 мл × 2 амп. · Доза: 250 мг &lt;img src=x onerror=&quot;bad()&quot;&gt; · 600 ₽';
 for(const html of [journal,printed]){
  assert.ok(html.includes(row));
  for(const total of ['1300 ₽','1100 ₽','4500 ₽','3400 ₽'])assert.ok(html.includes(total),total);
  assert.ok(!html.includes('<img src=x'));
 }
 data.procedures[0].items[0].dose=null;
 assert.ok(!c.buildShiftPrintV5(data).includes('Доза:'));
});

test('above-pricelist charge shows surcharge in finance and print without adding it to received cash',()=>{
 const {c,element}=boot(),data=report();
 Object.assign(data.procedures[0],{list_total:1200,charge_total:1500,paid_total:800,debt_total:700,discount_amount:0,discount_reason:'Индивидуальная стоимость',discount_comment:'Дополнительная работа <b>по согласованию</b>'});
 data.charge_total=1800;data.debt_total=700;
 c.renderShiftReportV5(data,true);
 for(const html of [c.financeEventPaymentHtmlV5(data.procedures[0]),element('reportBody').innerHTML,c.buildShiftPrintV5(data)]){
  for(const phrase of ['По прайсу: <b>1200 ₽','Скидка: <b>0 ₽','Надбавка: <b>300 ₽','К оплате: <b>1500 ₽','Оплачено: <b>800 ₽','Долг: <b>700 ₽','Наличные: <b>500 ₽','Терминал: <b>300 ₽','Дополнительная работа &lt;b&gt;по согласованию&lt;/b&gt;'])assert.ok(html.includes(phrase),phrase);
  assert.ok(!html.includes('Скидка: <b>-'));assert.ok(!html.includes('<b>по согласованию</b>'));
 }
 for(const html of [element('reportBody').innerHTML,c.buildShiftPrintV5(data)]){
  for(const unchanged of ['1100 ₽','700 ₽','300 ₽','100 ₽','4500 ₽','3400 ₽'])assert.ok(html.includes(unchanged),unchanged);
  assert.ok(html.includes('1800 ₽'),'Accrued amount includes surcharge, collected revenue stays unchanged');
 }
 assert.ok(!c.financeEventPriceHtmlV14({list_total:1200,charge_total:1000}).includes('Надбавка:'));
});

test('event finance and ordinary receipts identify exact mixed methods while debt repayments stay separate',()=>{
 const {c}=boot(),event={paid_total:125.25,received_total:875.25,charge_total:1000,debt_total:124.75,payments:{cash:125.25,terminal:250,owner_card:300,unclassified:0},debt_repayments_total:200};
 const data=report();data.procedures=[{...data.procedures[0],...event}];
 for(const html of [c.financeEventPaymentHtmlV5(event),c.buildShiftPrintV5(data)]){
  for(const phrase of ['Наличные: <b>125.25 ₽','Терминал: <b>250 ₽','Перевод на карту начальника: <b>300 ₽','Погашено долга отдельно: <b>200 ₽','не входит в сумму и наличные смены'])assert.ok(html.includes(phrase),phrase);
 }
 const receipt=c.financeReceiptHtmlV5({paid_total:550,payments:{terminal:250,owner_card:300}});
 assert.ok(receipt.includes('Терминал: <b>250 ₽'));assert.ok(receipt.includes('Перевод на карту начальника: <b>300 ₽'));assert.ok(!receipt.includes('data-payment-method="cash"'));
 assert.equal(c.financeShiftSummaryAmountsV16(data).procedures,125.25,'Adding method labels must not change shift income');
});

test('event payment labels never invent cash for legacy, pending or malformed splits',()=>{
 const {c}=boot();
 const legacy=c.financeEventPaymentHtmlV5({received_total:800,charge_total:800,payments:null});
 assert.ok(legacy.includes('Способ оплаты не указан: <b>800 ₽'));assert.ok(!legacy.includes('data-payment-method="cash"'));
 const pending=c.financeEventPaymentHtmlV5({received_total:0,charge_total:800,debt_total:800,payment_pending:true,payments:{cash:0,terminal:0,owner_card:0}});
 assert.ok(pending.includes('Ожидает оплаты'));assert.ok(!pending.includes('data-payment-method='));
 const invalid=c.financeEventMethodsHtmlV34({received_total:800,payments:{cash:-20,terminal:200,owner_card:Infinity}});
 assert.ok(invalid.includes('Терминал: <b>200 ₽'));assert.ok(invalid.includes('Способ оплаты не указан: <b>600 ₽'));assert.ok(!invalid.includes('Infinity'));assert.ok(!invalid.includes('-20'));
 const inconsistent=c.financeEventMethodsHtmlV34({received_total:800,payments:{cash:99999},debt_repayments_total:1000});
 assert.ok(inconsistent.includes('Способ оплаты не указан: <b>800 ₽'));assert.ok(!inconsistent.includes('99999'));assert.ok(!inconsistent.includes('Погашено долга отдельно'));
});

test('shift ordinary-only received amount does not subtract separate debt receipts from channels twice',()=>{
 const {c}=boot(),data=report();
 Object.assign(data.procedures[0],{paid_total:125.25,received_total:675.25,lifetime_received_total:875.25,debt_repayments_total:200,payments:{cash:125.25,terminal:250,owner_card:300,unclassified:0,total:675.25},payments_complete:true});
 const before=c.financeShiftSummaryAmountsV16(data);
 for(const html of [c.financeEventPaymentHtmlV5(data.procedures[0]),c.buildShiftPrintV5(data)]){
  for(const phrase of ['Наличные: <b>125.25 ₽','Терминал: <b>250 ₽','Перевод на карту начальника: <b>300 ₽','Погашено долга отдельно: <b>200 ₽','Оплачено всего: <b>675.25 ₽'])assert.ok(html.includes(phrase),phrase);
  assert.ok(!html.includes('Способ оплаты не указан'));
 }
 assert.equal(c.financeShiftSummaryAmountsV16(data).procedures,125.25);
 assert.deepEqual(c.financeShiftSummaryAmountsV16(data),before,'Rendering must not change shift financial totals');
});

test('nurse own shift shows finances without warehouse while owner keeps stock on the application screen',()=>{
 const {c,element}=boot();c.renderShiftReportV5(report(),true);
 let html=element('reportBody').innerHTML;
 for (const expected of ['Получено за смену','1100 ₽','Стоимость процедур и продаж','1300 ₽','Долг','200 ₽','Согласовано с владельцем','Зарплата за смену','2000 ₽','2500 ₽','4500 ₽','Остаток наличных в кассе','3400 ₽']) assert.ok(html.includes(expected),expected);
 for (const secret of ['Скрыт','99995','99996','Списано со склада','Остатки','salaryAmount5-','salaryReason5-','saveSalaryV5(']) assert.ok(!html.includes(secret),secret);
 c.currentStaff.role='owner';c.renderShiftReportV5(report(),true);html=element('reportBody').innerHTML;
 assert.ok(html.includes('Скрытый запас'));assert.ok(html.includes('4500'));assert.ok(html.includes('salaryAmount5-nurse-1'));assert.ok(html.includes('report-warehouse-v5'));
 assert.ok(c.buildShiftPrintV5(report()).includes('4500 ₽'));assert.ok(!c.buildShiftPrintV5(report()).includes('99995'));assert.ok(!c.buildShiftPrintV5(report()).includes('Скрытая причина зарплаты'));
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

test('ordinary after-procedure collections print on their collection shift without a second procedure charge',()=>{
 const {c}=boot(),data=report();
 data.procedures[0].received_total=1000;data.procedures[0].debt_total=0;
 data.receipts=[{id:'receipt-1',receipt_kind:'pending_payment',at:'2026-10-11T09:30:00Z',patient:'Оплата после процедуры',nurse:'Лилия',paid_total:200,payments:{cash:200,terminal:0,owner_card:0},comment:'Оплата после капельницы'}];
 const html=c.buildShiftPrintV5(data);
 assert.ok(html.indexOf('Анна &lt;script&gt;')<html.indexOf('<h2>Оплата после процедуры</h2>'));
 assert.ok(html.indexOf('<h2>Оплата после процедуры</h2>')<html.indexOf('<h2>Бесплатная процедура</h2>'));
 assert.ok(html.includes('Оплачено всего:'));assert.equal(c.financeShiftSummaryAmountsV16(data).procedures,800,'Lifetime collections cannot increase original shift income');
 const receiptSection=html.split('<h2>Оплата после процедуры</h2>')[1].split('</li>')[0];
 assert.ok(receiptSection.includes('Получено: 200 ₽'));assert.ok(receiptSection.includes('Оплата после капельницы'));assert.ok(!receiptSection.includes('По прайсу'));
 assert.ok(html.includes('1300 ₽'),'Debt repayment must not create a new charge');
});

test('period finance HTML and CSV keep ordinary collections, debt, waiting and drawer cash separate',()=>{
 const {c}=boot(),data={from:'2026-10-01',to:'2026-10-11',revenue:{cash:500,terminal:200,owner_card:300,total:1000},charge_total:2000,debt_total:900,loan_debt_total:700,pending_total:200,debt_payments_total:100,debt_payments_count:1,cash_drawer:{opening_confirmed:true,opening:5000,received_cash:500,salary_paid:2000,cash_in:0,cash_out:300,balance:3200},rows:[{label:'Пациент',revenue:{total:1000},charge_total:2000,debt_total:900,loan_debt_total:700,pending_total:200}],shifts:[]};
 const html=c.renderFinanceSummaryV5(data,'reportsV5'),csv=c.buildFinanceCsvV5(data);
 for(const phrase of ['Получено за период','Долг','Наличные за период','Погашения долгов','Стоимость процедур и продаж']) {assert.ok(html.includes(phrase),phrase);assert.ok(csv.includes(phrase),phrase);}
 for(const amount of ['2000','700','1000','3200']) {assert.ok(html.includes(amount),amount);assert.ok(csv.includes(amount),amount);}
 assert.ok(html.includes('Это не долг'));assert.ok(csv.includes('Ожидает оплаты после процедуры (не долг)'));
 assert.ok(!html.includes('Выручка после зарплаты'));assert.ok(!csv.includes('Денежный остаток после выплаты зарплаты'));
});

test('legacy repayment markers stay outside shift print events and ordinary collection subtotals',()=>{
 const {c}=boot(),data=report();
 data.receipts=[{id:'ordinary',receipt_kind:'pending_payment',patient:'Оплата после процедуры',paid_total:0.3,payments:{cash:0.3},at:'2026-10-11T09:30:00Z'},
  ...[{receipt_kind:'debt_repayment'},{payment_kind:'debt_repayment'},{is_debt_repayment:true},{payment_scope:'debt'}].map((marker,i)=>({id:'repayment-'+i,patient:'Отдельное погашение '+i,paid_total:9999,...marker}))];
 const amounts=c.financeShiftSummaryAmountsV16(data),html=c.buildShiftPrintV5(data);
 assert.equal(amounts.receipts,0.3);assert.equal(c.financeShiftReceiptsV29(data).length,1);
 assert.ok(html.includes('Оплата после процедуры'));
 assert.ok(!html.includes('Отдельное погашение'));assert.ok(!html.includes('9999'));
});

test('zero confirmed drawer balance is a real amount while missing opening remains unknown',()=>{
 const {c}=boot(),data=report();data.cash_drawer={opening_confirmed:true,opening:0,received_cash:700,salary_paid:700,cash_in:0,cash_out:0,balance:0};
 assert.equal(c.financeRemainingTextV5(data),'0 ₽');
 assert.equal(c.financeShiftSummaryAmountsV16(data).afterSalary,0);
 assert.ok(c.buildFinanceCsvV5(data).includes('"Остаток наличных в кассе";"0"'));
 data.cash_drawer={opening_confirmed:false,balance:null};
 assert.equal(c.financeRemainingTextV5(data),'Не рассчитан: укажите остаток на начало смены');
 assert.equal(c.financeShiftSummaryAmountsV16(data).afterSalary,null);
});
