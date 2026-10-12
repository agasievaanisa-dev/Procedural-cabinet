const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRequester,deletePayload}=require('../crm-medication-delete-v7.js');

test('deletion submits the two checked balances and requires a reason',()=>{
 const preview={id:'med-1',expected_reserve:12,expected_work:3};
 assert.deepEqual(deletePayload(preview,' Ошибка ввода '),{id:'med-1',expected_reserve:12,expected_work:3,reason:'Ошибка ввода'});
 assert.throws(()=>deletePayload(preview,' '),/причину/);
 assert.throws(()=>deletePayload({...preview,expected_work:-1},'Причина'),/остатки/);
 assert.throws(()=>deletePayload({...preview,expected_reserve:1.5},'Причина'),/остатки/);
 assert.throws(()=>deletePayload(null,'Причина'),/проверки/);
});

test('lost deletion replies retry the same write ID and read calls never claim an ID',async()=>{
 let serial=0;const calls=[];let lost=true;
 const request=createRequester(async(name,args)=>{calls.push(args);if(lost&&args.p_action==='delete'){lost=false;return {error:{message:'Failed to fetch'}};}return {data:{deleted:true}};},()=>{},()=>`request-${++serial}`);
 await request('preview',{id:'med-1'});assert.equal(calls[0].p_request_id,null);
 const payload={id:'med-1',expected_reserve:12,expected_work:3,reason:'Ошибка'};
 await assert.rejects(request('delete',payload,true),/не продублируется/);
 await request('delete',payload,true);assert.equal(calls[1].p_request_id,calls[2].p_request_id);
 await request('delete',payload,true);assert.notEqual(calls[2].p_request_id,calls[3].p_request_id);
});

test('rolled-back writes receive a fresh ID; a new actor cannot reuse the previous ID',async()=>{
 let serial=0;const calls=[];let reject=true;let authorized=true;
 const request=createRequester(async(name,args)=>{calls.push(args);if(reject){reject=false;return {error:{code:'P0001',message:'Остатки изменились'}};}return {data:{restored:true}};},()=>{if(!authorized)throw Error('Только владелец');},()=>`request-${++serial}`);
 const payload={id:'med-1',reason:'Возвращаем карточку'};
 await assert.rejects(request('restore',payload,true),/изменились/);await request('restore',payload,true);assert.notEqual(calls[0].p_request_id,calls[1].p_request_id);
 request.clear();authorized=false;await assert.rejects(request('restore',payload,true),/владелец/);assert.equal(calls.length,2);
});

test('a late response after clearing requests cannot erase a new actor retry ID',async()=>{
 let serial=0,release;const calls=[];
 const request=createRequester(async(name,args)=>{calls.push(args);if(calls.length===1)return new Promise(resolve=>{release=resolve;});return {error:{message:'Failed to fetch'}};},()=>{},()=>`request-${++serial}`);
 const payload={id:'med-1',reason:'Восстановление'};
 const previous=request('restore',payload,true);request.clear();await assert.rejects(request('restore',payload,true));release({data:{restored:true}});await previous;
 await assert.rejects(request('restore',payload,true));assert.notEqual(calls[0].p_request_id,calls[1].p_request_id);assert.equal(calls[1].p_request_id,calls[2].p_request_id);
});
test('malformed delete and restore acknowledgements retain their UUID instead of claiming success',async()=>{
 for(const action of ['delete','restore']){
  const calls=[];let serial=0,reply;
  const request=createRequester(async(_name,args)=>{calls.push(args);return reply;},()=>{},()=>`request-${++serial}`);
  const payload={id:'med-1',reason:'Ошибка'};
  for(const value of [null,{},[],{deleted:false,restored:false}]){reply={data:value};await assert.rejects(request(action,payload,true),error=>error.uncertain===true);}
  reply={data:action==='delete'?{deleted:true}:{restored:true}};await request(action,payload,true);
  assert.equal(new Set(calls.map(call=>call.p_request_id)).size,1);
 }
});
test('a malformed deleted list is rejected and thrown errors preserve recovery metadata',async()=>{
 let reply={data:null};const request=createRequester(async()=>{if(reply instanceof Error)throw reply;return reply;},()=>{},()=> 'request');
 await assert.rejects(request('list_deleted'),/загрузить данные/);reply={data:[]};assert.deepEqual(await request('list_deleted'),[]);
 reply=Object.assign(Error('Connection reset'),{code:'08006',status:503,uncertain:true});
 await assert.rejects(request('restore',{id:'med-1'},true),error=>error.code==='08006'&&error.status===503&&error.uncertain===true);
});
