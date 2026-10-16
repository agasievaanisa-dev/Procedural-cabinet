const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

const nurseName='Патя <img src=x onerror="window.x=1">';
const morning={id:'history-morning',shift_date:'2026-10-16',started_at:'2026-10-16T05:30:00Z',planned_end_at:'2026-10-16T13:00:00Z',ended_at:'2026-10-16T13:00:00Z',status:'closed',staff:[{id:'nurse-1',full_name:'Марьям'},{id:'nurse-2',full_name:nurseName}],payroll_total:4000,payroll_complete:true};
const evening={id:'history-evening',shift_date:'2026-10-16',started_at:'2026-10-16T13:00:00Z',planned_end_at:'2026-10-16T20:00:00Z',ended_at:null,status:'open',staff:[{id:'nurse-1',full_name:'Марьям'},{id:'nurse-2',full_name:nurseName}],payroll_total:4000,payroll_complete:true};
function summary(shifts=[morning,evening]){return {from:'2026-10-16',to:'2026-10-16',time_zone:'Europe/Moscow',group_by:'day',patients_count:14,procedures_count:14,sales_count:0,revenue:{cash:35900,terminal:5400,owner_card:500,total:41800},payroll_total:4000,payroll_complete:true,rows:[],shifts};}
function report(){return {shift:{...morning,date:morning.shift_date},staff:morning.staff.map(person=>({...person,amount:2000})),patients_count:14,procedures_count:14,sales_count:0,revenue:{cash:35900,terminal:5400,owner_card:500,total:41800},loan_debt_total:9100,pending_total:0,payroll_total:4000,payroll_complete:true,procedures:[],sales:[],receipts:[],stock:[],used:[],warnings:[],cash_drawer:{opening_confirmed:true,opening:0,received_cash:35900,salary_paid:4000,cash_in:0,cash_out:0,balance:31900}};}
function markedSummary(id,name){return summary([{...morning,id,staff:[{id:'nurse-1',full_name:name}]}]);}

async function boot(page,{role='owner',active=true,data=summary()}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-16T15:00:00Z'));
 // Every service response is local. Abort external requests even if a future
 // application change accidentally attempts to use a production endpoint.
 const origin=new URL(base).origin;
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(({role,active,data,morning,evening,report})=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  window.__historyCalls=[];window.__historyUnexpected=[];window.__historyShiftActions=[];
  window.__historyServer={summary:data,report,responses:[]};
  window.__historyActive={id:evening.id,aId:'nurse-1',bId:'nurse-2',a:'Марьям',b:evening.staff[1].full_name,type:'16:00–23:00'};
  window.__historyLogin=(role='owner',active=true)=>{
   currentStaff={id:role==='nurse'?'nurse-1':'history-manager',full_name:'Аниса',role,active};
   nurses=clone(morning.staff).map(person=>({...person,role:'nurse',active:true}));
   shift=clone(__historyActive);inventory=[];meds=[];patients=[];
   quickContext={favorites:[],recent:[],shifts:[clone(evening)]};
   document.getElementById('homeNav').classList.remove('hidden');
   document.getElementById('accountMenu').classList.remove('hidden');
   show('workspace');
  };
  db.rpc=async(name,args={})=>{
   __historyCalls.push({name,args:clone(args)});
   if(name==='crm_finance_v5'&&args.p_action==='summary'){
    const response=__historyServer.responses.shift()||{data:__historyServer.summary};
    const snapshot=clone(response);
    if(snapshot.hold)await new Promise(resolve=>{window.__historyRelease=resolve});
    if(snapshot.network)throw new TypeError('Load failed');
    if(snapshot.error)return {error:snapshot.error,status:400};
    return {data:snapshot.data,error:null};
   }
   if(name==='crm_finance_v5'&&args.p_action==='shift_report'){
    if(__historyServer.reportError)return {error:clone(__historyServer.reportError),status:400};
    return {data:clone(__historyServer.report),error:null};
   }
   __historyUnexpected.push({name,args:clone(args)});
   throw Error('Unexpected history RPC '+name+' '+args.p_action);
  };
  db.from=table=>{__historyUnexpected.push({table});throw Error('Unexpected history table access '+table)};
  for(const name of ['assignShift','startShift','closeShift']){
   const original=window[name];window[name]=function(...args){__historyShiftActions.push({name,args:clone(args)});return original.apply(this,args)};
  }
  loadQuickContext=async()=>{};refreshDashboard=async()=>{};refreshOwnerDashboardV5=async()=>{};
  __historyLogin(role,active);
 },{role,active,data,morning,evening,report:report()});
 return errors;
}
const summaryCalls=page=>page.evaluate(()=>__historyCalls.filter(call=>call.name==='crm_finance_v5'&&call.args.p_action==='summary'));
async function open(page){await page.evaluate(()=>openShiftHistoryV38());await expect(page.locator('#shiftHistoryV38')).toBeVisible();}
async function expectReadOnly(page){
 expect(await page.evaluate(()=>__historyUnexpected)).toEqual([]);
 expect(await page.evaluate(()=>__historyShiftActions)).toEqual([]);
 const calls=await page.evaluate(()=>__historyCalls);
 expect(calls.every(call=>call.name==='crm_finance_v5'&&['summary','shift_report'].includes(call.args.p_action))).toBe(true);
}
async function deferNextSummary(page,data){
 await page.evaluate(data=>{__historyServer.responses.push({data,hold:true});window.__historyPending=loadShiftHistoryV38()},data);
 await page.waitForFunction(()=>typeof __historyRelease==='function');
}
async function releaseSummary(page){await page.evaluate(async()=>{const release=__historyRelease;delete window.__historyRelease;release();await __historyPending});}

for(const role of ['owner','admin'])test(`${role} can open past shifts from both the home screen and the account menu`,async({page})=>{
 const errors=await boot(page,{role});
 await expect(page.locator('#shiftHistoryHomeV38')).toBeVisible();await expect(page.locator('#shiftHistoryHomeV38 strong')).toHaveText('Прошлые смены');
 await page.locator('#shiftHistoryHomeV38').click();await expect(page.locator('#shiftHistoryV38')).toBeVisible();await expect(page.locator('#shiftHistoryListV38 article')).toHaveCount(2);
 await page.locator('#homeNav').click();await page.locator('#accountMenu > summary').click();
 await expect(page.locator('#shiftHistoryMenuV38')).toBeVisible();await expect(page.locator('#shiftHistoryMenuV38')).toHaveText('Прошлые смены');
 await page.locator('#shiftHistoryMenuV38').click();await expect(page.locator('#shiftHistoryV38')).toBeVisible();
 expect((await summaryCalls(page)).length).toBeGreaterThanOrEqual(2);await expectReadOnly(page);expect(errors).toEqual([]);
});

test('nurse has no history controls and direct entry never asks for manager financial summaries',async({page})=>{
 const errors=await boot(page,{role:'nurse'});
 await expect(page.locator('#shiftHistoryHomeV38')).toHaveCount(0);await expect(page.locator('#shiftHistoryMenuV38')).toHaveCount(0);
 await page.evaluate(async()=>{await openShiftHistoryV38();await loadShiftHistoryV38()});
 await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#shiftHistoryV38')).not.toBeVisible();
 expect(await summaryCalls(page)).toEqual([]);await expectReadOnly(page);expect(errors).toEqual([]);
});

test('inactive manager cannot enter history through its public entry function',async({page})=>{
 const errors=await boot(page,{role:'admin',active:false});await page.evaluate(()=>openShiftHistoryV38());
 await expect(page.locator('#shiftHistoryV38')).not.toBeVisible();expect(await summaryCalls(page)).toEqual([]);await expectReadOnly(page);expect(errors).toEqual([]);
});

test('history starts with the current Moscow day and opens the closed morning report without replacing the active evening shift',async({page})=>{
 const errors=await boot(page);await open(page);
 await expect(page.locator('#shiftHistoryFromV38')).toHaveValue('2026-10-16');await expect(page.locator('#shiftHistoryToV38')).toHaveValue('2026-10-16');
 expect((await summaryCalls(page))[0].args.p_payload).toEqual({from:'2026-10-16',to:'2026-10-16',group_by:'day'});
 const closed=page.locator('#shiftHistoryListV38 article[data-shift-id="history-morning"]');
 await expect(closed).toContainText('Закрыта');await expect(closed).toContainText('08:30');await expect(closed).toContainText('16:00');await expect(closed).toContainText('Марьям');
 await expect(page.locator('#shiftHistoryListV38 article[data-shift-id="history-evening"]')).toContainText('Открыта');
 await closed.getByRole('button',{name:'Открыть отчёт',exact:true}).click();await expect(page.locator('#report')).toBeVisible();
 const reports=await page.evaluate(()=>__historyCalls.filter(call=>call.args.p_action==='shift_report'));
 expect(reports).toHaveLength(1);expect(reports[0].args.p_payload).toEqual({shift_id:'history-morning'});
 expect(await page.evaluate(()=>shift)).toEqual(await page.evaluate(()=>__historyActive));
 await expect(page.locator('#report button[onclick="closeShift()"]')).toBeHidden();await expectReadOnly(page);expect(errors).toEqual([]);
});

test('date range and nurse filters use the summary read API and clearing the nurse omits employee_id',async({page})=>{
 const errors=await boot(page);await open(page);
 await page.evaluate(async()=>{document.getElementById('shiftHistoryFromV38').value='2026-10-01';document.getElementById('shiftHistoryToV38').value='2026-10-15';await loadShiftHistoryV38()});
 expect((await summaryCalls(page)).at(-1).args.p_payload).toEqual({from:'2026-10-01',to:'2026-10-15',group_by:'day'});
 await page.selectOption('#shiftHistoryNurseV38','nurse-2');
 await expect.poll(async()=>(await summaryCalls(page)).at(-1).args.p_payload).toEqual({from:'2026-10-01',to:'2026-10-15',group_by:'day',employee_id:'nurse-2'});
 await page.selectOption('#shiftHistoryNurseV38','');
 await expect.poll(async()=>(await summaryCalls(page)).at(-1).args.p_payload).toEqual({from:'2026-10-01',to:'2026-10-15',group_by:'day'});
 await expectReadOnly(page);expect(errors).toEqual([]);
});

test('a failed report read leaves its history row usable so the same report can be opened again',async({page})=>{
 const errors=await boot(page);await open(page);
 const button=page.locator('#shiftHistoryListV38 article[data-shift-id="history-morning"]').getByRole('button',{name:'Открыть отчёт',exact:true});
 await page.evaluate(()=>{__historyServer.reportError={code:'P0001',message:'Отчёт недоступен'}});await button.click();
 await expect(page.locator('#shiftHistoryV38')).toBeVisible();await expect(page.locator('#shiftHistoryMessageV38')).toContainText('Отчёт не загрузился. Попробуйте открыть его ещё раз.');
 expect(await page.evaluate(()=>shift)).toEqual(await page.evaluate(()=>__historyActive));
 await page.evaluate(()=>{__historyServer.reportError=null});await button.click();await expect(page.locator('#report')).toBeVisible();
 const calls=await page.evaluate(()=>__historyCalls.filter(call=>call.args.p_action==='shift_report'));
 expect(calls).toHaveLength(2);expect(calls[0].args.p_payload).toEqual({shift_id:'history-morning'});expect(calls[1].args).toEqual(calls[0].args);
 expect(await page.evaluate(()=>shift)).toEqual(await page.evaluate(()=>__historyActive));await expectReadOnly(page);expect(errors).toEqual([]);
});

test('invalid date ranges show validation without requesting a financial summary',async({page})=>{
 const errors=await boot(page);await open(page);const before=(await summaryCalls(page)).length;
 for(const [from,to] of [['2026-10-17','2026-10-16'],['','2026-10-16']]){
  await page.evaluate(async({from,to})=>{document.getElementById('shiftHistoryFromV38').value=from;document.getElementById('shiftHistoryToV38').value=to;await loadShiftHistoryV38()},{from,to});
  await expect(page.locator('#shiftHistoryMessageV38')).toContainText(/период|дат/i);
 }
 expect(await summaryCalls(page)).toHaveLength(before);await expectReadOnly(page);expect(errors).toEqual([]);
});

test('a late response from previous filters cannot replace the new nurse results',async({page})=>{
 const errors=await boot(page);await open(page);await deferNextSummary(page,markedSummary('obsolete-filter','Устаревший фильтр'));
 await page.evaluate(data=>{__historyServer.summary=data},markedSummary('latest-filter','Актуальный фильтр'));
 await page.selectOption('#shiftHistoryNurseV38','nurse-2');
 await expect(page.locator('#shiftHistoryListV38')).toContainText('Актуальный фильтр');await releaseSummary(page);
 await expect(page.locator('#shiftHistoryListV38')).toContainText('Актуальный фильтр');await expect(page.locator('#shiftHistoryListV38')).not.toContainText('Устаревший фильтр');
 await expect(page.locator('#shiftHistoryNurseV38')).toHaveValue('nurse-2');await expectReadOnly(page);expect(errors).toEqual([]);
});

test('leaving history while a read is pending prevents its late response from reopening the screen',async({page})=>{
 const errors=await boot(page);await open(page);await deferNextSummary(page,markedSummary('obsolete-navigation','Ответ после ухода'));
 await page.locator('#homeNav').click();await releaseSummary(page);
 await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#shiftHistoryV38')).not.toBeVisible();await expect(page.locator('#shiftHistoryListV38')).not.toContainText('Ответ после ухода');
 await expectReadOnly(page);expect(errors).toEqual([]);
});

for(const change of ['different manager','nurse role'])test(`a pending manager read cannot render after switching to a ${change}`,async({page})=>{
 const errors=await boot(page);await open(page);await deferNextSummary(page,markedSummary('obsolete-actor','Данные прежнего сотрудника'));
 await page.evaluate(change=>{currentStaff={id:change==='different manager'?'other-manager':'history-manager',full_name:'Другой сотрудник',role:change==='different manager'?'admin':'nurse',active:true};show('workspace')},change);
 await releaseSummary(page);await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#shiftHistoryV38')).not.toBeVisible();
 await expect(page.locator('body')).not.toContainText('Данные прежнего сотрудника');
 if(change==='nurse role'){await expect(page.locator('#shiftHistoryHomeV38')).toHaveCount(0);await expect(page.locator('#shiftHistoryMenuV38')).toHaveCount(0)}
 await expectReadOnly(page);expect(errors).toEqual([]);
});

test('signing out clears history and a late response cannot expose it to the next nurse session',async({page})=>{
 const errors=await boot(page);await open(page);await deferNextSummary(page,markedSummary('obsolete-session','Данные завершённого сеанса'));
 await page.evaluate(async()=>{await signOut()});await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(()=>__historyLogin('nurse'));await releaseSummary(page);
 await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#shiftHistoryV38')).not.toBeVisible();
 await expect(page.locator('#shiftHistoryHomeV38')).toHaveCount(0);await expect(page.locator('#shiftHistoryMenuV38')).toHaveCount(0);
 await expect(page.locator('body')).not.toContainText('Данные завершённого сеанса');await expectReadOnly(page);expect(errors).toEqual([]);
});

test('staff names remain escaped in rows and nurse choices, and history fits a narrow phone',async({page})=>{
 await page.setViewportSize({width:375,height:812});const errors=await boot(page);await open(page);
 await expect(page.locator('#shiftHistoryListV38')).toContainText(nurseName);await expect(page.locator('#shiftHistoryNurseV38 option[value="nurse-2"]')).toHaveText(nurseName);
 await expect(page.locator('#shiftHistoryV38 img,#shiftHistoryV38 script')).toHaveCount(0);expect(await page.evaluate(()=>window.x)).toBeUndefined();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expectReadOnly(page);expect(errors).toEqual([]);
});

test('an empty period gives a readable empty state and does not open a report or write records',async({page})=>{
 const errors=await boot(page,{data:summary([])});await open(page);
 await expect(page.locator('#shiftHistoryListV38 article')).toHaveCount(0);await expect(page.locator('#shiftHistoryListV38')).toContainText(/смен.*(?:нет|найден)|(?:нет|найден).*смен/i);
 await expect(page.locator('#shiftHistoryListV38').getByRole('button',{name:'Открыть отчёт',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>__historyCalls.filter(call=>call.args.p_action==='shift_report'))).toEqual([]);await expectReadOnly(page);expect(errors).toEqual([]);
});

test('a server error clears old rows and retry reloads the same period without financial writes',async({page})=>{
 const errors=await boot(page);await open(page);
 await page.evaluate(async()=>{__historyServer.responses.push({error:{code:'P0001',message:'История временно недоступна'}});await loadShiftHistoryV38()});
 await expect(page.locator('#shiftHistoryMessageV38')).toContainText('История временно недоступна');await expect(page.locator('#shiftHistoryListV38 article')).toHaveCount(0);await expect(page.locator('#shiftHistoryRetryV38')).toBeVisible();
 const failed=(await summaryCalls(page)).at(-1);await page.locator('#shiftHistoryRetryV38').click();
 await expect(page.locator('#shiftHistoryListV38 article')).toHaveCount(2);expect((await summaryCalls(page)).at(-1).args).toEqual(failed.args);
 await expectReadOnly(page);expect(errors).toEqual([]);
});

test('transport failure recovers through the existing read retry without duplicating any writes',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__historyServer.responses.push({network:true})});await open(page);
 await expect(page.locator('#shiftHistoryListV38 article')).toHaveCount(2);const calls=await summaryCalls(page);expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);
 await expectReadOnly(page);expect(errors).toEqual([]);
});
