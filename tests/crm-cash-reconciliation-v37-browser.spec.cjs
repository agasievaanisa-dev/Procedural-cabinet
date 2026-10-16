const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Fixed responses describe the cash ledger. The mock does not calculate wages,
// balances or differences: those computations are covered by the SQL suite.
function drawer({opening=true,status='open'}={}){return {
 shift_id:'count-shift',shift_status:status,scope:'shift',opening_confirmed:opening,opening:opening?0:null,
 received_cash:35900,salary_paid:0,cash_in:0,cash_out:0,balance:opening?35900:null,balance_negative:false,movements:[],
 salary_auto:true,salary_auto_total:4000,salary_auto_remaining:4000,salary_deduction:4000,cash_after_salary_auto:31900,
 payroll:[{staff_id:'nurse-1',staff_name:'Марьям',configured:2000,paid:0,outstanding:2000},{staff_id:'nurse-2',staff_name:'Патя',configured:2000,paid:0,outstanding:2000}],
 reconciliation_v37:{required:true,token:'ledger-a',count:null,history:[],stale:false,can_close:false}
};}
function saved({paid=true,difference=0,reason='',opening=true,status='open'}={}){
 const value=drawer({opening,status});
 if(paid){value.salary_paid=4000;value.salary_auto_remaining=0;value.balance=31900;value.payroll=value.payroll.map(person=>({...person,paid:2000,outstanding:0}));}
 const count={id:'count-1',counted_cash:paid?(difference?32100:31900):35900,expected_cash:paid?31900:35900,difference,reason,salary_confirmed:paid,staff_id:'nurse-1',staff_name:'Марьям',created_at:'2026-10-16T13:01:00Z'};
 value.reconciliation_v37={required:true,token:'ledger-b',count,history:[count],stale:false,can_close:true};return value;
}
async function boot(page,{role='nurse',initial=drawer(),response=saved()}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(({role,initial,response})=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  currentStaff={id:role==='nurse'?'nurse-1':'admin-1',full_name:role==='nurse'?'Марьям':'Аниса',role,active:true};
  shift=initial.shift_status==='closed'?null:{id:'count-shift',aId:'nurse-1',bId:'nurse-2',a:'Марьям',b:'Патя'};
  window.__countCalls=[];window.__countEffects=[];window.__countPayouts=[];window.__countReplay=new Map();
  window.__countServer={drawer:initial,response,lost:false,hold:false,reject:null,refresh:null,closeError:null};
  window.__countReport=()=>({shift:{id:'count-shift',date:'2026-10-16',started_at:'2026-10-16T05:30:00Z',planned_end_at:'2026-10-16T13:00:00Z',status:__countServer.drawer.shift_status},
   staff:[{id:'nurse-1',full_name:'Марьям',amount:2000},{id:'nurse-2',full_name:'Патя',amount:2000}],
   patients_count:14,procedures_count:14,sales_count:0,revenue:{cash:35900,terminal:5400,owner_card:500,total:41800},loan_debt_total:9100,pending_total:0,
   payroll_total:4000,payroll_complete:true,procedures:[],sales:[],receipts:[],stock:[],used:[],warnings:[],cash_drawer:clone(__countServer.drawer)});
  db.rpc=async(name,args={})=>{
   __countCalls.push({name,args:clone(args)});
   if(name==='crm_cash_reconciliation_v37'){
    if(args.p_action==='status')return {data:clone(__countServer.drawer)};
    if(args.p_action!=='save')throw Error('Unexpected reconciliation action '+args.p_action);
    if(__countServer.reject){const error=__countServer.reject;__countServer.reject=null;if(__countServer.refresh)__countServer.drawer=clone(__countServer.refresh);return {error,status:400};}
    let result=__countReplay.get(args.p_request_id);
    if(!result){__countEffects.push(clone(args));if(args.p_payload.salary_confirmed)__countPayouts.push({staff_id:'nurse-1',amount:2000},{staff_id:'nurse-2',amount:2000});result=clone(__countServer.response);result.reconciliation_v37.count.id=args.p_request_id;result.reconciliation_v37.history[0].id=args.p_request_id;__countReplay.set(args.p_request_id,result);__countServer.drawer=clone(result);}
    if(__countServer.hold){__countServer.hold=false;await new Promise(resolve=>window.__releaseCount=resolve);}
    if(__countServer.lost){__countServer.lost=false;throw new TypeError('Load failed');}
    return {data:clone(result)};
   }
   if(name==='crm_cash_drawer_v30'&&args.p_action==='status')return {data:clone(__countServer.drawer)};
   if(name==='crm_finance_v5'&&args.p_action==='shift_report')return {data:__countReport()};
   if(name==='crm_finance_v5'&&args.p_action==='close'){
    if(__countServer.closeError)return {error:__countServer.closeError,status:400};
    __countServer.drawer.shift_status='closed';return {data:__countReport()};
   }
   throw Error('Unexpected financial write '+name+' '+args.p_action);
  };
  loadQuickContext=async()=>{};refreshDashboard=async()=>{};refreshOwnerDashboardV5=async()=>{};
  window.print=()=>window.__countPrints=(window.__countPrints||0)+1;show('workspace');renderShiftReportV5(__countReport(),initial.shift_status==='closed');
 },{role,initial,response});return errors;
}
async function open(page,closeAfter=false){await page.evaluate(closeAfter=>openCashReconciliationV37('count-shift',{closeAfter}),closeAfter);await expect(page.locator('#cashReconciliationV37')).toBeVisible();}
const saves=page=>page.evaluate(()=>__countCalls.filter(call=>call.name==='crm_cash_reconciliation_v37'&&call.args.p_action==='save'));
const closes=page=>page.evaluate(()=>__countCalls.filter(call=>call.name==='crm_finance_v5'&&call.args.p_action==='close'));
async function fill(page,{amount='31900',salary='true',reason='',opening}={}){
 if(opening!==undefined)await page.fill('#cashCountOpeningV37',opening);
 await page.selectOption('#cashCountSalaryV37',salary);await page.fill('#cashCountAmountV37',amount);await page.fill('#cashCountReasonV37',reason);
}
async function submit(page){await page.click('#cashCountSaveV37');}

test('viewing reconciliation leaves salary choice empty and never creates cash or wage movements',async({page})=>{
 const errors=await boot(page);await open(page);await expect(page.locator('#cashCountSalaryV37')).toHaveValue('');await expect(page.locator('#cashCountAmountV37')).toHaveValue('');
 expect(await saves(page)).toEqual([]);expect(await page.evaluate(()=>__countPayouts)).toEqual([]);expect(await closes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('unknown opening and salary status require explicit answers; zero opening is valid',async({page})=>{
 const errors=await boot(page,{initial:drawer({opening:false}),response:saved({paid:false})});await open(page);
 await expect(page.locator('#cashCountOpeningV37')).toHaveValue('');await page.fill('#cashCountAmountV37','35900');await submit(page);expect(await saves(page)).toEqual([]);
 await page.selectOption('#cashCountSalaryV37','false');await submit(page);expect(await saves(page)).toEqual([]);
 await page.fill('#cashCountOpeningV37','0');await submit(page);await expect.poll(()=>saves(page)).toHaveLength(1);
 expect((await saves(page))[0].args.p_payload).toMatchObject({shift_id:'count-shift',expected_token:'ledger-a',opening_amount:0,counted_cash:35900,salary_confirmed:false});expect(await page.evaluate(()=>__countPayouts)).toEqual([]);expect(errors).toEqual([]);
});

test('unpaid salaries reconcile against 35,900 physical cash rather than the 31,900 automatic forecast',async({page})=>{
 const errors=await boot(page,{response:saved({paid:false})});await open(page);await fill(page,{salary:'false',amount:'35900'});await expect(page.locator('#cashCountPreviewV37')).toContainText(/35\s*900/);await submit(page);
 await expect.poll(()=>saves(page)).toHaveLength(1);expect((await saves(page))[0].args.p_payload).toMatchObject({counted_cash:35900,salary_confirmed:false});expect(await page.evaluate(()=>__countPayouts)).toEqual([]);
 await expect(page.locator('#cashReconciliationV37')).toContainText(/35\s*900/);expect(await page.evaluate(()=>__countServer.drawer.reconciliation_v37.count.difference)).toBe(0);expect(errors).toEqual([]);
});

test('confirmed salary deducts 2,000 per nurse once and 31,900 counted cash agrees',async({page})=>{
 const errors=await boot(page);await open(page);await fill(page);await expect(page.locator('#cashCountPreviewV37')).toContainText(/31\s*900/);await submit(page);
 await expect.poll(()=>saves(page)).toHaveLength(1);expect((await saves(page))[0].args.p_payload).toMatchObject({expected_token:'ledger-a',counted_cash:31900,salary_confirmed:true});
 expect(await page.evaluate(()=>__countPayouts)).toEqual([{staff_id:'nurse-1',amount:2000},{staff_id:'nurse-2',amount:2000}]);expect(await page.evaluate(()=>__countServer.drawer.reconciliation_v37.count)).toMatchObject({expected_cash:31900,counted_cash:31900,difference:0});expect(errors).toEqual([]);
});

test('a 200 surplus needs a reason and is recorded as a difference without fabricating income',async({page})=>{
 const reason='Пересчитано дважды <img src=x>';const errors=await boot(page,{response:saved({difference:200,reason})});await open(page);await fill(page,{amount:'32100'});await submit(page);expect(await saves(page)).toEqual([]);
 await page.fill('#cashCountReasonV37',reason);await submit(page);await expect.poll(()=>saves(page)).toHaveLength(1);
 expect((await saves(page))[0].args.p_payload).toMatchObject({counted_cash:32100,salary_confirmed:true,reason});expect(await page.evaluate(()=>__countServer.drawer.reconciliation_v37.count.difference)).toBe(200);
 expect(await page.evaluate(()=>__countCalls.some(call=>call.name==='crm_cash_drawer_v30'&&call.args.p_action==='movement_add'))).toBe(false);
 await expect(page.locator('#cashReconciliationV37')).toContainText(reason);await expect(page.locator('#cashReconciliationV37 img')).toHaveCount(0);expect(errors).toEqual([]);
});

test('lost save acknowledgement freezes the draft and retries identical UUID and payload without duplicate wages',async({page})=>{
 const errors=await boot(page);await open(page);await fill(page);await page.evaluate(()=>{__countServer.lost=true});await submit(page);await expect(page.locator('#cashCountRetryV37')).toBeVisible();
 await expect(page.locator('#cashCountAmountV37')).toBeDisabled();await expect(page.locator('#cashCountSalaryV37')).toBeDisabled();
 await page.evaluate(()=>{document.getElementById('cashCountAmountV37').value='999';document.getElementById('cashCountSalaryV37').value='false'});await page.click('#cashCountRetryV37');
 await expect.poll(()=>saves(page)).toHaveLength(2);const calls=await saves(page);expect(calls[1].args).toEqual(calls[0].args);expect(await page.evaluate(()=>__countEffects)).toHaveLength(1);expect(await page.evaluate(()=>__countPayouts)).toHaveLength(2);expect(errors).toEqual([]);
});

test('a stale token refreshes the cash snapshot but preserves the amount, salary answer and explanation',async({page})=>{
 const errors=await boot(page,{response:saved({difference:200,reason:'Пересчёт после изменения'})});await open(page);await fill(page,{amount:'32100',reason:'Пересчёт после изменения'});
 await page.evaluate(()=>{__countServer.reject={code:'P0001',message:'Касса изменилась. Обновите сверку.'};__countServer.refresh=JSON.parse(JSON.stringify(__countServer.drawer));__countServer.refresh.reconciliation_v37.token='ledger-new';});
 await submit(page);await expect(page.locator('#cashCountAmountV37')).toBeEnabled();await expect(page.locator('#cashCountAmountV37')).toHaveValue('32100');await expect(page.locator('#cashCountSalaryV37')).toHaveValue('true');await expect(page.locator('#cashCountReasonV37')).toHaveValue('Пересчёт после изменения');
 await expect.poll(()=>page.evaluate(()=>__countCalls.filter(call=>call.name==='crm_cash_reconciliation_v37'&&call.args.p_action==='status').length)).toBeGreaterThan(1);
 await submit(page);await expect.poll(()=>saves(page)).toHaveLength(2);const calls=await saves(page);expect(calls[0].args.p_payload.expected_token).toBe('ledger-a');expect(calls[1].args.p_payload.expected_token).toBe('ledger-new');expect(calls[1].args.p_request_id).not.toBe(calls[0].args.p_request_id);expect(await page.evaluate(()=>__countEffects)).toHaveLength(1);expect(errors).toEqual([]);
});

test('manual calculation reload preserves the entered count, salary answer, opening and comment',async({page})=>{
 const reason='  Пересчитано вручную; комментарий ещё не сохранён  ';
 const errors=await boot(page,{initial:drawer({opening:false})});await open(page);
 await fill(page,{amount:'35910,25',salary:'false',opening:'10,25',reason});
 await page.evaluate(()=>{__countServer.drawer.received_cash=36000;__countServer.drawer.reconciliation_v37.token='ledger-reloaded'});
 await page.click('#cashCountReloadV37');
 await expect.poll(()=>page.evaluate(()=>__countCalls.filter(call=>call.name==='crm_cash_reconciliation_v37'&&call.args.p_action==='status').length)).toBe(2);
 await expect(page.locator('#cashCountAmountV37')).toHaveValue('35910,25');await expect(page.locator('#cashCountSalaryV37')).toHaveValue('false');
 await expect(page.locator('#cashCountOpeningV37')).toHaveValue('10,25');await expect(page.locator('#cashCountReasonV37')).toHaveValue(reason);
 await expect(page.locator('#cashCountPreviewV37')).toContainText(/36\s*010,25/);await expect(page.locator('#cashCountSaveV37')).toBeEnabled();
 expect(await saves(page)).toEqual([]);expect(await closes(page)).toEqual([]);expect(await page.evaluate(()=>__countEffects)).toEqual([]);expect(await page.evaluate(()=>__countPayouts)).toEqual([]);expect(errors).toEqual([]);
});

test('a definitive server rejection preserves the draft and allows correcting it under a new request UUID',async({page})=>{
 const reason='Пересчитано дважды до отказа',corrected='Уточнили фактические наличные';
 const errors=await boot(page,{initial:drawer({opening:false}),response:saved({paid:false,reason:corrected})});await open(page);
 await fill(page,{amount:'32100',salary:'true',opening:'0,00',reason});
 await page.evaluate(()=>{__countServer.reject={code:'P0001',message:'Проверьте комментарий к сверке'}});await submit(page);
 await expect(page.locator('#cashCountMessageV37')).toContainText('Проверьте комментарий');await expect(page.locator('#cashCountRetryV37')).toHaveCount(0);
 for(const id of ['cashCountAmountV37','cashCountSalaryV37','cashCountOpeningV37','cashCountReasonV37','cashCountSaveV37'])await expect(page.locator('#'+id)).toBeEnabled();
 await expect(page.locator('#cashCountAmountV37')).toHaveValue('32100');await expect(page.locator('#cashCountSalaryV37')).toHaveValue('true');
 await expect(page.locator('#cashCountOpeningV37')).toHaveValue('0,00');await expect(page.locator('#cashCountReasonV37')).toHaveValue(reason);
 expect(await page.evaluate(()=>__countEffects)).toEqual([]);expect(await page.evaluate(()=>__countPayouts)).toEqual([]);
 await fill(page,{amount:'35900',salary:'false',reason:corrected});await submit(page);
 await expect(page.locator('#cashCountMessageV37')).toContainText('Сверка сохранена');const calls=await saves(page);expect(calls).toHaveLength(2);
 expect(calls[1].args.p_request_id).not.toBe(calls[0].args.p_request_id);expect(calls[1].args.p_payload).toMatchObject({opening_amount:0,counted_cash:35900,salary_confirmed:false,reason:corrected,expected_token:'ledger-a'});
 expect(await page.evaluate(()=>__countEffects)).toHaveLength(1);expect(await page.evaluate(()=>__countPayouts)).toEqual([]);expect(await closes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('concurrent submit cannot create a second count or salary payment',async({page})=>{
 const errors=await boot(page);await open(page);await fill(page);await page.evaluate(()=>{__countServer.hold=true;document.getElementById('cashCountSaveV37').click();document.getElementById('cashCountSaveV37').click()});
 await expect(page.locator('#cashCountSaveV37')).toBeDisabled();expect(await saves(page)).toHaveLength(1);await page.evaluate(()=>__releaseCount());await expect(page.locator('#cashCountSaveV37')).toBeEnabled();expect(await page.evaluate(()=>__countEffects)).toHaveLength(1);expect(await page.evaluate(()=>__countPayouts)).toHaveLength(2);expect(errors).toEqual([]);
});

test('a late save response after sign out cannot reopen the cash form or close a shift',async({page})=>{
 const errors=await boot(page);await open(page,true);await fill(page);await page.evaluate(()=>{__countServer.hold=true});await submit(page);await expect(page.locator('#cashCountSaveV37')).toBeDisabled();
 await page.evaluate(async()=>{await signOut();__releaseCount()});await expect(page.locator('#login')).toBeVisible();await expect(page.locator('#cashReconciliationV37')).toHaveCount(0);expect(await closes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('closing an unreconciled shift opens the count form; successful count reloads its real report before close',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>closeShift());await expect(page.locator('#cashReconciliationV37')).toBeVisible();expect(await closes(page)).toEqual([]);
 await fill(page);await submit(page);await expect.poll(()=>closes(page)).toHaveLength(1);await expect(page.locator('#report')).toBeVisible();expect(await page.evaluate(()=>shift)).toBeNull();
 const calls=await page.evaluate(()=>__countCalls);const saveIndex=calls.findIndex(call=>call.name==='crm_cash_reconciliation_v37'&&call.args.p_action==='save');const closeIndex=calls.findIndex(call=>call.name==='crm_finance_v5'&&call.args.p_action==='close');
 expect(calls.slice(saveIndex+1,closeIndex).some(call=>call.name==='crm_finance_v5'&&call.args.p_action==='shift_report'&&call.args.p_payload.shift_id==='count-shift')).toBe(true);expect(errors).toEqual([]);
});

test('server rejection of a stale close leaves the shift open and does not report a false completion',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__countServer.closeError={code:'P0001',message:'После сверки касса изменилась. Повторите сверку.'}});await open(page,true);await fill(page);await submit(page);
 await expect.poll(()=>closes(page)).toHaveLength(1);expect(await page.evaluate(()=>shift?.id)).toBe('count-shift');await expect(page.locator('#cashCountMessageV37')).toContainText('Повторите сверку');expect(await page.evaluate(()=>__countServer.drawer.shift_status)).toBe('open');expect(errors).toEqual([]);
});

test('a closed nurse can view stale reconciliation and history but cannot record another count; print stays read only',async({page})=>{
 const data=saved({status:'closed',difference:200,reason:'Уточнить излишек <img src=x>'});data.reconciliation_v37.stale=true;data.reconciliation_v37.can_close=false;data.reconciliation_v37.token='ledger-new';
 const errors=await boot(page,{initial:data});await open(page);await expect(page.locator('#cashReconciliationV37')).toContainText(/(?:измен|устар)/i);await expect(page.locator('#cashReconciliationV37')).toContainText('Уточнить излишек <img src=x>');await expect(page.locator('#cashCountSaveV37')).toHaveCount(0);await expect(page.locator('#cashReconciliationV37 img')).toHaveCount(0);
 await page.click('#cashCountBackV37');await expect(page.locator('#report')).toBeVisible();await page.click('#reportPrintV5');await page.emulateMedia({media:'print'});
 const printed=page.locator('#shiftPrintV5');await expect(printed).toContainText(/32\s*100/);await expect(printed).toContainText(/31\s*900/);await expect(printed).toContainText(/200/);await expect(printed.locator('input,select,button,img,script')).toHaveCount(0);expect(await saves(page)).toEqual([]);expect(await closes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('CSV exports physical counted and expected cash with the difference and a formula-safe quoted comment',async({page})=>{
 const reason='=SUM(1;2) "Пересчитано наличными"',data=saved({paid:false,difference:-200,reason,status:'closed'});
 data.reconciliation_v37.count.counted_cash=35700;
 const errors=await boot(page,{role:'admin',initial:data});
 const csv=await page.evaluate(()=>buildFinanceCsvV5(__countReport()));
 expect(csv).toContain('"Фактически пересчитано наличными";"35700"');
 expect(csv).toContain('"Ожидаемый фактический остаток на момент сверки";"35900"');
 expect(csv).not.toContain('"Ожидаемый фактический остаток на момент сверки";"31900"');
 expect(csv).toContain('"Расхождение: излишек (+) / недостача (−)";"\'-200"');
 expect(csv).toContain('"Зарплата подтверждена как выданная полностью";"Нет / не полностью"');
 expect(csv).toContain('"Комментарий к сверке";"\'=SUM(1;2) ""Пересчитано наличными"""');
 expect(await saves(page)).toEqual([]);expect(await closes(page)).toEqual([]);expect(await page.evaluate(()=>__countEffects)).toEqual([]);expect(await page.evaluate(()=>__countPayouts)).toEqual([]);expect(errors).toEqual([]);
});
