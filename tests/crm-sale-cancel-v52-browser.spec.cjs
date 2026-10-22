const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// All records and RPCs are fictional. No production data or accounts are used.
async function boot(page,role='admin',paid=false){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-22T08:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 if(!await page.evaluate(()=>typeof openSaleCancelV52==='function'))await page.addScriptTag({url:base+'/crm-financial-tools-v51.js'});
 await page.evaluate(async({role,paid})=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  const actor={id:role+'-test',full_name:'Администратор Проверки',role,active:true};
  const staff=[{id:'nurse-test',full_name:'Тестовая Медсестра'},{id:'nurse-other',full_name:'Другая Медсестра'}];
  const source={id:'source-shift',date:'2026-10-21',started_at:'2026-10-21T05:30:00Z',planned_end_at:'2026-10-21T13:00:00Z',status:'closed',staff};
  const opened={...source,id:'current-shift',date:'2026-10-22',status:'open'};
  patients=[];nurses=staff;services=[];
  meds=[{id:'amino-test',name:'Аминокислоты 250 мл (Корея)',consumption_unit:'фл.',sale_price:9500,active:true,work_qty:2}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:2,units_per_package:1,purchase_price:0}));
  window.__cancelRecords=new Map();window.__cancelWrites=[];window.__cancelCalls=[];window.__cancelReplay=new Map();
  window.__cancelLost=false;window.__cancelDeferred=false;window.__cancelReadFail=false;window.__cancelMalformed=null;window.__cancelReportFail=0;
  const seed={id:'original-sale',kind:'sale',editable:true,version:4,shift_id:source.id,patient_id:null,patient:null,nurse_id:staff[0].id,nurse:staff[0].full_name,at:'2026-10-21T06:00:00Z',sold_at:'2026-10-21T06:00:00Z',visit_at:'2026-10-21T06:00:00Z',list_total:9500,charge_total:9500,paid_total:9500,received_total:9500,initial_paid_total:9500,debt_total:0,pending_total:0,payment_pending:false,payment_status:'paid',stock_deducted:false,services:[],items:[{medication_id:meds[0].id,name:meds[0].name,quantity:1,unit:'фл.',unit_price:9500,line_total:9500}],own_medications:[],payments:{cash:0,terminal:9500,owner_card:0,other_card:0},notes:'Аминокислоты'};
  __cancelRecords.set(seed.id,clone(seed));
  __cancelRecords.set('duplicate-sale',{...clone(seed),id:'duplicate-sale',at:'2026-10-21T06:01:00Z',sold_at:'2026-10-21T06:01:00Z',visit_at:'2026-10-21T06:01:00Z',paid_total:paid?9500:0,received_total:paid?9500:0,initial_paid_total:paid?9500:0,debt_total:paid?0:9500,payment_status:paid?'paid':'debt',payments:{cash:0,terminal:paid?9500:0,owner_card:0,other_card:0}});
  function report(){
   const sales=[...__cancelRecords.values()].filter(s=>!s.cancelled),revenue={cash:0,terminal:0,owner_card:0,other_card:0,total:0};
   sales.forEach(s=>{for(const key of ['cash','terminal','owner_card','other_card'])revenue[key]+=s.payments[key]||0});
   revenue.total=revenue.cash+revenue.terminal+revenue.owner_card+revenue.other_card;
   const charge=sales.reduce((sum,s)=>sum+s.charge_total,0),debt=sales.reduce((sum,s)=>sum+s.debt_total,0);
   return {shift:source,staff:staff.map(s=>({...s,amount:0})),procedures:[],sales,receipts:[],patients_count:0,procedures_count:0,sales_count:sales.length,revenue,charge_total:charge,debt_total:debt,loan_debt_total:debt,pending_total:0,payroll_total:0,payroll_complete:true,payroll_unknown:0,cash_drawer:{opening_confirmed:true,opening:0,received_cash:0,salary_paid:0,balance:0},used:[],stock:[],untracked:[],warnings:[]};
  }
  db.from=()=>{const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:actor})};return q};
  db.rpc=async(name,args={})=>{
   __cancelCalls.push({name,args:clone(args)});
   if(name==='crm_sale_cancel_v52'){
    if(__cancelReplay.has(args.p_request_id))return {data:clone(__cancelReplay.get(args.p_request_id))};
    const p=args.p_payload,record=__cancelRecords.get(p.id);
    if(p.expected_version!==record.version||p.expected_received_total!==record.received_total)return {error:{code:'40001',message:'Продажа уже изменена. Откройте запись заново'}};
    if(record.received_total>0)return {error:{code:'22023',message:'У продажи есть полученная оплата'}};
    if(__cancelMalformed)return {data:{id:record.id,kind:'sale',cancelled:true,request_id:args.p_request_id,...clone(__cancelMalformed)}};
    record.cancelled=true;
    const result={id:record.id,kind:'sale',cancelled:true,shift_id:record.shift_id,patient_id:record.patient_id,request_id:args.p_request_id,returned_stock:[{medication_id:'amino-test',quantity:1}],reason:p.reason};
    __cancelReplay.set(args.p_request_id,clone(result));__cancelWrites.push({name,args:clone(args)});
    if(__cancelDeferred)await new Promise(resolve=>{window.__cancelRelease=resolve});
    if(__cancelLost){__cancelLost=false;throw new TypeError('Load failed')}
    return {data:result};
   }
   if(name==='crm_clinical_v10'){
    if(args.p_action==='treatment_get'){if(__cancelReadFail)return {error:{code:'P0001',message:'Не удалось прочитать продажу'}};return {data:clone(__cancelRecords.get(args.p_payload.id))}}
    return {data:[]};
   }
   if(name==='crm_finance_v5'){
    if(args.p_action==='accounting_mode')return {data:{payment_only:true,stock_deducted:false}};
    if(args.p_action==='shift_report'&&__cancelReportFail>0){__cancelReportFail--;return {error:{code:'P0001',message:'Ошибка обновления отчёта'}}}
    return {data:report()};
   }
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[report()]}};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};if(name.includes('warehouse'))return {data:inventory};
   return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'auth-test'});shift={id:opened.id,aId:staff[0].id,a:staff[0].full_name,bId:staff[1].id,b:staff[1].full_name,type:'08:30–16:00'};show('workspace');
 },{role,paid});
 return errors;
}
const writes=page=>page.evaluate(()=>__cancelWrites);
const calls=page=>page.evaluate(()=>__cancelCalls.filter(call=>call.name==='crm_sale_cancel_v52'));
async function openDuplicate(page){
 await page.evaluate(()=>openReportByIdV5('source-shift'));await expect(page.locator('#report')).toBeVisible();
 await page.evaluate(()=>document.querySelectorAll('#reportBody details').forEach(node=>node.open=true));
 await page.locator('#reportBody [data-event-id="duplicate-sale"]').getByRole('button',{name:'Удалить ошибочную продажу',exact:true}).click();
 await expect(page.locator('#financialToolsV51 [data-financial-save]')).toBeVisible();
}
async function confirm(page){
 await page.fill('[data-financial-reason]','Повторное сохранение одной продажи аминокислот');
 await page.check('[data-financial-confirm]');
}

for(const role of ['admin','owner'])test(`${role}: cancel anonymous duplicate sale, retain original and restore historical shift`,async({page})=>{
 const errors=await boot(page,role);await openDuplicate(page);
 const form=page.locator('#financialToolsV51');await expect(form).toContainText('Продажа без пациента');await expect(form).toContainText('Аминокислоты');await expect(form).toContainText('21.10.2026');await expect(form).toContainText('9');
 await confirm(page);await page.click('[data-financial-save]');await expect(page.locator('#report')).toBeVisible();
 await expect(page.locator('#reportBody [data-event-id="duplicate-sale"]')).toHaveCount(0);await expect(page.locator('#reportBody [data-event-id="original-sale"]')).toHaveCount(1);
 expect(await writes(page)).toHaveLength(1);const write=(await writes(page))[0];expect(write.name).toBe('crm_sale_cancel_v52');
 expect(write.args.p_payload).toMatchObject({id:'duplicate-sale',expected_version:4,expected_received_total:0,confirmed_duplicate:true});
 expect(write.args.p_payload.payments).toBeUndefined();expect(write.args.p_payload.shift_id).toBeUndefined();
 expect(await page.evaluate(()=>__cancelCalls.filter(c=>c.name==='crm_finance_v5'&&c.args.p_action==='shift_report').at(-1).args.p_payload.shift_id)).toBe('source-shift');
 expect(await page.evaluate(()=>__cancelRecords.get('original-sale'))).toMatchObject({received_total:9500,payments:{cash:0,terminal:9500,owner_card:0,other_card:0},shift_id:'source-shift'});
 expect(await page.evaluate(()=>__cancelCalls.filter(c=>/repay|refund|treatment_save|payment_methods/.test(c.name)).length)).toBe(0);expect(errors).toEqual([]);
});

test('unpaid duplicate requires reason and explicit duplicate confirmation',async({page})=>{
 const errors=await boot(page);await openDuplicate(page);await page.click('[data-financial-save]');await expect(page.locator('[data-financial-message]')).toContainText('причину');
 await page.fill('[data-financial-reason]','Дублирование');await page.click('[data-financial-save]');await expect(page.locator('[data-financial-message]')).toContainText('подтверждение');
 expect(await writes(page)).toHaveLength(0);expect(await calls(page)).toHaveLength(0);
 await page.check('[data-financial-confirm]');await page.click('[data-financial-save]');await expect(page.locator('#report')).toBeVisible();expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('changing deletion reason requires fresh duplicate confirmation',async({page})=>{
 const errors=await boot(page);await openDuplicate(page);await confirm(page);await page.fill('[data-financial-reason]','Уточнённая причина удаления');
 await expect(page.locator('[data-financial-confirm]')).not.toBeChecked();await page.click('[data-financial-save]');expect(await calls(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('paid sale cannot be deleted or used to erase actual received money',async({page})=>{
 const errors=await boot(page,'admin',true);await page.evaluate(()=>openSaleCancelV52('duplicate-sale'));
 await expect(page.locator('[data-financial-message]')).toContainText('Удаление заблокировано');await expect(page.locator('[data-financial-save]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Открыть запись для проверки оплаты',exact:true})).toBeVisible();expect(await writes(page)).toHaveLength(0);expect(await calls(page)).toHaveLength(0);expect(await page.evaluate(()=>__cancelRecords.get('duplicate-sale').payments.terminal)).toBe(9500);
 await page.evaluate(()=>{window.__editorCalls=[];window.editTreatmentV10=async(...args)=>__editorCalls.push(args)});await page.getByRole('button',{name:'Открыть запись для проверки оплаты',exact:true}).click();expect(await page.evaluate(()=>__editorCalls[0].slice(0,2))).toEqual(['sale','duplicate-sale']);expect(errors).toEqual([]);
});

test('uncertain cancellation freezes payload and replays same request without another stock return',async({page})=>{
 const errors=await boot(page);await openDuplicate(page);await confirm(page);await page.evaluate(()=>{__cancelLost=true});await page.click('[data-financial-save]');
 await expect(page.locator('[data-financial-message]')).toContainText('первоначальное');await expect(page.locator('[data-financial-reason]')).toBeDisabled();await expect(page.locator('[data-financial-back]')).toBeDisabled();
 await page.click('[data-financial-save]');await expect(page.locator('#report')).toBeVisible();const requests=await calls(page);expect(requests).toHaveLength(2);expect(requests[1].args).toEqual(requests[0].args);expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

for(const malformed of [{id:'another-sale'},{kind:'procedure'},{cancelled:false},{request_id:'other-request'}])test('unconfirmed sale result cannot claim successful deletion: '+Object.keys(malformed)[0],async({page})=>{
 const errors=await boot(page);await openDuplicate(page);await confirm(page);await page.evaluate(value=>{__cancelMalformed=value},malformed);await page.click('[data-financial-save]');
 await expect(page.locator('#financialToolsV51')).toBeVisible();await expect(page.locator('[data-financial-message]')).toContainText('первоначальное');expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('concurrent edit or payment rejects stale deletion and leaves record visible',async({page})=>{
 const errors=await boot(page);await openDuplicate(page);await confirm(page);await page.evaluate(()=>{__cancelRecords.get('duplicate-sale').version++});await page.click('[data-financial-save]');
 await expect(page.locator('[data-financial-message]')).toContainText('уже изменена');expect(await writes(page)).toHaveLength(0);await expect(page.locator('[data-financial-reason]')).toBeEnabled();expect(errors).toEqual([]);
});

test('nurse sees no delete action and direct sale opener cannot write',async({page})=>{
 const errors=await boot(page,'nurse');expect(await page.evaluate(()=>financialActionsHtmlV51(__cancelRecords.get('duplicate-sale')))).toBe('');
 await page.evaluate(()=>openSaleCancelV52('duplicate-sale'));await expect(page.locator('#financialToolsV51')).toHaveCount(0);expect(await writes(page)).toHaveLength(0);expect(await calls(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('failed sale read retries only the read and retains source report context',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__cancelReadFail=true});await page.evaluate(()=>openReportByIdV5('source-shift'));await page.evaluate(()=>document.querySelectorAll('#reportBody details').forEach(node=>node.open=true));
 await page.locator('#reportBody [data-event-id="duplicate-sale"]').getByRole('button',{name:'Удалить ошибочную продажу',exact:true}).click();await expect(page.locator('[data-financial-message]')).toContainText('прочитать');expect(await writes(page)).toHaveLength(0);
 await page.evaluate(()=>{__cancelReadFail=false});await page.getByRole('button',{name:'Обновить запись',exact:true}).click();await confirm(page);await page.click('[data-financial-save]');await expect(page.locator('#report')).toBeVisible();expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('late deletion result does not navigate back after administrator opens another screen',async({page})=>{
 const errors=await boot(page);await openDuplicate(page);await confirm(page);await page.evaluate(()=>{__cancelDeferred=true});await page.click('[data-financial-save]');await page.waitForFunction(()=>typeof __cancelRelease==='function');
 await page.evaluate(()=>goPatients());await expect(page.locator('#patients')).toBeVisible();await page.evaluate(()=>__cancelRelease());await expect.poll(async()=>(await writes(page)).length).toBe(1);await expect(page.locator('#patients')).toBeVisible();await expect(page.locator('#report')).not.toBeVisible();expect(errors).toEqual([]);
});

test('ambiguous deletion reopened after navigation preserves exact request and confirmations',async({page})=>{
 const errors=await boot(page);await openDuplicate(page);await confirm(page);await page.evaluate(()=>{__cancelDeferred=true;__cancelLost=true});await page.click('[data-financial-save]');await page.waitForFunction(()=>typeof __cancelRelease==='function');
 await page.evaluate(()=>goPatients());await page.evaluate(()=>__cancelRelease());await page.waitForTimeout(50);await page.evaluate(()=>{__cancelDeferred=false});await page.evaluate(()=>openSaleCancelV52('duplicate-sale'));
 await expect(page.locator('[data-financial-reason]')).toBeDisabled();await expect(page.locator('[data-financial-confirm]')).toBeChecked();await page.click('[data-financial-save]');
 const requests=await calls(page);expect(requests).toHaveLength(2);expect(requests[1].args).toEqual(requests[0].args);expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('signout during uncertain cancellation never restores previous employee data',async({page})=>{
 const errors=await boot(page);await openDuplicate(page);await confirm(page);await page.evaluate(()=>{__cancelDeferred=true;__cancelLost=true});await page.click('[data-financial-save]');await page.waitForFunction(()=>typeof __cancelRelease==='function');
 await page.evaluate(()=>signOut());await expect(page.locator('#login')).toBeVisible();await page.evaluate(()=>__cancelRelease());await expect(page.locator('#financialToolsV51')).toBeEmpty();await expect(page.locator('#reportBody')).toBeEmpty();await expect(page.locator('#login')).toBeVisible();expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});
