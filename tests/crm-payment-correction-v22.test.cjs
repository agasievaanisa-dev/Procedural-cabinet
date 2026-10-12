const {test}=require('node:test');
const assert=require('node:assert/strict');
const {paymentCorrectionAllowed,paymentModel}=require('../crm-clinical-v10.js');

test('only an editable saved record with prior money exposes the manager correction action',()=>{
 const record={id:'saved-procedure',editable:true,paid_total:8000};
 assert.equal(paymentCorrectionAllowed(record,true),true);
 assert.equal(paymentCorrectionAllowed(record,false),false);
 assert.equal(paymentCorrectionAllowed({...record,editable:false},true),false);
 assert.equal(paymentCorrectionAllowed({...record,id:null},true),false);
 for(const paid_total of [0,null,undefined,-1,'bad','8000.001'])assert.equal(paymentCorrectionAllowed({...record,paid_total},true),false);
});

test('a voided historical receipt is not offered for correction again',()=>{
 assert.equal(paymentCorrectionAllowed({id:'saved-procedure',editable:true,paid_total:0,received_total:0,initial_paid_total:0,original_paid_total:8000},true),false);
});

test('a discount smaller than a real previous payment remains forbidden outside explicit correction',()=>{
 const input={list:8000,charge:7500,previous:8000,received:0,status:'debt',reason:'Скидка от начальника',patient:'patient-1'};
 assert.throws(()=>paymentModel(input),/меньше уже полученной оплаты/);
 const corrected=paymentModel({...input,previous:0});
 assert.equal(corrected.list,800000);assert.equal(corrected.charge,750000);assert.equal(corrected.reason,'Скидка от начальника');
 assert.equal(corrected.previous,0);assert.equal(corrected.received,0);assert.equal(corrected.debt,750000);assert.equal(corrected.status,'debt');
});

test('an ordinary partially paid procedure keeps genuine receipts and creates debt for only the remainder',()=>{
 const normal=paymentModel({list:8000,charge:7500,previous:3000,received:0,status:'debt',reason:'Скидка от начальника',patient:'patient-1'});
 assert.equal(normal.previous,300000);assert.equal(normal.debt,450000);
 assert.throws(()=>paymentModel({list:8000,charge:7500,previous:3000,received:5000,status:'debt',reason:'Скидка',patient:'patient-1'}),/уже полученной оплаты/);
});

test('zeroing a phantom receipt never bypasses required discount explanation or debtor identity',()=>{
 assert.throws(()=>paymentModel({list:8000,charge:7500,previous:0,received:0,status:'debt',patient:'patient-1'}),/комментарий/);
 assert.throws(()=>paymentModel({list:8000,charge:7500,previous:0,received:0,status:'debt',reason:'Скидка'}),/выберите пациента/);
});
