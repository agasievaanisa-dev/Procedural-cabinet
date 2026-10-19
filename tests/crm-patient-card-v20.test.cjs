const {test}=require('node:test');
const assert=require('node:assert/strict');
const {patientSnapshot,historySnapshot,buildPatientCardHtml,paymentSnapshot}=require('../crm-patient-card-v20.js');

const patient={id:'patient-1',full_name:'Анна <script>bad()</script>',birth_date:'1980-04-12',sex:'female',phone:'+7 <123>',complaints:'Жалобы <img src=x>',request:'Запрос\nВторая строка',prescriptions:'Назначение врача',notes:'Заметка о пациенте',auth_user_id:'hidden-auth',purchase_price:987654};
function procedure(overrides={}){
 return {id:'procedure-1',kind:'procedure',at:'2026-10-12T08:00:00Z',nurse:'Наталья <img>',procedure_type:'Капельница',
  services:[{name:'Капельница',quantity:1,work_price:500,consumables_price:100,line_total:600}],
  items:[{name:'Сохранённый препарат',quantity:2,unit:'амп.',unit_price:500,line_total:1000,sale_price:99999,purchase_price:88888}],
  own_medications:[{name:'Свой препарат',quantity:3,unit:'фл.',source:'previously_purchased'}],
  list_total:1600,charge_total:1300,paid_total:500,received_total:800,debt_total:500,discount_reason:'Постоянная скидка',discount_comment:'Согласовано с администратором',editable:true,
  stock_deducted:false,warehouse:'hidden-warehouse',salary:77777,notes:'Комментарий <b>не HTML</b>',...overrides};
}

test('patient card snapshots include authorized card fields and reject internal attributes',()=>{
 const clean=patientSnapshot(patient);
 assert.equal(clean.full_name,patient.full_name);assert.equal(clean.notes,patient.notes);
 assert.ok(!Object.hasOwn(clean,'auth_user_id'));assert.ok(!Object.hasOwn(clean,'purchase_price'));
 assert.throws(()=>patientSnapshot({id:'patient-1'}),/откройте карточку/);
});

test('complete chronological history includes more than 200 records without slicing or duplicate loss',()=>{
 const rows=Array.from({length:237},(_,index)=>procedure({id:'procedure-'+index,at:new Date(Date.UTC(2026,0,1,0,index)).toISOString()})).reverse();
 const history=historySnapshot({procedures:rows,sales:[{id:'sale-before',at:'2025-12-31T10:00:00Z',items:[],paid_total:100}]});
 assert.equal(history.length,238);assert.equal(history[0].id,'sale-before');assert.equal(history.at(-1).id,'procedure-236');
 const html=buildPatientCardHtml(patientSnapshot(patient),history);
 assert.equal((html.match(/data-card-event=/g)||[]).length,238);assert.match(html,/238\. Капельница/);assert.ok(html.indexOf('sale-before')<html.indexOf('procedure-0'));
});

test('print contains captured unit prices, complete financial history, own medicines and safe patient text',()=>{
 const history=historySnapshot({procedures:[procedure(),procedure({id:'pending',at:'2026-10-12T09:00:00Z',payment_pending:true,list_total:200,charge_total:200,paid_total:0,received_total:0,debt_total:200,discount_reason:null,discount_comment:null})],sales:[]});
 const html=buildPatientCardHtml(patientSnapshot(patient),history);
 for(const phrase of ['Карта пациента','Дата рождения','12.04.1980','Женский','Назначение врача','Сохранённый препарат × 2 амп.','500 ₽ за единицу','1 000 ₽','Скидка: <b>300 ₽','К оплате: <b>1 300 ₽','Оплачено всего: <b>800 ₽','В долг: <b>500 ₽','Ожидает оплаты: <b>200 ₽','Свой препарат × 3 фл.','Ранее куплен в кабинете','Москва','Наталья &lt;img&gt;','Анна &lt;script&gt;bad()&lt;/script&gt;','Жалобы &lt;img src=x&gt;','Комментарий &lt;b&gt;не HTML&lt;/b&gt;'])assert.ok(html.includes(phrase),phrase);
 for(const secret of ['99999','88888','77777','hidden-warehouse','auth_user_id','stock_deducted','<script>','<img','<button','onclick=','data-card-edit-v20','data-card-payment-v20','data-card-repeat-v33'])assert.ok(!html.includes(secret),secret);
});

test('patient-specific dose survives printable snapshots, stays separate from pack dosage and cannot change billed quantities',()=>{
 const source=procedure({items:[{name:'Препарат из шаблона',dosage:'500 мг / 2 мл',dose:'250 мг <img src=x onerror="bad()">',quantity:2,unit:'амп.',unit_price:500,line_total:1000,purchase_price:777777}]});
 const history=historySnapshot({procedures:[source],sales:[]});
 assert.equal(history[0].items[0].dose,source.items[0].dose);
 assert.equal(history[0].items[0].dosage,'500 мг / 2 мл');
 assert.equal(history[0].items[0].quantity,2);
 assert.equal(history[0].items[0].line_total,1000);
 assert.equal(history[0].charge,1300);
 source.items[0].dose='Изменено после загрузки';
 const html=buildPatientCardHtml(patientSnapshot(patient),history);
 assert.ok(html.includes('Препарат из шаблона · 500 мг / 2 мл × 2 амп. · Доза: 250 мг &lt;img src=x onerror=&quot;bad()&quot;&gt; · 500 ₽ за единицу · 1 000 ₽'));
 for(const value of ['<img src=x','777777','Изменено после загрузки'])assert.ok(!html.includes(value),value);
 const legacy=historySnapshot({procedures:[procedure({items:[{name:'Старый препарат',quantity:1,unit:'амп.',unit_price:100}]})],sales:[]});
 assert.equal(legacy[0].items[0].dose,null);
 assert.ok(!buildPatientCardHtml(patientSnapshot(patient),legacy).includes('Доза:'));
});

test('a final price above pricelist prints a positive surcharge and keeps original price, received money and debt',()=>{
 const history=historySnapshot({procedures:[procedure({list_total:1600,charge_total:2100,received_total:800,debt_total:1300,discount_amount:0,discount_reason:'Индивидуальная стоимость',discount_comment:'Дополнительная работа <b>по согласованию</b>'})],sales:[]});
 assert.equal(history[0].list,1600);assert.equal(history[0].charge,2100);
 assert.equal(history[0].discount,0);assert.equal(history[0].surcharge,500);
 assert.equal(history[0].received,800);assert.equal(history[0].debt,1300);
 for(const interactive of [false,true]){
  const html=buildPatientCardHtml(patientSnapshot(patient),history,interactive);
  for(const phrase of ['По прайсу: <b>1 600 ₽','Скидка: <b>0 ₽','Надбавка: <b>500 ₽','К оплате: <b>2 100 ₽','Оплачено всего: <b>800 ₽','В долг: <b>1 300 ₽','Итоговая стоимость: <b>2 100 ₽','Дополнительная работа &lt;b&gt;по согласованию&lt;/b&gt;'])assert.ok(html.includes(phrase),phrase);
  assert.ok(!html.includes('Скидка: <b>-'));assert.ok(!html.includes('<b>по согласованию</b>'));
 }
 const discounted=historySnapshot({procedures:[procedure()],sales:[]});
 assert.equal(discounted[0].surcharge,0);assert.ok(!buildPatientCardHtml(patientSnapshot(patient),discounted).includes('Надбавка:'));
});

test('live card supports authorized edit, repeat and payment controls while print strips every control',()=>{
 const history=historySnapshot({procedures:[procedure()],sales:[]});
 const live=buildPatientCardHtml(patientSnapshot(patient),history,true),printed=buildPatientCardHtml(patientSnapshot(patient),history);
 assert.match(live,/data-card-edit-v20="procedure-1"/);assert.match(live,/data-card-payment-v20="procedure-1"/);assert.match(live,/data-card-repeat-v33="procedure-1"/);assert.match(live,/Принять оплату долга/);assert.ok(!printed.includes('<button'));
 const readOnly=historySnapshot({procedures:[procedure({editable:false,debt_total:0,received_total:1300})],sales:[]});const readOnlyHtml=buildPatientCardHtml(patientSnapshot(patient),readOnly,true);
 assert.match(readOnlyHtml,/data-card-repeat-v33="procedure-1"/);assert.ok(!readOnlyHtml.includes('data-card-edit-v20'));assert.ok(!readOnlyHtml.includes('data-card-payment-v20'));
 const sale=historySnapshot({procedures:[],sales:[procedure({id:'sale-1',editable:false,debt_total:0,received_total:1300})]});assert.ok(!buildPatientCardHtml(patientSnapshot(patient),sale,true).includes('data-card-repeat-v33'));
});

test('malformed or partial history cannot silently become an empty printable card',()=>{
 for(const invalid of [null,{},[],{procedures:[]},{procedures:[],sales:null},{procedures:null,sales:[]}])assert.throws(()=>historySnapshot(invalid),/Полная история/);
 assert.deepEqual(historySnapshot({procedures:[],sales:[]}),[]);
 assert.match(buildPatientCardHtml(patientSnapshot(patient),[]),/История процедур и продаж пока пустая/);
});

test('patient card and print retain exact ordinary payment channels and separate debt repayments',()=>{
 const source=procedure({paid_total:125.25,received_total:875.25,debt_total:424.75,payments:{cash:125.25,terminal:250,owner_card:300,unclassified:0,cash_received:99999,internal:'hidden-channel'},debt_repayments_total:200});
 const history=historySnapshot({procedures:[source],sales:[]});
 assert.deepEqual(history[0].payments,{cash:125.25,terminal:250,owner_card:300,other_card:0,unclassified:0,debt_repayments_total:200});
 source.payments.owner_card=777777;
 for(const interactive of [true,false]){
  const html=buildPatientCardHtml(patientSnapshot(patient),history,interactive);
  for(const phrase of ['Наличные: <b>125,25 ₽','Терминал: <b>250 ₽','Перевод на карту начальника: <b>300 ₽','Погашено долга отдельно: <b>200 ₽','не входит в сумму и наличные смены'])assert.ok(html.includes(phrase),phrase);
  for(const secret of ['99999','777777','hidden-channel','Способ оплаты не указан'])assert.ok(!html.includes(secret),secret);
 }
});

test('unknown payment channels stay unknown and unpaid pending cards never show fictitious cash',()=>{
 const legacy=historySnapshot({procedures:[procedure({received_total:800,payments:null})],sales:[]});
 const html=buildPatientCardHtml(patientSnapshot(patient),legacy);
 assert.ok(html.includes('Способ оплаты не указан: <b>800 ₽'));assert.ok(!html.includes('data-payment-method="cash"'));assert.ok(!html.includes('data-payment-method="terminal"'));assert.ok(!html.includes('data-payment-method="owner_card"'));
 assert.deepEqual(paymentSnapshot({received_total:800,payments:{cash:-20,terminal:200,owner_card:Infinity,unclassified:'<img>'}}),{cash:0,terminal:200,owner_card:0,other_card:0,unclassified:600,debt_repayments_total:0});
 assert.deepEqual(paymentSnapshot({received_total:800,payments:{cash:900,terminal:100},debt_repayments_total:900}),{cash:0,terminal:0,owner_card:0,other_card:0,unclassified:800,debt_repayments_total:0});
 const pending=historySnapshot({procedures:[procedure({paid_total:0,received_total:0,debt_total:1300,payment_pending:true,payments:{cash:0,terminal:0,owner_card:0}})],sales:[]});
 const waiting=buildPatientCardHtml(patientSnapshot(patient),pending);
 assert.ok(waiting.includes('Ожидает оплаты: <b>1 300 ₽'));assert.ok(!waiting.includes('data-payment-method='));
});

test('ordinary-only report totals use lifetime receipts for methods without subtracting debt twice',()=>{
 const source=procedure({paid_total:125.25,received_total:675.25,lifetime_received_total:875.25,debt_repayments_total:200,payments:{cash:125.25,terminal:250,owner_card:300,unclassified:0,total:675.25},payments_complete:true});
 const history=historySnapshot({procedures:[source],sales:[]});
 assert.equal(history[0].received,675.25);
 assert.deepEqual(history[0].payments,{cash:125.25,terminal:250,owner_card:300,other_card:0,unclassified:0,debt_repayments_total:200});
 const html=buildPatientCardHtml(patientSnapshot(patient),history);
 for(const phrase of ['Наличные: <b>125,25 ₽','Терминал: <b>250 ₽','Перевод на карту начальника: <b>300 ₽','Погашено долга отдельно: <b>200 ₽','Оплачено всего: <b>675,25 ₽'])assert.ok(html.includes(phrase),phrase);
 assert.ok(!html.includes('Способ оплаты не указан'));
});

test('another card remains a distinct ordinary channel in live and printable lifetime history',()=>{
 const source=procedure({paid_total:100,received_total:1000.75,debt_total:299.25,payments:{cash:100,terminal:200,owner_card:250,other_card:300.75},debt_repayments_total:150});
 const history=historySnapshot({procedures:[source],sales:[]});
 assert.deepEqual(history[0].payments,{cash:100,terminal:200,owner_card:250,other_card:300.75,unclassified:0,debt_repayments_total:150});
 source.payments.other_card=999999;
 for(const interactive of [true,false]){
  const html=buildPatientCardHtml(patientSnapshot(patient),history,interactive);
  for(const phrase of ['Наличные: <b>100 ₽','Терминал: <b>200 ₽','Перевод на карту начальника: <b>250 ₽','Другая карта: <b>300,75 ₽','Погашено долга отдельно: <b>150 ₽'])assert.ok(html.includes(phrase),phrase);
  assert.ok(!html.includes('Способ оплаты не указан'));assert.ok(!html.includes('999999'));
 }
 const only=historySnapshot({procedures:[],sales:[procedure({received_total:300.75,payments:{other_card:300.75},debt_repayments_total:0})]});
 const onlyHtml=buildPatientCardHtml(patientSnapshot(patient),only);
 assert.ok(onlyHtml.includes('data-payment-method="other_card"'));assert.ok(!onlyHtml.includes('data-payment-method="cash"'));assert.ok(!onlyHtml.includes('data-payment-method="terminal"'));assert.ok(!onlyHtml.includes('data-payment-method="owner_card"'));
});

test('another card obeys legacy validation without classifying malformed or excess amounts as cash',()=>{
 assert.deepEqual(paymentSnapshot({received_total:800,payments:{cash:100,terminal:200,other_card:-50}}),{cash:100,terminal:200,owner_card:0,other_card:0,unclassified:500,debt_repayments_total:0});
 assert.deepEqual(paymentSnapshot({received_total:800,payments:{cash:100,terminal:200,other_card:600}}),{cash:0,terminal:0,owner_card:0,other_card:0,unclassified:800,debt_repayments_total:0});
 assert.deepEqual(paymentSnapshot({received_total:500,lifetime_received_total:800,debt_repayments_total:300,payments:{other_card:500}}),{cash:0,terminal:0,owner_card:0,other_card:500,unclassified:0,debt_repayments_total:300});
});
