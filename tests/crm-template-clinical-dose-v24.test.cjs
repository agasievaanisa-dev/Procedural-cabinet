const {test}=require('node:test');
const assert=require('node:assert/strict');
const {doseValue,protocolItems,paymentModel,ownedItems}=require('../crm-clinical-v10.js');

test('individual dose text is optional, bounded and distinct from billed whole quantities',()=>{
 assert.equal(doseValue(null),null);assert.equal(doseValue(undefined),null);assert.equal(doseValue('   '),null);
 assert.equal(doseValue(' 250 мг / 2 мл '),'250 мг / 2 мл');assert.equal(doseValue('а'.repeat(200)).length,200);
 for(const invalid of ['а'.repeat(201),500,{},[]])assert.throws(()=>doseValue(invalid),/200 символов/);
 const source=[{medication_id:'med-1',quantity:1,dose:' 250 мг '}];
 const copy=protocolItems(source);assert.deepEqual(copy,[{medication_id:'med-1',quantity:1,dose:'250 мг'}]);
 copy[0].dose='50 мг';assert.equal(source[0].dose,' 250 мг ');
 for(const quantity of [0,-1,0.5,Infinity])assert.throws(()=>protocolItems([{medication_id:'med-1',quantity,dose:'50 мг'}]),/целым/);
});
test('append merges equal doses and refuses ambiguous doses without changing the protocol',()=>{
 const same=protocolItems([{medication_id:'med-1',quantity:1,dose:'50 мг'},{medication_id:'med-1',quantity:2,dose:' 50 мг '}]);
 assert.deepEqual(same,[{medication_id:'med-1',quantity:3,dose:'50 мг'}]);
 assert.throws(()=>protocolItems([{medication_id:'med-1',quantity:1,dose:'50 мг'},{medication_id:'med-1',quantity:2,dose:'100 мг'}]),/разные дозы/);
 assert.throws(()=>protocolItems([{medication_id:'med-1',quantity:Number.MAX_SAFE_INTEGER},{medication_id:'med-1',quantity:1}]),/большое/);
 assert.throws(()=>protocolItems(null),/состав/);assert.throws(()=>protocolItems([null]),/Выберите/);
});
test('both higher and lower individual charges require reasons and still enforce receipt and debt constraints',()=>{
 for(const status of ['debt','pending']){
  const model=paymentModel({list:350,charge:400,received:0,status,patient:'patient',reason:'Индивидуальная стоимость'});
  assert.equal(model.list,35000);assert.equal(model.charge,40000);assert.equal(model.debt,40000);
 }
 const paid=paymentModel({list:350,charge:400,received:400,status:'paid',reason:'Индивидуальная стоимость'});
 assert.equal(paid.debt,0);assert.equal(paid.received,40000);
 assert.throws(()=>paymentModel({list:350,charge:400,received:400,status:'paid'}),/комментарий/);
 assert.throws(()=>paymentModel({list:350,charge:300,previous:350,received:0,status:'debt',patient:'patient',reason:'Скидка'}),/уже полученной/);
 assert.deepEqual(ownedItems([{name:'Своя ампула',quantity:1,unit:'амп.',source:'patient',dose:' 50 мг '}]),[{name:'Своя ампула',quantity:1,unit:'амп.',source:'patient',dose:'50 мг'}]);
});
