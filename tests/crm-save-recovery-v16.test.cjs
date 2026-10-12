const {test}=require('node:test');const assert=require('node:assert/strict');
const {install,isRetryable,isDefinitive}=require('../crm-save-recovery-v16.js');
function harness(handler,config={}){
 let identity='staff-1',sequence=0,notify;const calls=[];
 const client={auth:{onAuthStateChange(fn){notify=fn}},rpc:async(name,args,options)=>{calls.push({name,args:structuredClone(args),options});return handler(name,args,calls.length)}};
 install(client,()=>identity,{uuid:()=>`request-${++sequence}`,timeoutMs:0,pause:async()=>{},...config});
 return {client,calls,actor:v=>identity=v,event:(event,id)=>notify(event,id?{user:{id}}:null)};
}
test('safe mutation recovers a lost reply using exactly the original UUID and payload',async()=>{
 const h=harness((name,args,n)=>n===1?{error:{message:'TypeError: Load failed'},status:0}:{data:{id:'procedure-1'},error:null,status:200});
 const args={p_kind:'procedure',p_request_id:'original-uuid',p_payload:{paid_total:100}};
 const result=await h.client.rpc('record_treatment_v5',args);assert.equal(result.data.id,'procedure-1');assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0].args,h.calls[1].args);assert.equal(h.calls[1].args.p_request_id,'original-uuid');
});
test('legacy template save uses a receipt even when the first committed response is lost',async()=>{
 const ledger=new Map();let created=0;
 const h=harness((name,args,n)=>{assert.equal(name,'crm_save_recovery_v16');if(!ledger.has(args.p_request_id))ledger.set(args.p_request_id,{id:`template-${++created}`,name:args.p_args.p_payload.name});return n===1?{error:{message:'Gateway failed'},status:503}:{data:{result:ledger.get(args.p_request_id)},status:200}});
 const result=await h.client.rpc('crm_management_v5',{p_action:'template_save',p_payload:{name:'Test'}},{saveRequestIdV16:'frozen-id'});
 assert.equal(result.data.id,'template-1');assert.equal(created,1);assert.equal(h.calls[1].args.p_request_id,'frozen-id');assert.equal(h.calls[0].options.saveRequestIdV16,undefined);
});
test('definitive permission and validation failures are preserved without automatic retry',async()=>{
 const h=harness(()=>({error:{message:'Access denied',code:'42501'},status:403}));const result=await h.client.rpc('crm_management_v5',{p_action:'staff_save',p_payload:{id:'staff-2'}});
 assert.equal(h.calls.length,1);assert.equal(result.error.code,'42501');assert.equal(result.error.uncertain,false);assert.equal(isDefinitive(result.error,result.status),true);
});
test('connection SQLSTATE preserves request identity while business SQLSTATE does not retry',async()=>{
 assert.equal(isRetryable({code:'08006',message:'connection failure'},503),true);assert.equal(isDefinitive({code:'08006'},503),false);
 assert.equal(isRetryable({code:'P0001',message:'Invalid amount'},500),false);
 const h=harness((name,args,n)=>n===1?{error:{code:'08006',message:'connection lost'},status:503}:{data:{id:'med-1'},status:200});
 await h.client.rpc('warehouse_v5',{p_action:'save',p_payload:{name:'Test'},p_request_id:'same-id'});assert.equal(h.calls.length,2);assert.equal(h.calls[1].args.p_request_id,'same-id');
});
test('manual retry after two ambiguous failures keeps the legacy receipt',async()=>{
 const h=harness((name,args,n)=>n<=2?{error:{message:'Gateway failed'},status:502}:{data:{result:{id:'staff-2'}},status:200});const args={p_action:'staff_save',p_payload:{full_name:'Test'}};
 const first=await h.client.rpc('crm_management_v5',args);assert.equal(first.error.uncertain,true);assert.equal(first.error.recoveryAttemptedV16,true);
 const next=await h.client.rpc('crm_management_v5',args);assert.equal(next.data.id,'staff-2');assert.equal(h.calls[0].args.p_request_id,h.calls[2].args.p_request_id);
});
test('earlier uncertainty survives a later permission error until its result is confirmed',async()=>{
 const h=harness((name,args,n)=>n===1?{error:{message:'Load failed'},status:0}:n===2?{error:{message:'Access denied',code:'42501'},status:403}:{data:{result:{id:'staff-2'}},status:200});const args={p_action:'staff_save',p_payload:{full_name:'Test'}};
 const first=await h.client.rpc('crm_management_v5',args);assert.equal(first.error.uncertain,true);assert.equal(isDefinitive(first.error,first.status),false);
 const result=await h.client.rpc('crm_management_v5',args);assert.equal(result.data.id,'staff-2');assert.equal(h.calls[0].args.p_request_id,h.calls[2].args.p_request_id);
});
test('malformed or missing save/read bodies retry but never count as confirmed data',async()=>{
 const h=harness((name,args,n)=>n===1?{data:null,error:null,status:200}:{data:{patient:{id:'patient-1',full_name:'Test'}},status:200});const args={p_payload:{full_name:'Test'},p_request_id:'patient-request'};
 assert.equal((await h.client.rpc('crm_patient_save_v11',args)).data.patient.id,'patient-1');assert.deepEqual(h.calls[0].args,h.calls[1].args);
 const reads=harness(()=>({data:null,error:null,status:200}));const result=await reads.client.rpc('crm_management_v5',{p_action:'services_list'});assert.equal(reads.calls.length,2);assert.equal(result.data,null);assert.equal(result.error.retryable,true);
});
test('malformed HTTP-success JSON from the pinned SDK is treated as an uncertain response',async()=>{
 const h=harness((name,args,n)=>n===1?{data:null,error:{message:'{\"broken\":',code:''},status:200}:{data:{patient:{id:'patient-json'}},status:200});
 const result=await h.client.rpc('crm_patient_save_v11',{p_payload:{full_name:'Test'},p_request_id:'json-request'});assert.equal(result.data.patient.id,'patient-json');assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0].args,h.calls[1].args);
});
test('void metadata save requires the receipt envelope but permits a null nested result',async()=>{
 const h=harness((name,args,n)=>n===1?{data:null,error:null,status:200}:{data:{result:null},status:200});
 const result=await h.client.rpc('manager_medication_details_photo_v1',{p_id:'med-1',p_photo_path:'med-1/photo.jpg'});assert.equal(result.error,undefined);assert.equal(result.data,null);assert.equal(h.calls.length,2);assert.equal(h.calls[0].args.p_request_id,h.calls[1].args.p_request_id);
});
test('actor changes suppress stale results and prevent automatic retry under a new identity',async()=>{
 let h;h=harness(()=>{h.actor('staff-2');return {error:{message:'Load failed'},status:0}});const result=await h.client.rpc('warehouse_v5',{p_action:'save',p_payload:{name:'Test'},p_request_id:'old-request'});
 assert.equal(h.calls.length,1);assert.equal(result.error.code,'CRM_SESSION_CHANGED');assert.equal(result.data,null);
});
test('logout and login under the same staff ID cannot reuse the previous unresolved receipt',async()=>{
 const h=harness(()=>({error:{message:'Load failed'},status:0}));const args={p_action:'staff_save',p_payload:{full_name:'Test'}};
 await h.client.rpc('crm_management_v5',args);h.event('SIGNED_OUT');h.event('SIGNED_IN','same-user');await h.client.rpc('crm_management_v5',args);
 assert.notEqual(h.calls[0].args.p_request_id,h.calls[2].args.p_request_id);
});
test('an unknown unsafe write and the revoked medication prototype are never routed or blindly replayed',async()=>{
 const h=harness(()=>({error:{message:'Load failed'},status:0}));await h.client.rpc('unknown_create',{name:'Test'});await h.client.rpc('manager_set_medication_test',{p_name:'Test'});
 assert.equal(h.calls.length,2);assert.equal(h.calls[0].name,'unknown_create');assert.equal(h.calls[1].name,'manager_set_medication_test');
});
test('timeout preserves a mutation receipt for subsequent retry',async()=>{
 let resolveFirst;const h=harness((name,args,n)=>n===1?new Promise(resolve=>resolveFirst=resolve):{data:{id:'procedure-1'},status:200},{timeoutMs:10});
 const result=await h.client.rpc('record_treatment_v5',{p_request_id:'fixed-timeout-id',p_payload:{}});assert.equal(result.data.id,'procedure-1');assert.equal(h.calls.length,2);assert.equal(h.calls[0].args.p_request_id,h.calls[1].args.p_request_id);resolveFirst({data:{id:'procedure-1'},status:200});
});
