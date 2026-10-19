const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const clone=value=>JSON.parse(JSON.stringify(value));
const plain=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function boot(){
 const elements=new Map();
 function el(id){if(!elements.has(id)){const classes=new Set();elements.set(id,{id,value:'',checked:false,disabled:false,innerHTML:'',textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on??!classes.has(x))classes.add(x);else classes.delete(x)}},setAttribute(){},querySelectorAll:()=>[],querySelector:()=>el('button')})}return elements.get(id)}
 const c={Map,Set,Date,JSON,Math,Number,String,Promise,Error,crypto:require('node:crypto').webcrypto,
  document:{getElementById:()=>null,body:{classList:{remove(){}}},querySelectorAll:()=>[]},$:el,window:{addEventListener(){}},currentStaff:{id:'admin-test',role:'admin'},shift:{id:'shift-a'},
  num:v=>Number(v||0),qty:v=>String(v||0),rub:v=>Number(v||0)+' ₽',esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  isManager:()=>true,shiftLabel:()=> '08:30–16:00',message(){},show(){},localDateValue:()=> '2026-10-18',expiryDays:()=>null,
  meds:[],services:[],patients:[],nurses:[],inventory:[],rows:()=>[],prepareTreatment4:async()=>true,calcProcedure(){},calcSale(){},originalSaveTreatment4:async()=>{},enterApp:async()=>{},signOut:async()=>{},refreshDashboard:async()=>{},db:{rpc(){throw Error('Pure finance checks must not access data')}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../crm-finance-v5.js','utf8'),c);return {c,el};
}
function form(c,el,total=1600,prefix='proc'){el(prefix+'Paid').value=String(total);c.resetPaymentV5(prefix)}
function event(overrides={}){return {id:'visit-a',kind:'procedure',at:'2026-10-18T06:00:00Z',patient:'Пациент проверки',nurse:'Тестовая Медсестра',list_total:1600,charge_total:1600,paid_total:1600,initial_paid_total:1600,received_total:1600,debt_total:0,payments:{cash:0,terminal:0,owner_card:700,other_card:900},services:[{name:'Капельница',quantity:1,line_total:600}],items:[{name:'Препарат проверки',quantity:1,unit:'амп.',dose:'250 мг',line_total:1000}],...overrides}}
function report(overrides={}){return {from:'2026-10-18',to:'2026-10-18',shift:{id:'shift-a',date:'2026-10-18',started_at:'2026-10-18T05:30:00Z',status:'open'},staff:[{id:'nurse-test',full_name:'Тестовая Медсестра',amount:0}],procedures:[event()],sales:[],receipts:[],patients_count:1,procedures_count:1,sales_count:0,revenue:{cash:0,terminal:0,owner_card:700,other_card:900,total:1600},charge_total:1600,debt_total:0,loan_debt_total:0,pending_total:0,payroll_total:0,payroll_complete:true,cash_drawer:{opening_confirmed:true,opening:100,received_cash:0,salary_paid:0,balance:100},rows:[],shifts:[],...overrides}}

test('other-card requires an explicit choice and submits a distinct noncash allocation',()=>{
 const {c,el}=boot();form(c,el);el('procPayConfirmed').checked=true;assert.throws(()=>c.readPaymentsV5('proc'),/Выберите способ оплаты/);
 c.selectPaymentMethodV5('proc','other_card');assert.equal(el('procPayOtherCard').value,'1600.00');assert.equal(el('procPayCash').value,'0.00');assert.equal(el('procPayTender').value,'0.00');assert.equal(el('procPayTenderBox').classList.contains('hidden'),true);
 assert.equal(el('procPayConfirmed').checked,false);el('procPayConfirmed').checked=true;
 assert.deepEqual(clone(c.readPaymentsV5('proc')),{cash:0,terminal:0,owner_card:0,other_card:1600,cash_received:0});assert.match(el('procPaySummary').textContent,/Другая карта: 1600 ₽/);
});

test('changing from cash to other-card removes cash and keeps its tender out of the receipt',()=>{
 const {c,el}=boot();form(c,el);c.selectPaymentMethodV5('proc','cash');el('procPayTender').value='2000';c.paymentEditedV5('proc',true);
 c.selectPaymentMethodV5('proc','other_card');el('procPayConfirmed').checked=true;assert.deepEqual(clone(c.readPaymentsV5('proc')),{cash:0,terminal:0,owner_card:0,other_card:1600,cash_received:0});
 c.selectPaymentMethodV5('proc','owner_card');el('procPayConfirmed').checked=true;assert.deepEqual(clone(c.readPaymentsV5('proc')),{cash:0,terminal:0,owner_card:1600,cash_received:0});assert.equal(el('procPayOtherCard').value,'0.00');
});

test('all four mixed channels and cash change use exact cent sums',()=>{
 const {c,el}=boot();form(c,el,1000);c.selectPaymentMethodV5('proc','mixed');
 for(const [suffix,value]of Object.entries({Cash:'100',Terminal:'200',OwnerCard:'300',OtherCard:'400'}))el('procPay'+suffix).value=value;
 c.paymentEditedV5('proc');el('procPayTender').value='150';c.paymentEditedV5('proc',true);el('procPayConfirmed').checked=true;
 assert.deepEqual(clone(c.readPaymentsV5('proc')),{cash:100,terminal:200,owner_card:300,other_card:400,cash_received:150});assert.match(el('procPaySummary').textContent,/Оплата сейчас: 1000 ₽.*Другая карта: 400 ₽.*Сдача: 50 ₽/);
 el('procPayOtherCard').value='399.99';assert.throws(()=>c.readPaymentsV5('proc'),/Распределите ровно/);
 el('procPayOtherCard').value='400.001';assert.throws(()=>c.readPaymentsV5('proc'),/копеек/);
});

test('a single selected other-card method cannot conceal cash or an owner-card allocation',()=>{
 const {c,el}=boot();form(c,el);c.selectPaymentMethodV5('proc','other_card');el('procPayCash').value='1600';el('procPayOtherCard').value='0';el('procPayTender').value='1600';el('procPayConfirmed').checked=true;
 assert.throws(()=>c.readPaymentsV5('proc'),/не соответствуют выбранному способу/);
 c.selectPaymentMethodV5('proc','owner_card');el('procPayOwnerCard').value='0';el('procPayOtherCard').value='1600';el('procPayConfirmed').checked=true;assert.throws(()=>c.readPaymentsV5('proc'),/не соответствуют выбранному способу/);
});

test('lifetime methods keep other-card separate from the owner card and cash',()=>{
 const {c}=boot();assert.deepEqual(clone(c.financeEventMethodsV34(event())),{cash:0,terminal:0,owner_card:700,other_card:900,unclassified:0,debt_repayments_total:0});
 const html=c.financeEventPaymentHtmlV5(event());assert.match(plain(html),/Перевод на карту начальника: 700 ₽/);assert.match(plain(html),/Другая карта: 900 ₽/);assert.ok(!html.includes('data-payment-method="cash"'));
});

test('an inconsistent four-channel legacy split is unknown and never presumed cash',()=>{
 const {c}=boot();assert.deepEqual(clone(c.financeEventMethodsV34(event({payments:{cash:100,terminal:200,owner_card:300,other_card:2000}}))),{cash:0,terminal:0,owner_card:0,unclassified:1600,debt_repayments_total:0});
 const legacy=event({payments:{cash:0,terminal:0,owner_card:700}});assert.equal(c.financeEventMethodsV34(legacy).unclassified,900);assert.equal(c.financeEventMethodsV34(legacy).other_card,undefined);
});

test('shift-scoped other-card receipts print once without bringing later-shift payments or debt into cash',()=>{
 const {c}=boot();const saved=event({initial_paid_total:300,paid_total:300,received_total:1600,lifetime_received_total:1800,debt_repayments_total:200,payments:{cash:0,terminal:0,owner_card:300,other_card:1300},payment_scope_v45:'shift',shift_received_total_v45:800,shift_payments_v45:{cash:0,terminal:0,owner_card:300,other_card:500,unclassified:0,total:800},received_other_shifts_v45:800,shift_receipts_v39:[{id:'receipt-a',kind:'procedure',record_id:'visit-a',at:'2026-10-18T07:00:00Z',paid_total:500,payments:{cash:0,terminal:0,owner_card:0,other_card:500},is_debt_repayment:false}]});
 const methods=clone(c.financeEventMethodsV34(saved));assert.equal(methods.other_card,500);assert.equal(methods.owner_card,300);assert.equal(methods.cash,0);assert.equal(methods.debt_repayments_total,200);
 const html=c.financeVisitPaymentHtmlV41(saved);assert.equal(html.split('data-payment-method="other_card"').length-1,1);assert.match(plain(html),/Другая карта: 500 ₽/);assert.match(plain(html),/Оплата в других сменах: 800 ₽/);assert.match(plain(html),/Погашено долга отдельно: 200 ₽/);assert.ok(!html.includes('data-payment-method="cash"'));
});

test('shift and period summaries expose other-card separately while the actual cash balance stays unchanged',()=>{
 const {c}=boot(),data=report();const before=clone(data),amounts=c.financeShiftSummaryAmountsV16(data);assert.equal(amounts.total,1600);assert.equal(amounts.otherCard,900);assert.equal(amounts.ownerCard,700);assert.equal(amounts.cash,0);assert.equal(amounts.afterSalary,100);
 for(const html of [c.financeSimpleSummaryHtmlV29(data,'смену'),c.financeRevenueHtmlV5(data.revenue),c.renderFinanceSummaryV5(data,'reportsV5')]){assert.match(plain(html),/Другая карта\s*900 ₽/);assert.match(plain(html),/Переводы на карту начальника\s*700 ₽/)}
 assert.deepEqual(data,before);
});

test('the shift print and PDF source preserve other-card, medical details and cash totals',()=>{
 const {c}=boot(),data=report();const html=c.buildShiftPrintV5(data);assert.match(plain(html),/Другая карта: 900 ₽/);assert.match(html,/data-summary-key="other-card"/);assert.match(plain(html),/Препарат проверки × 1 амп\. · Доза: 250 мг · 1000 ₽/);assert.match(plain(html),/Остаток наличных в кассе\s*100 ₽/);assert.equal(c.financeShiftSummaryAmountsV16(data).cash,0);
});

test('CSV includes distinct owner-card and other-card columns for both totals and grouped rows',()=>{
 const {c}=boot(),data=report({rows:[{label:'Группа проверки',patients_count:1,procedures_count:1,sales_count:0,revenue:{cash:0,terminal:0,owner_card:700,other_card:900,total:1600}}]});
 const csv=c.buildFinanceCsvV5(data);assert.match(csv,/"Переводы на карту начальника";"700"/);assert.match(csv,/"Другая карта";"900"/);
 const rows=csv.split('\r\n').map(line=>line.split(';').map(cell=>cell.replace(/^"|"$/g,''))),head=rows.find(row=>row[0]==='Группа'),group=rows.find(row=>row[0]==='Группа проверки');
 assert.equal(group[head.indexOf('Переводы на карту начальника')],'700');assert.equal(group[head.indexOf('Другая карта')],'900');assert.equal(group[head.indexOf('Наличные')],'0');assert.equal(group[head.indexOf('Получено')],'1600');
 assert.match(plain(c.renderFinanceSummaryV5(data,'reportsV5')),/перевод на карту начальника 700 ₽ · другая карта 900 ₽/);
});

test('a true-debt other-card receipt cannot enter the shift receipt projection',()=>{
 const {c}=boot();const receipt={id:'debt-a',kind:'procedure',paid_total:900,payments:{other_card:900},is_debt_repayment:true};
 const data=report({procedures:[],procedures_count:0,patients_count:0,receipts:[receipt],revenue:{cash:0,terminal:0,owner_card:0,other_card:0,total:0}});
 assert.equal(c.financeShiftReceiptsV29(data).length,0);const amount=c.financeShiftSummaryAmountsV16(data);assert.equal(amount.total,0);assert.equal(amount.receipts,0);assert.equal(amount.cash,0);assert.equal(amount.otherCard,0);assert.equal(c.financeShiftDisplayV39(data).otherReceipts.length,0);
});
