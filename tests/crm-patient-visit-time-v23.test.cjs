const {test}=require('node:test');
const assert=require('node:assert/strict');
const {patientSnapshot,historySnapshot,buildPatientCardHtml}=require('../crm-patient-card-v20.js');

test('registered visit time is whitelisted and printed in Moscow alongside distinct procedure time',()=>{
 const patient=patientSnapshot({id:'patient-visit',full_name:'Пациент',first_visit_at:'2026-10-13T07:25:41.125Z',created_at:'2026-10-13T18:45:00Z',internal:'private'});
 assert.equal(patient.first_visit_at,'2026-10-13T07:25:41.125Z');
 assert.ok(!Object.hasOwn(patient,'created_at'));assert.ok(!Object.hasOwn(patient,'internal'));
 const events=historySnapshot({procedures:[{id:'procedure-visit',at:'2026-10-13T08:05:00Z',visit_at:'2026-10-13T18:45:00Z',procedure_type:'Капельница',items:[],charge_total:600,paid_total:600}],sales:[]});
 const html=buildPatientCardHtml(patient,events);
 assert.match(html,/Первое посещение · Москва/);assert.match(html,/13\.10\.2026, 10:25/);assert.match(html,/13\.10\.2026, 11:05/);assert.doesNotMatch(html,/21:45/);
});

test('historical patient without an actual first visit stays unknown in live and printed profiles',()=>{
 const patient=patientSnapshot({id:'patient-old',full_name:'Старая карточка',created_at:'2026-10-13T15:00:00Z',updated_at:'2026-10-13T16:00:00Z'});
 assert.equal(patient.first_visit_at,'');
 for(const interactive of [false,true]){
  const html=buildPatientCardHtml(patient,[],interactive);
  assert.doesNotMatch(html,/Первое посещение/);assert.doesNotMatch(html,/18:00|19:00/);
 }
});
