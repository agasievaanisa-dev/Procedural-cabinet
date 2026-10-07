const test=require('node:test'),assert=require('node:assert/strict');
const {payload,balance,createRequester}=require('../crm-stock-correction-v6.js');
test('corrections replace the counted balance, allow zero, and separate package metadata',()=>{
 const base={id:'m1',batch_id:'b1',location:'reserve',actual:'0',expected:12,reason:' Перепутала цифры '};
 assert.deepEqual(payload('inventory',base),{id:'m1',batch_id:'b1',location:'reserve',actual_quantity:0,expected_quantity:12,reason:'Перепутала цифры'});
 assert.equal(balance({quantity_remaining:30,work_quantity:7},'reserve'),23);assert.equal(balance({quantity_remaining:30,work_quantity:7},'work'),7);
 assert.deepEqual(payload('package',{...base,actual:5,expected:10}),{id:'m1',units_per_package:5,expected_units_per_package:10,reason:'Перепутала цифры'});
 for(const invalid of ['',-1,'0.5',Infinity])assert.throws(()=>payload('inventory',{...base,actual:invalid}),/целое число/);
 assert.throws(()=>payload('package',{...base,actual:0,expected:10}),/от 1/);assert.throws(()=>payload('inventory',{...base,reason:' '}),/причину/);
});
test('lost responses reuse the operation ID; explicit database rollbacks get a new ID',async()=>{
 const calls=[];let counter=0,reply={error:{message:'Failed to fetch'}};
 const send=createRequester(async(name,args)=>{calls.push({name,args});return reply;},()=>{},()=>`id${++counter}`);
 const data={id:'m1',reason:'Ошибка',actual_quantity:3,expected_quantity:8};
 await assert.rejects(send('inventory',data),/Не получен ответ сервера/);await assert.rejects(send('inventory',data));assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id);
 reply={error:{code:'P0001',message:'Остаток уже изменился'}};await assert.rejects(send('inventory',data));reply={data:{quantity:3},error:null};assert.deepEqual(await send('inventory',data),{quantity:3});assert.notEqual(calls[2].args.p_request_id,calls[3].args.p_request_id);
 assert.equal(calls[0].name,'crm_stock_correction_v6');
});
test('authorization fails before creating any correction request',async()=>{
 let calls=0;const send=createRequester(async()=>{calls++;},()=>{throw Error('Только владельцу');},()=>{calls++;});
 await assert.rejects(send('package',{}),/владельцу/);assert.equal(calls,0);
});
test('an old response after clearing a session cannot discard the next session retry ID',async()=>{
 const calls=[];let counter=0,resolveFirst;
 const send=createRequester(async(name,args)=>{
  calls.push(args);if(calls.length===1)return new Promise(resolve=>{resolveFirst=resolve;});
  return calls.length===2?{error:{message:'Failed to fetch'}}:{data:{quantity:3},error:null};
 },()=>{},()=>`id${++counter}`);
 const data={id:'m1',actual_quantity:3,expected_quantity:8,reason:'Ошибка'};
 const old=send('inventory',data);send.clear();await assert.rejects(send('inventory',data));resolveFirst({data:{quantity:3},error:null});await old;await send('inventory',data);
 assert.notEqual(calls[0].p_request_id,calls[1].p_request_id);assert.equal(calls[1].p_request_id,calls[2].p_request_id);
});
