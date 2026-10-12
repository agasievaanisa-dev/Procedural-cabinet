const {test}=require('node:test');
const assert=require('node:assert/strict');
const {patientSnapshot,historySnapshot,buildPatientCardHtml}=require('../crm-patient-card-v20.js');

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
 for(const secret of ['99999','88888','77777','hidden-warehouse','auth_user_id','stock_deducted','<script>','<img','<button','onclick=','data-card-edit-v20','data-card-payment-v20'])assert.ok(!html.includes(secret),secret);
});

test('live card supports authorized edit and payment controls while print strips every control',()=>{
 const history=historySnapshot({procedures:[procedure()],sales:[]});
 const live=buildPatientCardHtml(patientSnapshot(patient),history,true),printed=buildPatientCardHtml(patientSnapshot(patient),history);
 assert.match(live,/data-card-edit-v20="procedure-1"/);assert.match(live,/data-card-payment-v20="procedure-1"/);assert.match(live,/Принять оплату долга/);assert.ok(!printed.includes('<button'));
 const readOnly=historySnapshot({procedures:[procedure({editable:false,debt_total:0,received_total:1300})],sales:[]});assert.ok(!buildPatientCardHtml(patientSnapshot(patient),readOnly,true).includes('<button'));
});

test('malformed or partial history cannot silently become an empty printable card',()=>{
 for(const invalid of [null,{},[],{procedures:[]},{procedures:[],sales:null},{procedures:null,sales:[]}])assert.throws(()=>historySnapshot(invalid),/Полная история/);
 assert.deepEqual(historySnapshot({procedures:[],sales:[]}),[]);
 assert.match(buildPatientCardHtml(patientSnapshot(patient),[]),/История процедур и продаж пока пустая/);
});
