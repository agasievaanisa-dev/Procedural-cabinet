const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-17T10:00:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async()=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  currentStaff={id:'nurse-1',full_name:'Медсестра проверки',role:'nurse',active:true};
  shift={id:'shift-1',aId:'nurse-1',a:'Медсестра проверки',bId:'nurse-2',b:'Вторая медсестра',type:'08:30–16:00'};
  const staff=[{id:'nurse-1',full_name:'Медсестра проверки'},{id:'nurse-2',full_name:'Вторая медсестра'}];
  const opened={id:'shift-1',date:'2026-10-17',status:'open',started_at:'2026-10-17T05:30:00Z',planned_end_at:'2026-10-17T13:00:00Z'};
  const record={id:'procedure-1',kind:'procedure',patient_id:'patient-1',patient:'Пациент проверки',nurse_id:'nurse-1',nurse:'Медсестра проверки',shift_id:'shift-1',at:'2026-10-17T09:00:00Z',procedure_type:'Капельница',list_total:1600,charge_total:1600,paid_total:0,initial_paid_total:0,received_total:0,debt_total:1600,payment_pending:true,pending_total:1600,editable:true,services:[{name:'Капельница',quantity:1,line_total:1600}],items:[],own_medications:[],payments:{cash:0,terminal:0,owner_card:0},notes:''};
  window.__journalV44={calls:[],effects:[],replay:new Map(),readFailures:0,record,receipts:[]};
  db.rpc=async(name,args={})=>{
   const state=__journalV44;state.calls.push({name,args:clone(args)});
   if(name==='crm_shift_journal_v12'){
    if(state.readFailures>0){state.readFailures--;return {error:{message:'Load failed'},status:0}}
    if(state.holdNextRead){state.holdNextRead=false;await new Promise(resolve=>{window.__releaseJournalV44=resolve});state.heldReadReturned=true}
    return {data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[{shift:opened,staff,procedures:[clone(record)],sales:[],receipts:clone(state.receipts)}]}};
   }
   if(name==='crm_clinical_v10'&&args.p_action==='debt_payment'){
    const p=args.p_payload;let answer=state.replay.get(args.p_request_id);
    if(!answer){
     const pay=p.payments,total=pay.cash+pay.terminal+pay.owner_card;
     if(total>record.debt_total)return {error:{code:'P0001',message:'Оплата превышает остаток'}};
     state.effects.push(clone(args));record.received_total+=total;record.debt_total-=total;record.payment_pending=record.debt_total>0;
     for(const method of ['cash','terminal','owner_card'])record.payments[method]+=pay[method];
     state.receipts.push({id:args.p_request_id,kind:p.kind,record_id:p.id,at:'2026-10-17T10:00:00Z',paid_total:total,payments:clone(pay),is_debt_repayment:false,receipt_kind:'after_procedure_payment'});
     answer=clone(record);state.replay.set(args.p_request_id,answer);
    }
    return {data:clone(answer)};
   }
   return {data:[]};
  };
  refreshDashboard=async()=>{};refreshOwnerDashboardV5=async()=>{};
  show('workspace');await openShiftJournalV12('2026-10-17');
 });
 await expect(page.locator('#journalBodyV12 [data-event-id="procedure-1"]')).toContainText('Ожидает оплаты');
 return errors;
}
const entry=page=>page.locator('#journalBodyV12 [data-event-id="procedure-1"]');
const save=page=>page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]');
async function openPayment(page){await entry(page).getByRole('button',{name:'Принять оплату',exact:true}).click();await expect(page.locator('#debtPaymentV10')).toBeVisible()}
async function effects(page){return page.evaluate(()=>__journalV44.effects)}

test('saved ordinary payment requires an explicit method instead of silently choosing cash',async({page})=>{
 const errors=await boot(page);await openPayment(page);
 await expect(page.locator('#debtMethodV10')).toHaveValue('');await expect(page.locator('#debtMethodSummaryV44')).toContainText('Выберите способ оплаты');await expect(page.locator('#debtTenderV10')).toBeHidden();
 await page.check('#debtConfirmV10');await save(page).click();await expect(page.locator('#debtMessageV10')).toContainText('Выберите способ оплаты');expect(await effects(page)).toHaveLength(0);expect(errors).toEqual([]);
});

for(const [method,label]of[['cash','Наличные'],['terminal','Терминал'],['owner_card','Перевод на карту начальника']])test(`journal collection preserves ${method}, refreshes the original patient and needs no edit comment`,async({page})=>{
 const errors=await boot(page);await openPayment(page);await page.selectOption('#debtMethodV10',method);
 await expect(page.locator('#debtMethodSummaryV44')).toContainText(label);await expect(page.locator('#debtMethodSummaryV44')).toContainText(/1\s*600/);
 await page.check('#debtConfirmV10');await save(page).click();await expect(page.locator('#shiftJournalV12')).toBeVisible();await expect(entry(page)).not.toContainText('Ожидает оплаты');await expect(entry(page).getByRole('button',{name:'Принять оплату',exact:true})).toHaveCount(0);await expect(entry(page)).toContainText(label);
 const writes=await effects(page);expect(writes).toHaveLength(1);expect(writes[0].p_action).toBe('debt_payment');expect(writes[0].p_payload.payments).toEqual({cash:method==='cash'?1600:0,terminal:method==='terminal'?1600:0,owner_card:method==='owner_card'?1600:0,cash_received:method==='cash'?1600:0});expect(writes[0].p_payload.comment).toBeNull();
 expect(await page.evaluate(()=>__journalV44.calls.filter(x=>x.name==='crm_clinical_v10'&&x.args.p_action==='treatment_edit'))).toHaveLength(0);expect(errors).toEqual([]);
});

test('journal mixed collection preserves cash and terminal parts on the original entry',async({page})=>{
 const errors=await boot(page);await openPayment(page);await page.selectOption('#debtMethodV10','mixed');await page.fill('#debtCashV43','1200');await page.fill('#debtTerminalV43','400');await page.fill('#debtOwnerCardV43','');
 await expect(page.locator('#debtMethodSummaryV44')).toContainText(/Наличные:.*1\s*200.*Терминал:.*400/);await page.check('#debtConfirmV10');await save(page).click();await expect(page.locator('#shiftJournalV12')).toBeVisible();await expect(entry(page)).toContainText(/Наличные:.*1\s*200/);await expect(entry(page)).toContainText(/Терминал:.*400/);
 expect((await effects(page))[0].p_payload.payments).toEqual({cash:1200,terminal:400,owner_card:0,cash_received:1200});expect(errors).toEqual([]);
});

test('a committed payment with failed journal refresh preserves the read error; refresh retries no payment',async({page})=>{
 const errors=await boot(page);await openPayment(page);await page.selectOption('#debtMethodV10','terminal');await page.evaluate(()=>{__journalV44.readFailures=2});await page.check('#debtConfirmV10');await save(page).click();
 await expect(page.locator('#shiftJournalV12')).toBeVisible();await expect(page.locator('#journalMessageV12')).toContainText('Оплата сохранена');await expect(page.locator('#journalMessageV12')).toContainText('Журнал не обновлён');await expect(page.locator('#journalMessageV12')).toContainText('Обновить');await expect(page.locator('#journalRefreshV12')).toBeEnabled();expect(await effects(page)).toHaveLength(1);
 await page.click('#journalRefreshV12');await expect(entry(page)).not.toContainText('Ожидает оплаты');await expect(entry(page)).toContainText(/Терминал:.*1\s*600/);await expect(page.locator('#journalMessageV12')).toBeHidden();expect(await effects(page)).toHaveLength(1);
 expect(await page.evaluate(()=>__journalV44.calls.filter(x=>x.name==='crm_clinical_v10'&&x.args.p_action==='debt_payment'))).toHaveLength(1);expect(errors).toEqual([]);
});

test('a late post-payment journal response cannot overwrite the status of another journal date',async({page})=>{
 const errors=await boot(page);await openPayment(page);await page.selectOption('#debtMethodV10','terminal');await page.evaluate(()=>{__journalV44.holdNextRead=true});await page.check('#debtConfirmV10');await save(page).click();
 await expect.poll(()=>page.evaluate(()=>typeof window.__releaseJournalV44)).toBe('function');expect(await effects(page)).toHaveLength(1);
 await page.evaluate(()=>openShiftJournalV12('2026-10-16'));await expect(page.locator('#journalDateV12')).toHaveValue('2026-10-16');await expect(page.locator('#journalMessageV12')).toBeHidden();
 await page.evaluate(()=>window.__releaseJournalV44());await expect.poll(()=>page.evaluate(()=>__journalV44.heldReadReturned)).toBe(true);
 await expect(page.locator('#journalDateV12')).toHaveValue('2026-10-16');await expect(page.locator('#journalMessageV12')).toBeHidden();expect(await effects(page)).toHaveLength(1);expect(errors).toEqual([]);
});
