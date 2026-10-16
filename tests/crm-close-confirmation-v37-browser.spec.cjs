const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

function report(){return {
 shift:{id:'close-confirm-shift',date:'2026-10-16',started_at:'2026-10-16T05:30:00Z',planned_end_at:'2026-10-16T13:00:00Z',status:'open'},
 staff:[{id:'nurse-1',full_name:'Марьям',amount:2000},{id:'nurse-2',full_name:'Патя',amount:2000}],
 patients_count:14,procedures_count:14,sales_count:0,revenue:{cash:35900,terminal:5400,owner_card:500,total:41800},
 payroll_total:4000,payroll_complete:true,loan_debt_total:9100,pending_total:0,procedures:[],sales:[],receipts:[],stock:[],used:[],warnings:[],
 cash_drawer:{shift_id:'close-confirm-shift',scope:'shift',opening_confirmed:true,opening:0,received_cash:35900,salary_paid:4000,cash_in:0,cash_out:0,balance:31900,
  salary_auto:true,salary_auto_total:4000,salary_auto_remaining:0,salary_deduction:4000,cash_after_salary_auto:31900,
  reconciliation_v37:{required:true,token:'ledger-confirmed',stale:false,can_close:true,count:{id:'confirmed-count',counted_cash:31900,expected_cash:31900,difference:0,reason:'',salary_confirmed:true,created_at:'2026-10-16T13:01:00Z'},history:[]}}
};}

async function boot(page,{ack='closed',hold=false}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const origin=new URL(base).origin;
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(({data,ack,hold})=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  currentStaff={id:'nurse-1',full_name:'Марьям',role:'nurse',active:true};
  window.__closeWorkingShift={id:data.shift.id,aId:'nurse-1',bId:'nurse-2',a:'Марьям',b:'Патя',type:'08:30–16:00'};
  shift=clone(__closeWorkingShift);nurses=clone(data.staff);patients=[];inventory=[];meds=[];
  window.__closeCalls=[];window.__closeUnexpected=[];window.__closeRefreshes=[];window.__closeMode=ack;window.__closeHold=hold;
  window.__closeInitialReport=clone(data);
  db.rpc=async(name,args={})=>{
   __closeCalls.push({name,args:clone(args)});
   if(name==='crm_finance_v5'&&args.p_action==='close'){
    const mode=__closeMode;
    if(__closeHold)await new Promise(resolve=>{window.__releaseClose=resolve});
    if(mode==='null')return {data:null,error:null};
    const answer=clone(__closeInitialReport);
    answer.shift.status=mode==='open'?'open':'closed';
    if(mode==='wrong-id')answer.shift.id='different-closed-shift';
    return {data:answer,error:null};
   }
   __closeUnexpected.push({name,args:clone(args)});throw Error('Unexpected close-confirmation RPC '+name+' '+args.p_action);
  };
  loadQuickContext=async()=>{__closeRefreshes.push('context')};refreshDashboard=async()=>{};refreshOwnerDashboardV5=async()=>{__closeRefreshes.push('dashboard')};
  document.getElementById('homeNav').classList.remove('hidden');document.getElementById('accountMenu').classList.remove('hidden');
  show('workspace');renderShiftReportV5(data,false);
 },{data:report(),ack,hold});
 await expect(page.locator('#report')).toBeVisible();return errors;
}
async function startClose(page){
 await page.evaluate(()=>{window.__closePromise=closeShift()});
 await page.waitForFunction(()=>typeof __releaseClose==='function');
}
async function releaseClose(page){await page.evaluate(async()=>{const release=__releaseClose;delete window.__releaseClose;release();await __closePromise});}
async function expectSingleClose(page){
 expect(await page.evaluate(()=>__closeCalls)).toEqual([{name:'crm_finance_v5',args:{p_action:'close',p_payload:{shift_id:'close-confirm-shift'}}}]);
 expect(await page.evaluate(()=>__closeUnexpected)).toEqual([]);
}

test('a delayed confirmed close does not return to the report after the nurse goes home',async({page})=>{
 const errors=await boot(page,{hold:true});await startClose(page);
 await page.locator('#homeNav').click();await expect(page.locator('#workspace')).toBeVisible();await releaseClose(page);
 await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#report')).not.toBeVisible();
 await expect(page.locator('#cashReconciliationV37')).not.toBeVisible();await expect(page.locator('#reportBody')).not.toContainText('Смена закрыта');
 expect(await page.evaluate(()=>shift)).toBeNull();expect(await page.evaluate(()=>__closeRefreshes)).toEqual([]);
 await expectSingleClose(page);expect(errors).toEqual([]);
});

for(const ack of ['null','open','wrong-id'])test(`a ${ack} close acknowledgement cannot clear the working shift or announce completion`,async({page})=>{
 const errors=await boot(page,{ack});await page.evaluate(()=>closeShift());
 expect(await page.evaluate(()=>shift)).toEqual(await page.evaluate(()=>__closeWorkingShift));
 await expect(page.locator('#reportBody')).not.toContainText('Смена закрыта');await expect(page.locator('#reportBody .notice.success')).toHaveCount(0);
 expect(await page.evaluate(()=>financeShiftSnapshot5?.id)).toBe('close-confirm-shift');
 expect(await page.evaluate(()=>financeShiftSnapshot5?.data?.shift?.status)).toBe('open');
 expect(await page.evaluate(()=>financeBusy5)).toBe(false);await expectSingleClose(page);expect(errors).toEqual([]);
});

test('a late close acknowledgement after logout cannot restore report data or success notices',async({page})=>{
 const errors=await boot(page,{hold:true});await startClose(page);await page.evaluate(()=>signOut());
 await expect(page.locator('#login')).toBeVisible();await releaseClose(page);
 await expect(page.locator('#login')).toBeVisible();await expect(page.locator('#report')).not.toBeVisible();await expect(page.locator('#reportBody')).toBeEmpty();
 expect(await page.evaluate(()=>currentStaff)).toBeNull();expect(await page.evaluate(()=>shift)).toBeNull();
 expect(await page.evaluate(()=>financeShiftSnapshot5)).toBeNull();expect(await page.evaluate(()=>financeBusy5)).toBe(false);
 await expectSingleClose(page);expect(errors).toEqual([]);
});
