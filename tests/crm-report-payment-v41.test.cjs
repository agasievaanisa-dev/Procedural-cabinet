const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

function boot() {
 const elements = new Map(),calls = [];
 function element(id) {
  if (!elements.has(id)) {
   const classes = new Set();
   elements.set(id,{id,innerHTML:'',textContent:'',disabled:false,classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value),toggle(value,on){if(on??!classes.has(value))classes.add(value);else classes.delete(value)}},querySelector:()=>element('reportButton'),setAttribute(){},remove(){elements.delete(this.id)}});
  }
  return elements.get(id);
 }
 const document = {body:element('body'),getElementById:id=>elements.get(id),createElement:()=>({innerHTML:'',remove(){elements.delete(this.id)}})};
 document.body.appendChild=node=>elements.set(node.id,node);
 const c = {Map,Set,Date,JSON,Math,Number,String,Promise,Error,crypto:require('node:crypto').webcrypto,document,$:element,
  currentStaff:{id:'nurse-1',role:'nurse'},shift:{id:'shift-1'},meds:[],services:[],patients:[],nurses:[],inventory:[],rows:()=>[],
  num:value=>Number(value||0),qty:value=>String(value||0),rub:value=>Number(value||0)+' ₽',
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
  isManager:()=>c.currentStaff?.role==='owner',shiftLabel:()=> '08:30–16:00',message(){},show:id=>element(id).classList.add('active'),window:{print(){},addEventListener(){}},
  prepareTreatment4:async()=>{},calcProcedure(){},calcSale(){},originalSaveTreatment4:async()=>{},enterApp:async()=>{},signOut:async()=>{},refreshDashboard:async()=>{},
  db:{rpc:async(name,args)=>{calls.push({name,args});throw Error('Unexpected RPC')}}};
 let navigation = 0;c.beginQuickNavigation4=()=>++navigation;c.quickNavigationCurrent4=(token,actor)=>token===navigation&&actor===c.currentStaff?.id;
 vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../crm-finance-v5.js','utf8'),c);
 return {c,element,calls};
}
const clone = value=>JSON.parse(JSON.stringify(value));
const text = html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const count = (value,needle)=>value.split(needle).length-1;
function freeze(value) {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
function procedure(overrides={}) {
 return {id:'procedure-1',kind:'procedure',patient_id:'patient-1',patient:'Анна',nurse:'Наталья',at:'2026-10-16T15:35:00Z',services:[{name:'Капельница',quantity:1,line_total:600}],items:[{name:'Физраствор',quantity:1,unit:'фл.',line_total:200}],own_medications:[],
  list_total:800,charge_total:800,initial_paid_total:0,paid_total:0,received_total:800,lifetime_received_total:800,debt_repayments_total:0,debt_total:0,payment_pending:false,payments:{cash:800,terminal:0,owner_card:0},shift_receipts_v39:[],...overrides};
}
function receipt(overrides={}) {
 return {id:'receipt-1',kind:'procedure',record_id:'procedure-1',receipt_kind:'after_procedure_payment',is_debt_repayment:false,at:'2026-10-16T16:12:00Z',nurse:'Наталья',paid_total:800,payments:{cash:800,terminal:0,owner_card:0},...overrides};
}
function report(overrides={}) {
 return {shift:{id:'shift-1',date:'2026-10-16',started_at:'2026-10-16T05:30:00Z',planned_end_at:'2026-10-16T13:00:00Z',status:'closed'},staff:[{id:'nurse-1',full_name:'Наталья',amount:2000}],patients_count:1,procedures_count:1,sales_count:0,
  procedures:[procedure()],sales:[],receipts:[receipt()],revenue:{cash:800,terminal:0,owner_card:0,total:800},charge_total:800,debt_total:0,pending_total:0,loan_debt_total:0,payroll_total:2000,payroll_complete:true,cash_drawer:{opening_confirmed:true,balance:800,salary_paid:0},used:[],stock:[],untracked:[],warnings:[],...overrides};
}

test('visible date-only values use day.month.year without a timezone conversion or impossible calendar day',()=>{
 const {c}=boot();
 for(const [raw,expected] of [['2026-10-16','16.10.2026'],['2028-02-29','29.02.2028'],['2030-01-01','01.01.2030'],['2026-12-31','31.12.2026']])assert.equal(c.financeDateV41(raw),expected,raw);
 for(const invalid of [undefined,null,'','2026-02-29','2026-02-30','2026-04-31','2026-00-01','2026-13-01','2026-10-00','2026-10-32','2026-10-16T23:00:00Z','<img src=x>'])assert.equal(c.financeDateV41(invalid),'Дата не указана',String(invalid));
 const html=c.buildShiftPrintV5(report());assert.match(html,/<b>Смена:<\/b> 16\.10\.2026/);assert.ok(!html.includes('2026-10-16'));
});

test('same-shift cash collection prints its amount once after the list price without a second aggregate payment',()=>{
 const {c}=boot(),html=c.financeVisitPaymentHtmlV41(procedure({shift_receipts_v39:[receipt()]})),plain=text(html);
 assert.match(plain,/Оплата по прайсу: 800 ₽/);assert.match(plain,/Оплачено:.*Наличные: 800 ₽/);
 assert.equal(count(plain,'800 ₽'),2,'Only the list price and the actual cash payment repeat this number');
 assert.equal(count(html,'data-payment-method="cash"'),1);assert.equal(count(html,'data-receipt-id="receipt-1"'),1);
 assert.match(plain,/16\.10\.2026, 19:12.*Наталья/);
 for(const old of ['Оплачено всего','К оплате:','Сотрудник:','Скидка: 0'])assert.ok(!plain.includes(old),old);
});

test('individual terminal payment keeps the discount and its explanation on the payment line',()=>{
 const {c}=boot(),reason='Согласовано с начальником';
 const html=c.financeVisitPaymentHtmlV41(procedure({list_total:800,charge_total:500,received_total:500,lifetime_received_total:500,payments:{cash:0,terminal:500,owner_card:0},discount_amount:300,discount_reason:reason,discount_comment:reason})),plain=text(html);
 assert.match(plain,/Оплата по прайсу: 800 ₽/);assert.match(plain,/Оплачено:.*Терминал: 500 ₽.*со скидкой 300 ₽/);
 assert.equal(count(plain,reason),1,'An identical reason/comment is not printed twice');
 assert.equal(count(html,'data-payment-method="terminal"'),1);
 for(const old of ['Оплачено всего','К оплате:','Скидка:'])assert.ok(!plain.includes(old),old);
});

test('initial mixed payment and later receipt subtract in cents instead of repeating the cumulative methods',()=>{
 const {c}=boot(),part=receipt({paid_total:600,payments:{cash:0,terminal:600,owner_card:0}});
 const html=c.financeVisitPaymentHtmlV41(procedure({list_total:800,charge_total:700,initial_paid_total:100,paid_total:100,received_total:700,lifetime_received_total:700,payments:{cash:100,terminal:600,owner_card:0},shift_receipts_v39:[part]})),plain=text(html);
 assert.equal(count(html,'data-payment-method="cash"'),1);assert.equal(count(html,'data-payment-method="terminal"'),1);
 assert.match(plain,/Наличные: 100 ₽/);assert.match(plain,/Терминал: 600 ₽/);assert.ok(!plain.includes('700 ₽'),'No extra cumulative paid amount');
 const decimal=c.financeVisitPaymentHtmlV41(procedure({list_total:0.3,charge_total:0.3,received_total:0.3,lifetime_received_total:0.3,payments:{cash:0.1,terminal:0.2},shift_receipts_v39:[receipt({paid_total:0.2,payments:{terminal:0.2}})]}));
 assert.ok(!decimal.includes('0.099999')&&!decimal.includes('0.199999')&&!decimal.includes('-0.'));
 assert.match(text(decimal),/Наличные: 0\.1 ₽/);assert.match(text(decimal),/Терминал: 0\.2 ₽/);
});

test('invalid receipt totals fail back to captured ordinary payment methods without negative or invented residuals',()=>{
 const {c}=boot(),html=c.financeVisitPaymentHtmlV41(procedure({received_total:500,lifetime_received_total:500,charge_total:500,list_total:500,payments:{terminal:500},shift_receipts_v39:[receipt({paid_total:800,payments:{cash:800}})]})),plain=text(html);
 assert.match(plain,/Терминал: 500 ₽/);assert.ok(!plain.includes('800 ₽'));assert.ok(!plain.includes('Наличные:'));assert.ok(!plain.includes('-300'));
 assert.equal(count(html,'data-payment-method="terminal"'),1);
 const unknown=c.financeVisitPaymentHtmlV41(procedure({received_total:700,lifetime_received_total:700,payments:{},shift_receipts_v39:[receipt({paid_total:600,payments:{terminal:600}})]}));
 assert.match(text(unknown),/Способ оплаты не указан: 100 ₽/);assert.match(text(unknown),/Терминал: 600 ₽/);
});

test('waiting payment stays distinct from true debt, and free care and a surcharge remain explicit',()=>{
 const {c}=boot(),unpaid={received_total:0,lifetime_received_total:0,payments:{},debt_total:800};
 const pending=text(c.financeVisitPaymentHtmlV41(procedure({...unpaid,payment_pending:true}))),debt=text(c.financeVisitPaymentHtmlV41(procedure({...unpaid,payment_pending:false})));
 assert.match(pending,/Ожидает оплаты: 800 ₽/);assert.match(pending,/Это не долг/);assert.ok(!debt.includes('Ожидает оплаты'));assert.match(debt,/Долг: 800 ₽/);
 const free=text(c.financeVisitPaymentHtmlV41(procedure({charge_total:0,received_total:0,lifetime_received_total:0,payments:{},discount_reason:'Бесплатная помощь'})));
 assert.match(free,/Бесплатно/i);assert.match(free,/800 ₽/);assert.match(free,/Бесплатная помощь/);
 const surcharge=text(c.financeVisitPaymentHtmlV41(procedure({list_total:800,charge_total:900,received_total:900,lifetime_received_total:900,payments:{owner_card:900},discount_reason:'Дополнительная работа'})));
 assert.match(surcharge,/Перевод на карту начальника: 900 ₽/);assert.match(surcharge,/надбавк[а-я]* 100 ₽/i);assert.match(surcharge,/Дополнительная работа/);
});

test('clinical details and escaped discount/receipt notes survive without repeated employee labels',()=>{
 const {c}=boot(),html=c.financeVisitPaymentHtmlV41(procedure({list_total:800,charge_total:500,received_total:500,lifetime_received_total:500,payments:{cash:500},discount_reason:'Скидка <script>alert(1)</script>',discount_comment:'Причина "индивидуальная"',shift_receipts_v39:[receipt({id:'receipt-"<img>',paid_total:500,payments:{cash:500},nurse:'Наталья <svg>',comment:'Оплата <iframe> сохранена'})]}));
 for(const escaped of ['&lt;script&gt;','&quot;индивидуальная&quot;','&lt;svg&gt;','&lt;iframe&gt;','data-receipt-id="receipt-&quot;&lt;img&gt;"'])assert.ok(html.includes(escaped),escaped);
 for(const tag of ['<script','<img','<svg','<iframe'])assert.ok(!html.includes(tag),tag);
 assert.ok(!html.includes('Сотрудник:'));assert.equal(count(text(html),'Оплата &lt;iframe&gt; сохранена'),1);
});

test('screen and print transformations preserve frozen snapshots, shift cash and numbering without data writes',()=>{
 const {c,element,calls}=boot(),data=freeze(report({procedures:[procedure({items:[{name:'Сохранённый препарат',quantity:2,unit:'амп.',dose:'250 мг',line_total:200}]})]})),before=clone(data),summary=clone(c.financeShiftSummaryAmountsV16(data));
 c.renderShiftReportV5(data,true);const printed=c.buildShiftPrintV5(data);
 for(const html of [element('reportBody').innerHTML,printed]){
  assert.match(html,/Оплата по прайсу:/);assert.match(html,/Сохранённый препарат × 2 амп\. · Доза: 250 мг · 200 ₽/);assert.match(html,/data-receipt-id="receipt-1"/);
  assert.ok(!html.includes('Сотрудник:'));assert.ok(!html.includes('Оплачено всего:'));
 }
 assert.equal(count(printed,'<li class="shift-print-event-v5">'),1);assert.deepEqual(clone(data),before);assert.deepEqual(clone(c.financeShiftSummaryAmountsV16(data)),summary);assert.deepEqual(calls,[]);
 assert.ok(!Object.hasOwn(data.procedures[0],'shift_receipts_v39')||data.procedures[0].shift_receipts_v39.length===0);
});
