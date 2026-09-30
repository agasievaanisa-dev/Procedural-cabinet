const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',disabled:false});return elements.get(id)};
const calls=[],messages=[];let behavior,refreshes=0;
const c={console,Map,JSON,Error,crypto:require('node:crypto').webcrypto,document:{querySelectorAll:()=>[]},$:el,
 shift:{id:'shift'},rows:()=>[{medication_id:'med',quantity:2}],
 positiveWhole:(v)=>{if(!Number.isInteger(Number(v))||Number(v)<=0)throw Error('Количество');return Number(v)},
 nonnegative:(v)=>{if(v===''||Number(v)<0)throw Error('Оплата');return Number(v)},
 message:(...a)=>messages.push(a),show:()=>{},refreshDashboard:async()=>{refreshes++},
 db:{rpc:async(name,args)=>{calls.push({name,args});return await behavior(args)}},saveProcedure:null,saveSale:null,bulkImportMeds:null};
vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../workflow-v3.js','utf8'),c);
(async()=>{
 behavior=async()=>({error:{message:'Connection lost'}});
 await assert.rejects(c.treatmentRpc('sale',{items:[]}));
 behavior=async()=>({data:{id:'saved'}});await c.treatmentRpc('sale',{items:[]});
 assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id);
 for(const prefix of ['proc','sale']){el(prefix+'Paid').value='100';el(prefix+'Nurse').value='nurse';el(prefix+'Patient').value='patient'}
 el('procService').value='service';
 let release;behavior=()=>new Promise(r=>{release=r});
 const saving=c.saveProcedure();await c.saveProcedure();assert.equal(calls.length,3,'Double click must issue one request');
 release({data:{id:'saved'}});await saving;
 assert.equal(calls[2].name,'record_treatment_v3');assert.equal(calls[2].args.p_kind,'procedure');
 assert.equal(calls[2].args.p_payload.items[0].quantity,2);assert.equal(el('procPaid').value,'');assert.equal(refreshes,1);
 behavior=async()=>({error:{code:'P0001',message:'Недостаточно'}});await c.saveSale();
 assert.equal(el('salePaid').value,'100','Failure must preserve form');assert.equal(refreshes,1);
 c.rows=()=>[{medication_id:'med',quantity:0.5}];const before=calls.length;await c.saveSale();assert.equal(calls.length,before);
 assert.ok(messages.some(x=>x[1]==='Недостаточно'));
 assert.equal(fs.readFileSync(__dirname+'/../warehouse-v3.js','utf8'),fs.readFileSync(__dirname+'/../warehouse.js','utf8'));
 console.log('PASS: clinical replay IDs, double click, RPC payload, form clear on success, preservation on failure, fractional rejection, deployed bundle equality');
})().catch(e=>{console.error(e);process.exitCode=1});
