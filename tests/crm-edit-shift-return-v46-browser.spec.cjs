const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Persist clinical edits independently of report reads. All identities are
// fictional; the current open shift deliberately differs from the source.
async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-18T07:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  const actor={id:role==='nurse'?'nurse-test':role+'-test',full_name:'Сотрудник Проверки',role,active:true};
  const staff=[{id:'nurse-test',full_name:'Тестовая Медсестра'},{id:'nurse-second',full_name:'Вторая Медсестра'}];
  const opened={id:'current-shift',date:'2026-10-18',started_at:'2026-10-18T05:30:00Z',planned_end_at:'2026-10-18T13:00:00Z',status:'open',staff};
  const previous={id:'previous-shift',date:'2026-10-17',started_at:'2026-10-17T05:30:00Z',planned_end_at:'2026-10-17T13:00:00Z',ended_at:'2026-10-17T13:00:00Z',status:'closed',staff};
  patients=[{id:'patient-first',full_name:'Первый Пациент',sex:'male'},{id:'patient-second',full_name:'Второй Пациент',sex:'male'}];nurses=staff;
  meds=[{id:'medicine-procedure',name:'Препарат процедуры',consumption_unit:'амп.',sale_price:1500,work_qty:0,active:true},{id:'medicine-sale',name:'Препарат продажи',consumption_unit:'фл.',sale_price:1900,work_qty:0,active:true}];
  services=[{id:'service-test',name:'Капельница',work_price:500,consumables_price:100,active:true}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:0,units_per_package:5,purchase_price:0,active:true}));
  window.__returnCalls=[];window.__returnWrites=[];window.__returnReplay=new Map();window.__returnRecords=new Map();window.__returnWriteError=false;window.__returnLost=false;window.__returnDeferred=false;window.__returnFailReport=0;
  const seed={id:'previous-procedure',kind:'procedure',editable:true,version:3,shift_id:'previous-shift',patient_id:'patient-first',patient:'Первый Пациент',nurse_id:'nurse-test',nurse:'Тестовая Медсестра',service_id:'service-test',procedure_type:'Капельница',arrival_at:'2026-10-17T06:00:00Z',visit_at:'2026-10-17T06:00:00Z',at:'2026-10-17T06:00:00Z',list_total:1600,charge_total:1600,paid_total:1600,received_total:1600,initial_paid_total:1600,debt_total:0,payment_pending:false,payment_status:'paid',stock_deducted:false,services:[{service_id:'service-test',name:'Капельница',quantity:1,unit_price:600,work_price:500,consumables_price:100,line_total:600}],items:[{medication_id:'medicine-procedure',name:'Препарат процедуры',quantity:1,unit:'амп.',unit_price:1000,line_total:1000}],own_medications:[],payments:{cash:0,terminal:1600,owner_card:0},notes:'Исходная процедура'};
  __returnRecords.set(seed.id,clone(seed));__returnRecords.set('previous-sale',{...clone(seed),id:'previous-sale',kind:'sale',patient_id:'patient-second',patient:'Второй Пациент',service_id:null,procedure_type:null,services:[],items:[{medication_id:'medicine-sale',name:'Препарат продажи',quantity:1,unit:'фл.',unit_price:1600,line_total:1600}],payments:{cash:0,terminal:0,owner_card:1600},notes:'Исходная продажа'});
  function report(id){
   const records=[...__returnRecords.values()].filter(item=>item.shift_id===id),procedures=records.filter(item=>item.kind==='procedure'),sales=records.filter(item=>item.kind==='sale');
   const revenue={cash:0,terminal:0,owner_card:0,total:0};records.forEach(item=>{for(const method of ['cash','terminal','owner_card'])revenue[method]+=item.payments?.[method]||0});revenue.total=revenue.cash+revenue.terminal+revenue.owner_card;
   return {shift:clone(id==='previous-shift'?previous:opened),staff:staff.map(person=>({...person,amount:0})),procedures:clone(procedures),sales:clone(sales),receipts:[],patients_count:new Set(records.map(item=>item.patient_id)).size,procedures_count:procedures.length,sales_count:sales.length,revenue,charge_total:records.reduce((sum,item)=>sum+item.charge_total,0),debt_total:0,loan_debt_total:0,pending_total:0,payroll_total:0,payroll_complete:true,payroll_unknown:0,cash_drawer:{opening_confirmed:true,opening:0,received_cash:revenue.cash,salary_paid:0,balance:revenue.cash},used:[],stock:[],untracked:[],warnings:[]};
  }
  db.from=()=>{const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:actor})};return q};
  db.rpc=async(name,args={})=>{
   __returnCalls.push({name,args:clone(args)});
   if(name==='crm_clinical_v10'){
    if(args.p_action==='treatment_get')return {data:clone(__returnRecords.get(args.p_payload.id))};
    if(args.p_action==='patient_treatments')return {data:{procedures:[],sales:[]}};
    if(args.p_action==='treatment_edit'){
     if(__returnReplay.has(args.p_request_id))return {data:clone(__returnReplay.get(args.p_request_id))};
     if(__returnWriteError){__returnWriteError=false;return {error:{code:'P0001',message:'Сохранение отклонено: проверьте изменение'}}}
     const p=args.p_payload,record=__returnRecords.get(p.id);if(p.expected_version!==record.version)return {error:{code:'40001',message:'Запись уже изменена'}};
     const result={...record,notes:p.notes,version:record.version+1};__returnRecords.set(p.id,result);__returnReplay.set(args.p_request_id,clone(result));__returnWrites.push({name,args:clone(args)});
     if(__returnDeferred)await new Promise(resolve=>{window.__returnRelease=resolve});
     if(__returnLost){__returnLost=false;throw new TypeError('Load failed')}
     return {data:clone(result)};
    }
    return {data:[]};
   }
   if(name==='crm_finance_v5'){
    if(args.p_action==='accounting_mode')return {data:{payment_only:true,stock_deducted:false}};
    if(args.p_action==='shift_report'){
     if(__returnFailReport>0){__returnFailReport--;return {error:{code:'P0001',message:'Не удалось обновить отчёт: временная ошибка чтения'}}}
     return {data:report(args.p_payload.shift_id)};
    }
    return {data:report('current-shift')};
   }
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[report(args.p_date==='2026-10-17'?'previous-shift':'current-shift')]}};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};if(name.includes('warehouse'))return {data:inventory};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};
   if(name==='crm_dashboard_day_v25')return {data:{date:'2026-10-18',working_day:{revenue:{cash:0,terminal:0,owner_card:0,total:0}},receipts_day:{revenue:{cash:0,terminal:0,owner_card:0,total:0}}}};
   return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'auth-test'});shift={id:'current-shift',aId:'nurse-test',a:'Тестовая Медсестра',bId:'nurse-second',b:'Вторая Медсестра',type:'08:30–16:00'};show('workspace');
 },role);
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
const writes=page=>page.evaluate(()=>__returnWrites);
const editCalls=page=>page.evaluate(()=>__returnCalls.filter(call=>call.name==='crm_clinical_v10'&&call.args.p_action==='treatment_edit'));
const reportReads=page=>page.evaluate(()=>__returnCalls.filter(call=>call.name==='crm_finance_v5'&&call.args.p_action==='shift_report').map(call=>call.args.p_payload.shift_id));
async function sourceReport(page){await page.evaluate(()=>openReportByIdV5('previous-shift'));await expect(page.locator('#report')).toBeVisible();await expandReport(page)}
async function expandReport(page){await page.evaluate(()=>document.querySelectorAll('#reportBody details').forEach(node=>node.open=true))}
async function editFromReport(page,kind='procedure',note='Уточнённый состав записи'){
 await expandReport(page);const id=kind==='sale'?'previous-sale':'previous-procedure';
 await page.locator('#reportBody [data-event-id="'+id+'"]').getByRole('button',{name:'Редактировать',exact:true}).click();await expect(page.locator('#'+kind)).toBeVisible();
 const prefix=kind==='sale'?'sale':'proc';await page.fill('#'+prefix+'Notes',note);await page.fill('#'+prefix+'EditReasonV10','Уточнены данные сохранённой записи');return prefix;
}
async function save(page,prefix){await page.check('#'+prefix+'PayConfirmed');await page.locator('#'+(prefix==='proc'?'procedure':'sale')+' button[onclick="'+(prefix==='proc'?'saveProcedure()':'saveSale()')+'"]').click()}

for(const role of ['owner','admin'])for(const kind of ['procedure','sale'])test(`${role}: editing a historical ${kind} returns to that same closed shift rather than the current workspace`,async({page})=>{
 const errors=await boot(page,role);await sourceReport(page);const prefix=await editFromReport(page,kind,'Изменение в прошлой смене');await save(page,prefix);
 await expect(page.locator('#report')).toBeVisible();await expect(page.locator('#reportBody [data-event-id="'+(kind==='sale'?'previous-sale':'previous-procedure')+'"]').getByRole('button',{name:'Редактировать',exact:true})).toBeVisible();await expect(page.locator('#reportBody')).toContainText('17.10.2026');await expect(page.locator('#reportBody')).toContainText('Изменение в прошлой смене');await expect(page.locator('#workspace')).not.toBeVisible();
 expect((await reportReads(page)).at(-1)).toBe('previous-shift');expect(await writes(page)).toHaveLength(1);expect((await writes(page))[0].args.p_payload).toMatchObject({shift_id:'previous-shift',paid_total:0,charge_total:1600,payments:{cash:0,terminal:0,owner_card:0,cash_received:0}});expect(errors).toEqual([]);
});

test('successive edits from one historical report retain the source shift and saved versions',async({page})=>{
 const errors=await boot(page);await sourceReport(page);await save(page,await editFromReport(page,'procedure','Первая правка'));await expect(page.locator('#report')).toBeVisible();
 await save(page,await editFromReport(page,'sale','Вторая правка'));await expect(page.locator('#report')).toBeVisible();await expandReport(page);await expect(page.locator('#reportBody')).toContainText('Первая правка');await expect(page.locator('#reportBody')).toContainText('Вторая правка');
 await save(page,await editFromReport(page,'procedure','Третья правка'));await expect(page.locator('#report')).toBeVisible();const saved=await writes(page);expect(saved).toHaveLength(3);expect(saved.map(call=>call.args.p_payload.expected_version)).toEqual([3,3,4]);expect((await reportReads(page)).slice(-3)).toEqual(['previous-shift','previous-shift','previous-shift']);expect(errors).toEqual([]);
});

test('a failed clinical write keeps the edited draft and returns to its original report only after a successful retry',async({page})=>{
 const errors=await boot(page);await sourceReport(page);const prefix=await editFromReport(page,'procedure','Правка, которую нужно сохранить');await page.evaluate(()=>{__returnWriteError=true});await save(page,prefix);
 await expect(page.locator('#procedure')).toBeVisible();await expect(page.locator('#procedureMessage')).toContainText('Сохранение отклонено');await expect(page.locator('#procNotes')).toHaveValue('Правка, которую нужно сохранить');expect(await writes(page)).toHaveLength(0);expect(await reportReads(page)).toEqual(['previous-shift']);
 await save(page,prefix);await expect(page.locator('#report')).toBeVisible();expect(await writes(page)).toHaveLength(1);expect((await reportReads(page)).at(-1)).toBe('previous-shift');expect(errors).toEqual([]);
});

test('an uncertain clinical save replays once and still returns to the source historical report',async({page})=>{
 const errors=await boot(page);await sourceReport(page);const prefix=await editFromReport(page,'sale','Подтверждение первоначальной правки');await page.evaluate(()=>{__returnLost=true});await save(page,prefix);
 await expect(page.locator('#saleMessage')).toContainText('Черновик сохранён');await expect(page.locator('#saleNotes')).toBeDisabled();await page.locator('#sale button[onclick="saveSale()"]').click();await expect(page.locator('#report')).toBeVisible();
 const calls=await editCalls(page);expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(await writes(page)).toHaveLength(1);expect((await reportReads(page)).at(-1)).toBe('previous-shift');expect(errors).toEqual([]);
});

test('a committed edit followed by failed report refresh offers a read-only retry without saving twice',async({page})=>{
 const errors=await boot(page);await sourceReport(page);const prefix=await editFromReport(page,'procedure','Записано до ошибки обновления');await page.evaluate(()=>{__returnFailReport=1});await save(page,prefix);
 await expect(page.locator('#report')).toBeVisible();await expect(page.locator('#report')).toContainText(/сохранен|сохранён/i);await expect(page.locator('#report')).toContainText(/обновить|загрузить|временная ошибка/i);expect(await writes(page)).toHaveLength(1);
 const before=(await editCalls(page)).length;await page.locator('#reportEditRetryV46').click();
 await expect(page.locator('#reportBody')).toContainText('Записано до ошибки обновления');expect((await editCalls(page)).length).toBe(before);expect(await writes(page)).toHaveLength(1);expect((await reportReads(page)).at(-1)).toBe('previous-shift');expect(errors).toEqual([]);
});

test('a late clinical save cannot pull the administrator away from a newly opened patient list',async({page})=>{
 const errors=await boot(page);await sourceReport(page);const prefix=await editFromReport(page,'procedure','Сохраняется на фоне перехода');await page.evaluate(()=>{__returnDeferred=true});await save(page,prefix);await page.waitForFunction(()=>typeof __returnRelease==='function');
 await page.evaluate(()=>goPatients());await expect(page.locator('#patients')).toBeVisible();await page.evaluate(()=>__returnRelease());await expect.poll(async()=>(await writes(page)).length).toBe(1);await expect(page.locator('#patients')).toBeVisible();await expect(page.locator('#report')).not.toBeVisible();await expect(page.locator('#workspace')).not.toBeVisible();expect(await reportReads(page)).toEqual(['previous-shift']);expect(errors).toEqual([]);
});

test('signout while a clinical edit is saving cannot reopen a historical report or patient data',async({page})=>{
 const errors=await boot(page);await sourceReport(page);const prefix=await editFromReport(page,'sale','Сохранение перед выходом');await page.evaluate(()=>{__returnDeferred=true});await save(page,prefix);await page.waitForFunction(()=>typeof __returnRelease==='function');
 await page.evaluate(()=>signOut());await expect(page.locator('#login')).toBeVisible();await page.evaluate(()=>__returnRelease());await expect.poll(async()=>(await writes(page)).length).toBe(1);await expect(page.locator('#login')).toBeVisible();await expect(page.locator('#report')).not.toBeVisible();await expect(page.locator('#reportBody')).toBeEmpty();expect(await reportReads(page)).toEqual(['previous-shift']);expect(errors).toEqual([]);
});

test('a nurse editing from her journal returns to the same journal date and refreshed entry',async({page})=>{
 const errors=await boot(page,'nurse');await page.evaluate(()=>{const row=__returnRecords.get('previous-procedure');row.shift_id='current-shift';row.at=row.arrival_at=row.visit_at='2026-10-18T06:00:00Z'});
 await page.evaluate(()=>openShiftJournalV12('2026-10-18'));await expect(page.locator('#shiftJournalV12')).toBeVisible();const entry=page.locator('#journalBodyV12 [data-event-id="previous-procedure"]');await entry.getByRole('button',{name:'Редактировать',exact:true}).click();await expect(page.locator('#procedure')).toBeVisible();
 await page.fill('#procNotes','Правка из журнала');await page.fill('#procEditReasonV10','Уточнение примечания');await save(page,'proc');await expect(page.locator('#shiftJournalV12')).toBeVisible();await expect(page.locator('#journalDateV12')).toHaveValue('2026-10-18');await expect(entry).toContainText('Правка из журнала');await expect(page.locator('#workspace')).not.toBeVisible();expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});
