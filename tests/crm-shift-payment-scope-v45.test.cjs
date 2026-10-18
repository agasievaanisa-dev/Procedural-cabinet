const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {test}=require('node:test');

function boot(){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{id,innerHTML:'',classList:{add(){},remove(){},contains(){return false},toggle(){}},querySelector(){return element('button')},setAttribute(){}});return elements.get(id)};
 const c={Map,Set,Date,JSON,Math,Number,String,Promise,Error,crypto:require('node:crypto').webcrypto,
  document:{getElementById:()=>null,body:{classList:{remove(){}}}},$:element,currentStaff:{id:'nurse-test',role:'nurse'},shift:{id:'shift-a'},
  num:v=>Number(v||0),qty:v=>String(v||0),rub:v=>Number(v||0)+' ₽',esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  isManager:()=>false,shiftLabel:()=> '08:30–16:00',message(){},show(){},window:{addEventListener(){}},
  meds:[],services:[],patients:[],nurses:[],inventory:[],rows:()=>[],prepareTreatment4:async()=>{},calcProcedure(){},calcSale(){},originalSaveTreatment4:async()=>{},enterApp:async()=>{},signOut:async()=>{},refreshDashboard:async()=>{},db:{rpc(){throw Error('Rendering must not access data')}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../crm-finance-v5.js','utf8'),c);return c;
}
const plain=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const clone=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
function event(overrides={}){return {id:'visit-a',kind:'procedure',patient:'Пациент проверки',nurse:'Медсестра А',at:'2026-10-17T06:00:00Z',list_total:1600,charge_total:1600,initial_paid_total:0,paid_total:0,received_total:1600,lifetime_received_total:1600,debt_repayments_total:0,debt_total:0,payment_pending:false,payments:{cash:1200,terminal:400,owner_card:0},payment_scope_v45:'shift',shift_received_total_v45:0,shift_payments_v45:{cash:0,terminal:0,owner_card:0,unclassified:0,total:0},received_other_shifts_v45:1600,items:[{name:'Сохранённый препарат',quantity:1,unit:'амп.',dose:'250 мг',line_total:1000}],services:[{name:'Капельница',quantity:1,line_total:600}],...overrides}}
function receipt(overrides={}){return {id:'collection-b',kind:'procedure',record_id:'visit-a',patient:'Пациент проверки',nurse:'Медсестра Б',at:'2026-10-17T14:00:00Z',paid_total:1600,payments:{cash:1200,terminal:400,owner_card:0},is_debt_repayment:false,receipt_kind:'after_procedure_payment',...overrides}}
function report(overrides={}){return {shift:{id:'shift-a',date:'2026-10-17',started_at:'2026-10-17T05:30:00Z',status:'closed'},staff:[{full_name:'Медсестра А',amount:0}],procedures:[event()],sales:[],receipts:[],patients_count:1,procedures_count:1,sales_count:0,revenue:{cash:0,terminal:0,owner_card:0,total:0,unclassified:0},charge_total:1600,debt_total:0,loan_debt_total:0,pending_total:0,payroll_total:0,payroll_complete:true,cash_drawer:{opening_confirmed:true,opening:0,received_cash:0,salary_paid:0,balance:0},...overrides}}

test('a later shift collection never appears as cash or terminal received by the original shift',()=>{
 const c=boot(),saved=event(),html=c.financeVisitPaymentHtmlV41(saved),journal=c.financeEventPaymentHtmlV5(saved);
 for(const text of [html,journal]){
  assert.ok(!text.includes('data-payment-method="cash"')&&!text.includes('data-payment-method="terminal"'));
  assert.match(plain(text),/Оплата в других сменах: 1600 ₽\s*\. В сумму и кассу этой смены не входит/);
 }
 assert.match(plain(html),/Оплачено: 0 ₽/);assert.match(plain(journal),/Оплачено в этой смене: 0 ₽/);
 assert.equal(c.financeEventAmountsV5(saved).received,0);
 assert.deepEqual(clone(c.financeEventMethodsV34(saved)),{cash:0,terminal:0,owner_card:0,unclassified:0,debt_repayments_total:0});
});

test('the receiving shift prints the other-visit collection once and preserves its cash split',()=>{
 const c=boot(),data=report({shift:{id:'shift-b',date:'2026-10-17'},staff:[{full_name:'Медсестра Б',amount:0}],procedures:[],procedures_count:0,patients_count:0,receipts:[receipt()],revenue:{cash:1200,terminal:400,owner_card:0,total:1600},cash_drawer:{opening_confirmed:true,balance:1200}});
 const displayed=c.financeShiftDisplayV39(data);assert.equal(displayed.otherReceipts.length,1);
 const collectionHtml=c.financeOtherReceiptsHtmlV39(displayed.otherReceipts);
 assert.equal(collectionHtml.split('data-receipt-id="collection-b"').length-1,1);
 assert.match(plain(collectionHtml),/Наличные: 1200 ₽/);assert.match(plain(collectionHtml),/Терминал: 400 ₽/);
 const totals=c.financeShiftSummaryAmountsV16(data);assert.equal(totals.cash,1200);assert.equal(totals.terminal,400);assert.equal(totals.total,1600);assert.equal(totals.receipts,1600);
});

test('initial mixed methods come from exact allocation fields rather than lifetime payment proportions',()=>{
 const c=boot(),saved=event({initial_paid_total:500,paid_total:500,payments:{cash:300,terminal:1100,owner_card:200},shift_received_total_v45:500,shift_payments_v45:{cash:300,terminal:0,owner_card:200,total:500},received_other_shifts_v45:1100});
 const methods=clone(c.financeEventMethodsV34(saved));assert.deepEqual(methods,{cash:300,terminal:0,owner_card:200,unclassified:0,debt_repayments_total:0});
 const html=c.financeVisitPaymentHtmlV41(saved);assert.match(plain(html),/Наличные: 300 ₽/);assert.match(plain(html),/Перевод на карту начальника: 200 ₽/);assert.ok(!html.includes('data-payment-method="terminal"'));
});

test('same-shift receipt subtraction retains initial money once and excludes later foreign-shift money',()=>{
 const c=boot(),saved=event({initial_paid_total:200,paid_total:200,payments:{cash:200,terminal:300,owner_card:1100},shift_received_total_v45:500,shift_payments_v45:{cash:200,terminal:300,owner_card:0,total:500},received_other_shifts_v45:1100,shift_receipts_v39:[receipt({id:'same-shift',paid_total:300,payments:{terminal:300},at:'2026-10-17T08:00:00Z'})]});
 const html=c.financeVisitPaymentHtmlV41(saved),text=plain(html);
 assert.match(text,/Наличные: 200 ₽/);assert.match(text,/Терминал: 300 ₽.*Время оплаты: 11:00/);assert.ok(!html.includes('data-payment-method="owner_card"'));
 assert.equal(html.split('data-payment-method="cash"').length-1,1);assert.equal(html.split('data-payment-method="terminal"').length-1,1);
 assert.equal(html.split('data-receipt-id="same-shift"').length-1,1);
});

test('an unclassified initial payment remains unknown even when another shift later received cash',()=>{
 const c=boot(),saved=event({initial_paid_total:500,paid_total:500,payments:{cash:1100,unclassified:500},shift_received_total_v45:500,shift_payments_v45:{cash:0,terminal:0,owner_card:0,unclassified:500,total:500},received_other_shifts_v45:1100});
 const html=c.financeVisitPaymentHtmlV41(saved);assert.match(plain(html),/Способ оплаты не указан: 500 ₽/);assert.ok(!html.includes('data-payment-method="cash"'));
});

test('true debt repayments remain separate without reducing the scoped ordinary payment twice',()=>{
 const c=boot(),saved=event({initial_paid_total:200,paid_total:200,received_total:1400,lifetime_received_total:1600,debt_repayments_total:200,payments:{cash:200,terminal:1200},shift_received_total_v45:200,shift_payments_v45:{cash:200,terminal:0,owner_card:0,total:200},received_other_shifts_v45:1200});
 assert.deepEqual(clone(c.financeEventMethodsV34(saved)),{cash:200,terminal:0,owner_card:0,unclassified:0,debt_repayments_total:200});
 const html=c.financeVisitPaymentHtmlV41(saved);assert.match(plain(html),/Наличные: 200 ₽/);assert.match(plain(html),/Погашено долга отдельно: 200 ₽/);assert.ok(!html.includes('data-payment-method="terminal"'));
});

test('patient history without shift fields retains lifetime amounts and methods',()=>{
 const c=boot(),saved=event();for(const key of ['payment_scope_v45','shift_received_total_v45','shift_payments_v45','received_other_shifts_v45'])delete saved[key];
 assert.equal(c.financeEventAmountsV5(saved).received,1600);assert.deepEqual(clone(c.financeEventMethodsV34(saved)),{cash:1200,terminal:400,owner_card:0,unclassified:0,debt_repayments_total:0});
 const html=c.financeEventPaymentHtmlV5(saved);assert.match(plain(html),/Оплачено всего: 1600 ₽/);assert.ok(!html.includes('Оплата в других сменах'));
});

test('malformed scoped channels cannot invent cash and unmarked legacy fields cannot change lifetime history',()=>{
 const c=boot(),saved=event({shift_received_total_v45:500,shift_payments_v45:{cash:600,terminal:20}});
 assert.deepEqual(clone(c.financeEventMethodsV34(saved)),{cash:0,terminal:0,owner_card:0,unclassified:500,debt_repayments_total:0});
 for(const marker of [undefined,'patient',''])assert.equal(c.financeEventAmountsV5({...saved,payment_scope_v45:marker}).received,1600);
 for(const bad of ['',null,'invalid',-100,Infinity])assert.equal(c.financeEventAmountsV5({...saved,shift_received_total_v45:bad}).received,1600);
});

test('shift rendering preserves frozen snapshots, totals, medical details and captured prices',()=>{
 const c=boot(),data=freeze(report()),before=clone(data),summary=clone(c.financeShiftSummaryAmountsV16(data));
 const html=c.buildShiftPrintV5(data),visit=html.split('<li class="shift-print-event-v5">')[1].split('</li>')[0];
 assert.ok(!visit.includes('data-payment-method="cash"')&&!visit.includes('data-payment-method="terminal"'));
 assert.match(html,/Сохранённый препарат × 1 амп\. · Доза: 250 мг · 1000 ₽/);
 assert.deepEqual(clone(data),before);assert.deepEqual(clone(c.financeShiftSummaryAmountsV16(data)),summary);assert.equal(summary.total,0);assert.equal(summary.cash,0);
});
