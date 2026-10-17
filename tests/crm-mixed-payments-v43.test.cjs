const assert=require('node:assert/strict');
const {allocationCents,cents,paymentModel}=require('../crm-clinical-v10.js');

assert.equal(allocationCents(''),0);
assert.equal(allocationCents('  '),0);
assert.equal(allocationCents(undefined),0);
assert.equal(allocationCents(null),0);
assert.equal(allocationCents('1200'),120000);
assert.equal(allocationCents('400,50'),40050);
assert.equal(allocationCents('0.01'),1);
assert.equal(allocationCents('1200')+allocationCents('400')+allocationCents(''),160000);
for(const value of ['-1','1.001','1,200.50','NaN','Infinity','1e3','90071992547410'])assert.throws(()=>allocationCents(value));
for(const value of ['',undefined,null,'  '])assert.throws(()=>cents(value));
assert.throws(()=>paymentModel({kind:'procedure',list:1600,charge:'',previous:0,received:1600,status:'paid',patient:'patient-test'}),/Стоимость для пациента/);
assert.throws(()=>paymentModel({kind:'procedure',list:1600,charge:1600,previous:0,received:'',status:'debt',patient:'patient-test'}),/Оплата сейчас/);
assert.deepEqual(paymentModel({kind:'procedure',list:1600,charge:1600,previous:0,received:1600,status:'paid',patient:'patient-test'}),{list:160000,charge:160000,previous:0,received:160000,debt:0,status:'paid',reason:''});
console.log('Mixed-payment optional channels keep required financial amounts strict.');
