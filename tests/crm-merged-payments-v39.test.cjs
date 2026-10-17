const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

function boot() {
 const elements = new Map(),listeners = new Map(),calls = [];
 function element(id) {
  if (!elements.has(id)) {
   const classes = new Set();
   elements.set(id,{id,innerHTML:'',textContent:'',disabled:false,
    classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value),toggle(value,on){if(on??!classes.has(value))classes.add(value);else classes.delete(value)}},
    querySelector:()=>element('reportButton'),setAttribute(){},remove(){elements.delete(this.id)}});
  }
  return elements.get(id);
 }
 const document = {body:element('body'),getElementById:id=>elements.get(id),createElement:()=>({innerHTML:'',remove(){elements.delete(this.id)}})};
 document.body.appendChild=node=>elements.set(node.id,node);
 const c = {Map,Set,Date,JSON,Math,Number,String,Promise,Error,crypto:require('node:crypto').webcrypto,document,$:element,
  currentStaff:{id:'nurse-1',role:'nurse'},shift:{id:'shift-1'},meds:[],services:[],patients:[],nurses:[],inventory:[],rows:()=>[],
  num:value=>Number(value||0),qty:value=>String(value||0),rub:value=>Number(value||0)+' ₽',
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
  isManager:()=>c.currentStaff?.role==='owner',shiftLabel:()=> '08:30–16:00',message(){},show:id=>element(id).classList.add('active'),
  window:{print(){c.printCalls++},addEventListener:(name,handler)=>listeners.set(name,handler)},printCalls:0,
  prepareTreatment4:async()=>{},calcProcedure(){},calcSale(){},originalSaveTreatment4:async()=>{},enterApp:async()=>{},signOut:async()=>{},refreshDashboard:async()=>{},
  db:{rpc:async(name,args)=>{calls.push({name,args});throw Error('Unexpected RPC')}}};
 let navigation = 0;
 c.beginQuickNavigation4=()=>++navigation;c.quickNavigationCurrent4=(token,actor)=>token===navigation&&actor===c.currentStaff?.id;
 vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../crm-finance-v5.js','utf8'),c);
 return {c,element,elements,listeners,calls};
}

const clone = value => JSON.parse(JSON.stringify(value));
function deepFreeze(value) {
 if (value && typeof value === 'object') {Object.values(value).forEach(deepFreeze);Object.freeze(value)}
 return value;
}
function procedure(overrides = {}) {
 // The shift RPC keeps the initial collection separate from lifetime ordinary
 // receipts. Attaching the receipt must never add its amount to these totals.
 return {id:'procedure-1',kind:'procedure',patient_id:'patient-1',patient:'Анна',nurse:'Наталья',at:'2026-10-11T06:00:00Z',
  services:[{name:'Капельница',quantity:1,line_total:600}],items:[],own_medications:[],
  list_total:800,charge_total:600,initial_paid_total:0,paid_total:0,received_total:600,lifetime_received_total:600,
  debt_total:0,payment_pending:false,payments:{cash:0,terminal:600,owner_card:0,total:600},payments_complete:true,...overrides};
}
function receipt(overrides = {}) {
 return {id:'receipt-1',kind:'procedure',record_id:'procedure-1',receipt_kind:'after_procedure_payment',is_debt_repayment:false,
  at:'2026-10-11T06:45:00Z',patient_id:'patient-1',patient:'Анна',nurse:'Лилия',paid_total:600,
  payments:{cash:0,terminal:600,owner_card:0},...overrides};
}
function report(overrides = {}) {
 return {shift:{id:'shift-1',date:'2026-10-11',started_at:'2026-10-11T05:30:00Z',planned_end_at:'2026-10-11T13:00:00Z',status:'closed'},
  staff:[{id:'nurse-1',full_name:'Наталья',amount:100}],patients_count:1,procedures_count:1,sales_count:0,
  procedures:[procedure()],sales:[],receipts:[receipt()],revenue:{cash:0,terminal:600,owner_card:0,total:600},
  charge_total:600,debt_total:0,pending_total:0,loan_debt_total:0,payroll_total:100,payroll_complete:true,
  cash_drawer:{opening_confirmed:true,balance:400,salary_paid:100},used:[],stock:[],untracked:[],warnings:[],...overrides};
}
const numbered = html => html.split('<li class="shift-print-event-v5">').slice(1).map(section=>section.split('</ol>')[0]);
const ids = receipts => Array.from(receipts,item=>item.id);

test('pending zero-paid procedure and its later same-shift collection remain one numbered visit',()=>{
 const {c,element}=boot(),pending=report({procedures:[procedure({received_total:0,lifetime_received_total:0,debt_total:600,payment_pending:true,payments:{cash:0,terminal:0,owner_card:0}})],
  receipts:[],revenue:{cash:0,terminal:0,owner_card:0,total:0},debt_total:600,pending_total:600});
 let printed=c.buildShiftPrintV5(pending);
 assert.equal(numbered(printed).length,1);
 assert.match(printed,/Ожидает оплаты: <b>600 ₽/);
 assert.match(printed,/Это не долг/);
 assert.equal(c.financeShiftSummaryAmountsV16(pending).loan,0);
 assert.equal(c.financeShiftSummaryAmountsV16(pending).pending,600);
 assert.match(printed,/data-summary-key="loan"><span>Долг<\/span><b>0 ₽/);

 const paid=report(),before=clone(paid),amounts=clone(c.financeShiftSummaryAmountsV16(paid));
 c.renderShiftReportV5(paid,true);printed=c.buildShiftPrintV5(paid);
 assert.equal(numbered(printed).length,1,'A receipt is not another procedure or numbered visit');
 assert.equal((printed.match(/<h2>Анна<\/h2>/g)||[]).length,1);
 assert.match(numbered(printed)[0],/Оплачено: <span data-payment-method="terminal">Терминал: <b>600 ₽/);
 assert.ok(!numbered(printed)[0].includes('Оплачено всего:'));
 assert.match(numbered(printed)[0],/data-receipt-id="receipt-1"/);
 assert.match(numbered(printed)[0],/Время оплаты: <time>09:45<\/time>/);
 assert.ok(!numbered(printed)[0].includes('Лилия')&&!numbered(printed)[0].includes('Оплата после процедуры'));
 assert.match(numbered(printed)[0],/Терминал: <b>600 ₽/);
 assert.ok(!printed.includes('1200 ₽'),'The cumulative collection must not be added twice');
 assert.ok(!printed.includes('shift-print-other-payments-v39'));
 assert.match(element('reportBody').innerHTML,/data-event-id="procedure-1"[\s\S]*data-receipt-id="receipt-1"/);
 assert.deepEqual(clone(c.financeShiftSummaryAmountsV16(paid)),amounts);
 assert.deepEqual({total:amounts.total,procedures:amounts.procedures,receipts:amounts.receipts,loan:amounts.loan,pending:amounts.pending},
  {total:600,procedures:0,receipts:600,loan:0,pending:0});
 assert.deepEqual(paid,before);
});

test('several collections attach by exact kind and record id, preserving repeat procedures and colliding sale ids',()=>{
 const {c}=boot(),data=report({patients_count:1,procedures_count:2,sales_count:1,
  procedures:[procedure({id:'shared-id'}),procedure({id:'second-procedure',at:'2026-10-11T07:00:00Z',list_total:50,charge_total:50,received_total:50,lifetime_received_total:50,payments:{owner_card:50}})],
  sales:[procedure({id:'shared-id',kind:'sale',at:'2026-10-11T06:30:00Z',services:[],items:[{name:'Проданный препарат',quantity:1,line_total:40}],list_total:40,charge_total:40,received_total:40,lifetime_received_total:40,payments:{cash:40}})],
  receipts:[receipt({id:'first-part',record_id:'shared-id',paid_total:200,payments:{cash:200}}),receipt({id:'second-part',record_id:'shared-id',paid_total:400,payments:{terminal:400}}),
   receipt({id:'repeat-visit',record_id:'second-procedure',paid_total:50,payments:{owner_card:50}}),receipt({id:'sale-payment',kind:'sale',record_id:'shared-id',paid_total:40,payments:{cash:40}})],
  charge_total:690,revenue:{cash:240,terminal:400,owner_card:50,total:690}});
 const before=clone(data),display=c.financeShiftDisplayV39(data);
 assert.deepEqual(ids(display.procedures[0].shift_receipts_v39),['first-part','second-part']);
 assert.deepEqual(ids(display.procedures[1].shift_receipts_v39),['repeat-visit']);
 assert.deepEqual(ids(display.sales[0].shift_receipts_v39),['sale-payment']);
 assert.equal(display.otherReceipts.length,0);
 assert.equal(display.procedures[0].received_total,600);
 assert.equal(display.procedures[0].payments.terminal,600);
 const printed=c.buildShiftPrintV5(data),records=numbered(printed);
 assert.equal(records.length,3,'One patient can have distinct procedures and a sale');
 assert.match(records[0],/first-part[\s\S]*second-part/);
 assert.ok(!records[0].includes('repeat-visit')&&!records[0].includes('sale-payment'));
 assert.match(records[1],/Продажа препарата/);assert.match(records[1],/sale-payment/);
 assert.match(records[2],/repeat-visit/);
 assert.deepEqual(data,before);
});

test('other-shift and unresolved receipts stay unnumbered, with no patient-name or receipt-id guessing',()=>{
 const {c}=boot(),data=report({receipts:[receipt(),
  receipt({id:'from-earlier-shift',record_id:'previous-procedure',patient:'Борис из другой смены',paid_total:125,payments:{cash:125}}),
  receipt({id:'missing-record',record_id:'missing-procedure',patient:'Анна',paid_total:10,payments:{owner_card:10}}),
  receipt({id:'procedure-1',record_id:null,patient:'Анна',paid_total:15,payments:{cash:15}}),
  receipt({id:'missing-kind',kind:undefined,record_id:'procedure-1',patient:'Анна',paid_total:20,payments:{terminal:20}}),
  receipt({id:'unknown-kind',kind:'treatment',record_id:'procedure-1',patient:undefined,paid_total:25,payments:{cash:25}})],
  revenue:{cash:165,terminal:620,owner_card:10,total:795}});
 const display=c.financeShiftDisplayV39(data);
 assert.deepEqual(ids(display.procedures[0].shift_receipts_v39),['receipt-1']);
 assert.deepEqual(ids(display.otherReceipts),['from-earlier-shift','missing-record','procedure-1','missing-kind','unknown-kind']);
 const printed=c.buildShiftPrintV5(data),[events,afterEvents]=printed.split('</ol>');
 assert.equal(numbered(printed).length,1);
 assert.ok(!events.includes('from-earlier-shift')&&!events.includes('missing-record'));
 assert.match(afterEvents,/<section class="shift-print-other-payments-v39">[\s\S]*Борис из другой смены/);
 assert.match(afterEvents,/в число посещений не входят/);
 assert.match(afterEvents,/data-receipt-id="unknown-kind"><strong>Без пациента<\/strong>/);
 assert.ok(!afterEvents.includes('<li'),'Other receipt patients must not create numbered visits');
 assert.match(printed,/пациентов 1 · процедур 1 · продаж 0/);
 assert.equal(c.financeShiftSummaryAmountsV16(data).receipts,795,'Every ordinary collection still belongs to its collection shift');
 assert.equal(c.financeShiftSummaryAmountsV16(data).total,795);
});

test('true-debt repayments never merge into visit receipts or ordinary shift income',()=>{
 const {c}=boot(),debtFlags=[{receipt_kind:'debt_repayment'},{payment_kind:'debt_repayment'},{is_debt_repayment:true},{payment_scope:'debt'}];
 const data=report({receipts:[receipt(),...debtFlags.map((flag,index)=>receipt({id:'true-debt-'+index,paid_total:9000,...flag}))]});
 const display=c.financeShiftDisplayV39(data),printed=c.buildShiftPrintV5(data),summary=c.financeShiftSummaryAmountsV16(data);
 assert.deepEqual(ids(display.procedures[0].shift_receipts_v39),['receipt-1']);
 assert.equal(display.otherReceipts.length,0);
 assert.ok(!printed.includes('true-debt-'));assert.ok(!printed.includes('9000 ₽'));
 assert.equal(summary.receipts,600);assert.equal(summary.total,600);
});

test('merging keeps initial collections, later collections, salary, cash and actual debt totals unchanged',()=>{
 const {c,element}=boot(),data=report({patients_count:4,procedures_count:3,sales_count:1,
  procedures:[procedure({list_total:800,charge_total:700,initial_paid_total:100,paid_total:100,received_total:700,lifetime_received_total:700,payments:{cash:100,terminal:600}}),
   procedure({id:'pending-procedure',patient:'Ожидающая пациентка',charge_total:900,list_total:900,received_total:0,lifetime_received_total:0,debt_total:900,payment_pending:true,payments:{cash:0,terminal:0,owner_card:0}}),
   procedure({id:'real-debt',patient:'Пациент с долгом',charge_total:150,list_total:150,initial_paid_total:75,paid_total:75,received_total:75,lifetime_received_total:75,debt_total:75,payments:{terminal:75}})],
  sales:[procedure({id:'sale-1',kind:'sale',patient:'Покупатель',services:[],charge_total:90,list_total:90,initial_paid_total:90,paid_total:90,received_total:90,lifetime_received_total:90,payments:{owner_card:90}})],
  receipts:[receipt(),receipt({id:'earlier-shift-payment',record_id:'earlier-procedure',paid_total:125,payments:{cash:125}})],
  charge_total:1840,debt_total:975,pending_total:undefined,loan_debt_total:undefined,revenue:{cash:225,terminal:675,owner_card:90,total:990}});
 const before=clone(data),amounts=clone(c.financeShiftSummaryAmountsV16(data));
 assert.deepEqual({total:amounts.total,procedures:amounts.procedures,sales:amounts.sales,receipts:amounts.receipts,cash:amounts.cash,terminal:amounts.terminal,ownerCard:amounts.ownerCard,
  charge:amounts.charge,loan:amounts.loan,pending:amounts.pending,payroll:amounts.payroll,afterSalary:amounts.afterSalary},
  {total:990,procedures:175,sales:90,receipts:725,cash:225,terminal:675,ownerCard:90,charge:1840,loan:75,pending:900,payroll:100,afterSalary:400});
 c.renderShiftReportV5(data,true);
 for(const html of [element('reportBody').innerHTML,c.buildShiftPrintV5(data)]) {
  assert.match(html,/data-summary-key="loan"><span>Долг<\/span><b>75 ₽/);
  assert.match(html,/data-summary-key="pending">Ожидают оплаты после процедуры: <b>900 ₽<\/b>\. Это не долг/);
  assert.match(html,/data-summary-key="revenue"><span>Получено за смену<\/span><b>990 ₽/);
 }
 assert.deepEqual(clone(c.financeShiftSummaryAmountsV16(data)),amounts);
 assert.deepEqual(clone(data),before);
});

test('merged view preserves and escapes captured dose, discounts and exact mixed receipt methods',()=>{
 const {c,element}=boot(),data=report({procedures:[procedure({patient:'Анна <img src=x>',nurse:'Наталья <svg onload=x>',
  items:[{name:'Препарат <b>снимок</b>',dosage:'400 мг / 5 мл',quantity:2,unit:'амп.',dose:'200 мг <img src=x>',line_total:600}],
  discount_reason:'Скидка <script>x</script>',discount_comment:'По решению "владельца"',notes:'Комментарий <iframe>',
  received_total:600,lifetime_received_total:650,debt_repayments_total:50,payments:{cash:100,terminal:200,owner_card:300}})],
  receipts:[receipt({id:'receipt-"<img>',nurse:'Лилия <svg>',comment:'После процедуры <script>x</script>',payments:{cash:100,terminal:200,owner_card:300}})]});
 const before=clone(data),expected=['Препарат &lt;b&gt;снимок&lt;/b&gt; · 400 мг / 5 мл × 2 амп. · Доза: 200 мг &lt;img src=x&gt; · 600 ₽',
  'Скидка &lt;script&gt;x&lt;/script&gt; · По решению &quot;владельца&quot;','data-receipt-id="receipt-&quot;&lt;img&gt;"',
  'Время оплаты: <time>09:45</time>','После процедуры &lt;script&gt;x&lt;/script&gt;','Наличные: <b>100 ₽','Терминал: <b>200 ₽','Перевод на карту начальника: <b>300 ₽'];
 c.renderShiftReportV5(data,true);
 for(const html of [element('reportBody').innerHTML,c.buildShiftPrintV5(data)]) {
  for(const text of expected)assert.ok(html.includes(text),text);
  for(const tag of ['<img','<script','<svg','<iframe'])assert.ok(!html.includes(tag),tag);
  assert.match(html,/Оплачено: <span data-payment-method="cash">Наличные: <b>100 ₽<\/b><\/span> · <span data-payment-method="terminal">Терминал: <b>200 ₽<\/b><\/span> · <span data-payment-method="owner_card">Перевод на карту начальника: <b>300 ₽/);
  assert.ok(!html.includes('Оплачено всего:')&&!html.includes('Сотрудник:'));
  assert.ok(!html.includes('Лилия &lt;svg&gt;'),'Attached receipts do not repeat their employee below the visit header');
  assert.match(html,/Погашено долга отдельно: <b>50 ₽/);
 }
 const merged=c.financeShiftDisplayV39(data).procedures[0];
 for(const key of ['received_total','lifetime_received_total','debt_repayments_total','paid_total','initial_paid_total','payments','items','services'])assert.deepEqual(merged[key],data.procedures[0][key],key);
 assert.deepEqual(data,before);
});

test('report read, repeat render and print leave frozen financial snapshots and the server untouched',async()=>{
 const {c,elements,listeners,calls}=boot(),data=deepFreeze(report()),before=clone(data),expectedSummary=clone(c.financeShiftSummaryAmountsV16(data));
 c.db.rpc=async(name,args)=>{calls.push({name,args:clone(args)});assert.equal(name,'crm_finance_v5');assert.equal(args.p_action,'shift_report');return {data}};
 await c.openReportByIdV5('shift-1');
 c.renderShiftReportV5(data,true);c.financeShiftDisplayV39(data);c.buildShiftPrintV5(data);
 c.printShiftReportV5();assert.equal(c.printCalls,1);
 assert.equal(numbered(elements.get('shiftPrintV5').innerHTML).length,1);
 listeners.get('beforeprint')();listeners.get('afterprint')();
 assert.ok(!elements.has('shiftPrintV5'));
 assert.deepEqual(calls,[{name:'crm_finance_v5',args:{p_action:'shift_report',p_payload:{shift_id:'shift-1'}}}]);
 assert.deepEqual(data,before);
 assert.deepEqual(clone(c.financeShiftSummaryAmountsV16(data)),expectedSummary);
 assert.ok(!Object.hasOwn(data.procedures[0],'shift_receipts_v39'));
});
