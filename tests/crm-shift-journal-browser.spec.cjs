const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'});

async function boot(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-11T07:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(()=>{
  currentStaff={id:'nurse-1',full_name:'Наталья',role:'nurse',active:true};
  shift={id:'shift-morning',a:'Наталья',b:'Лилия',type:'08:30–16:00'};
  financeAccountingMode5={payment_only:true,stock_deducted:false};
  const morning={shift:{id:'shift-morning',date:'2026-10-11',started_at:'2026-10-11T05:30:00Z',planned_end_at:'2026-10-11T13:00:00Z',status:'open'},staff:[{id:'nurse-1',full_name:'Наталья'},{id:'nurse-2',full_name:'Лилия <img src=x>'}],
   procedures:[{id:'proc-late',at:'2026-10-11T08:00:00Z',patient:'Вера',nurse:'Лилия',type:'Внутривенный укол',services:[{name:'Внутривенный укол',quantity:1,line_total:300}],items:[],own_medications:[{name:'Свой препарат',quantity:1,unit:'амп.',source:'patient'}],list_total:300,charge_total:0,paid_total:0,debt_total:0,discount_comment:'Бесплатно по решению владельца'},
    {id:'proc-b',at:'2026-10-11T06:00:00Z',patient:'Анна <script>bad()</script>',nurse:'Лилия',type:'Внутримышечный укол',services:[{name:'Внутримышечный укол',quantity:1,line_total:100}],items:[{name:'Второй препарат',quantity:1,unit:'фл.',line_total:300}],own_medications:[],list_total:400,charge_total:400,paid_total:400,debt_total:0,notes:'Повторный визит того же пациента'},
    {id:'proc-a',at:'2026-10-11T06:00:00Z',patient:'Анна <script>bad()</script>',nurse:'Наталья',type:'Капельница',services:[{name:'Капельница со своими препаратами',quantity:1,line_total:500},{name:'Дополнительный внутримышечный укол',quantity:2,line_total:200}],items:[{name:'Милдронат 5 мл',quantity:2,unit:'амп.',line_total:600}],own_medications:[{name:'Препарат пациента',quantity:1,unit:'фл.',source:'patient'},{name:'Ранее купленный препарат',quantity:2,unit:'амп.',source:'previously_purchased'}],list_total:1300,charge_total:1000,paid_total:800,debt_total:200,discount_comment:'Постоянная скидка согласована',notes:'Назначение: наблюдение после процедуры'}],
   sales:[{id:'sale-early',at:'2026-10-11T05:50:00Z',patient:'Первый пациент',nurse:'Лилия',items:[{name:'Флуимуцил Россия',quantity:1,unit:'амп.',line_total:300}],list_total:300,charge_total:300,paid_total:300,debt_total:0}],
   receipts:[{id:'receipt-hidden',at:'2026-10-11T06:30:00Z',patient:'НЕ ВКЛЮЧАТЬ отдельное погашение долга',amount:99991}],payroll_total:99992,cash_after_salary:99993,stock:[{name:'НЕ ВКЛЮЧАТЬ склад',work:99994,reserve:99995}],used:[{name:'НЕ ВКЛЮЧАТЬ списание',quantity:9}]};
  const closed={shift:{id:'shift-closed',date:'2026-10-10',started_at:'2026-10-10T13:00:00Z',planned_end_at:'2026-10-10T20:30:00Z',closed_at:'2026-10-10T20:30:00Z',status:'closed'},staff:[{id:'nurse-1',full_name:'Наталья'},{id:'nurse-3',full_name:'Ольга'}],procedures:[{id:'previous-proc',at:'2026-10-10T15:00:00Z',patient:'Пациент предыдущей даты',nurse:'Ольга',type:'Подкожный укол',services:[{name:'Подкожный укол',quantity:1,line_total:100}],items:[],own_medications:[],charge_total:100,paid_total:100,debt_total:0}],sales:[]};
  const overlapping={shift:{id:'shift-overlap',date:'2026-10-11',started_at:'2026-10-11T06:10:00Z',planned_end_at:'2026-10-11T14:00:00Z',status:'closed'},staff:[{id:'nurse-1',full_name:'Наталья'},{id:'nurse-3',full_name:'Ольга'}],procedures:[{id:'cross-shift',at:'2026-10-11T06:30:00Z',patient:'Пациент другой своей смены',nurse:'Ольга',type:'Подкожный укол',services:[{name:'Подкожный укол',quantity:1,line_total:100}],items:[],own_medications:[],charge_total:100,paid_total:100,debt_total:0}],sales:[]};
  window.__journalMorning=morning;window.__journalClosed=closed;
  window.__journalByDate={'2026-10-11':{date:'2026-10-11',time_zone:'Europe/Moscow',reports:[morning,overlapping]},'2026-10-10':{date:'2026-10-10',time_zone:'Europe/Moscow',reports:[closed]}};
  window.__journalCalls=[];window.__journalUnexpected=[];window.__journalFailures=0;window.__journalReturnedFailure=false;window.__journalError=null;window.__journalErrorStatus=undefined;window.__journalHoldDates=[];window.__journalPending={};
  db.rpc=async(name,args={})=>{
   if(name!=='crm_shift_journal_v12'){__journalUnexpected.push({name,args});return {data:[]}}
   __journalCalls.push(JSON.parse(JSON.stringify(args)));
   const date=args.p_date,data=JSON.parse(JSON.stringify(__journalByDate[date]||{date,time_zone:'Europe/Moscow',reports:[]}));
   if(__journalHoldDates.includes(date))await new Promise(resolve=>__journalPending[date]=resolve);
   if(__journalError)return {error:__journalError,status:__journalErrorStatus};
   if(__journalFailures>0){--__journalFailures;if(__journalReturnedFailure)return {error:{message:'TypeError: Load failed',code:'',hint:'',details:''},status:0};throw new TypeError('Load failed')}
   return {data};
  };
  $('homeNav').classList.remove('hidden');show('workspace');
 });
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
const rows=page=>page.locator('#journalBodyV12 .journal-event-v12');
const calls=page=>page.evaluate(()=>__journalCalls);
async function open(page){await page.click('#homeJournalV12');await expect(page.locator('#shiftJournalV12')).toBeVisible();await expect(rows(page)).toHaveCount(5)}
async function date(page,value){await page.evaluate(value=>{const input=$('journalDateV12');input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}))},value)}
async function noUnexpected(page){expect(await page.evaluate(()=>__journalUnexpected)).toEqual([]);expect((await calls(page)).every(call=>Object.keys(call).length===1&&typeof call.p_date==='string')).toBe(true)}

test('nurse opens a dated shift journal with all distinct visits and sales in stable time order',async({page})=>{
 const errors=await boot(page);await expect(page.locator('#homeJournalV12')).toContainText('Журнал смены');await open(page);
 await expect(page.locator('#journalDateV12')).toHaveValue('2026-10-11');expect((await calls(page))).toEqual([{p_date:'2026-10-11'}]);
 expect(await rows(page).evaluateAll(items=>items.map(item=>item.dataset.eventId))).toEqual(['sale-early','proc-a','proc-b','cross-shift','proc-late']);
 expect(await page.locator('#journalBodyV12 .journal-event-number-v12').allTextContents()).toEqual(['1.','2.','3.','4.','5.']);
 await expect(page.locator('#journalBodyV12 ol.journal-events-v12')).toHaveCount(1);
 await expect(rows(page).nth(0)).toContainText('Первый пациент');await expect(rows(page).nth(0)).toContainText('08:50');await expect(rows(page).nth(0)).toContainText('Флуимуцил Россия');
 for(const expected of ['Анна <script>bad()</script>','09:00','Наталья','Капельница со своими препаратами','Дополнительный внутримышечный укол','Милдронат 5 мл','Препарат пациента','Ранее купленный препарат','Постоянная скидка согласована','Назначение: наблюдение после процедуры','ранее куплен'])await expect(rows(page).nth(1)).toContainText(expected);
 await expect(rows(page).nth(1)).toContainText(/Милдронат 5 мл\s*×\s*2\s*амп\./);await expect(rows(page).nth(1)).toContainText(/Дополнительный внутримышечный укол\s*×\s*2/);await expect(rows(page).nth(1)).toContainText(/Ранее купленный препарат\s*×\s*2\s*амп\./);
 await expect(rows(page).nth(1)).toContainText('1 000');await expect(rows(page).nth(1)).toContainText('200');await expect(rows(page).nth(2)).toContainText('Анна <script>bad()</script>');await expect(rows(page).nth(2)).toContainText('Второй препарат');await expect(rows(page).nth(3)).toContainText('Пациент другой своей смены');await expect(rows(page).nth(3)).toHaveAttribute('data-shift-id','shift-overlap');await expect(rows(page).nth(4)).toContainText('Бесплатно');
 await expect(page.locator('#journalBodyV12')).toContainText('08:30');await expect(page.locator('#journalBodyV12')).toContainText('16:00');await expect(page.locator('#journalBodyV12')).toContainText('Наталья');await expect(page.locator('#journalBodyV12')).toContainText('Лилия <img src=x>');
 for(const secret of ['НЕ ВКЛЮЧАТЬ','9999','Зарплата','Остатки','Списано со склада'])await expect(page.locator('#journalBodyV12')).not.toContainText(secret);
 expect(await page.locator('#journalBodyV12 script,#journalBodyV12 img').count()).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await noUnexpected(page);expect(errors).toEqual([]);
});

test('journal date defaults to the Moscow day at the UTC boundary regardless of phone timezone',async({page})=>{
 const errors=await boot(page);await page.clock.setFixedTime(new Date('2026-10-11T21:30:00Z'));await page.click('#homeJournalV12');
 await expect(page.locator('#journalDateV12')).toHaveValue('2026-10-12');await expect.poll(async()=>((await calls(page)).length)).toBe(1);expect((await calls(page))[0]).toEqual({p_date:'2026-10-12'});await noUnexpected(page);expect(errors).toEqual([]);
});

test('previous-date closed shifts remain viewable and an empty day clears the prior journal',async({page})=>{
 const errors=await boot(page);await open(page);await date(page,'2026-10-10');await expect(rows(page)).toHaveCount(1);await expect(rows(page)).toHaveAttribute('data-event-id','previous-proc');
 await expect(page.locator('#journalBodyV12')).toContainText('Пациент предыдущей даты');await expect(page.locator('#journalBodyV12')).toContainText('Ольга');await expect(page.locator('#journalBodyV12')).toContainText('18:00');await expect(page.locator('#journalBodyV12')).not.toContainText('Анна');
 await date(page,'2026-10-09');await expect(rows(page)).toHaveCount(0);await expect(page.locator('#journalBodyV12')).not.toContainText('Пациент предыдущей даты');await expect.poll(async()=>(await page.locator('#journalMessageV12,#journalBodyV12').allTextContents()).join(' ')).toMatch(/Нет|нет|пока|не было|не найдены/);
 await noUnexpected(page);expect(errors).toEqual([]);
});

test('clearing the selected journal date removes old patients without sending an undated request',async({page})=>{
 const errors=await boot(page);await open(page);await date(page,'');await expect(rows(page)).toHaveCount(0);await expect(page.locator('#journalMessageV12')).toContainText(/Выберите дату/);await expect(page.locator('#journalRefreshV12')).toBeEnabled();
 expect((await calls(page))).toHaveLength(1);await expect(page.locator('#journalBodyV12')).not.toContainText('Анна');await noUnexpected(page);expect(errors).toEqual([]);
});

for(const returned of [false,true])test(`journal retries one ${returned?'returned Safari':'thrown'} network error with the same date`,async({page})=>{
 const errors=await boot(page);await page.evaluate(returned=>{__journalFailures=1;__journalReturnedFailure=returned},returned);await open(page);
 expect((await calls(page))).toEqual([{p_date:'2026-10-11'},{p_date:'2026-10-11'}]);await noUnexpected(page);expect(errors).toEqual([]);
});

test('two journal network failures show an error with no stale patients and refresh can recover',async({page})=>{
 const errors=await boot(page);await open(page);await page.evaluate(()=>__journalFailures=2);await page.click('#journalRefreshV12');
 await expect(page.locator('#journalMessageV12')).toContainText(/интернет|соедин|ответ|загруз/i);await expect(rows(page)).toHaveCount(0);await expect(page.locator('#journalBodyV12')).not.toContainText('Анна');expect((await calls(page))).toHaveLength(3);
 await page.click('#journalRefreshV12');await expect(rows(page)).toHaveCount(5);expect((await calls(page))).toHaveLength(4);await noUnexpected(page);expect(errors).toEqual([]);
});

for(const failure of [{error:{code:'42501',message:'Журнал этой смены недоступен.'}}, {error:{message:'Failed to fetch'},status:403}])test(`explicit journal ${failure.status||failure.error.code} errors are not retried and clear old records`,async({page})=>{
 const errors=await boot(page);await open(page);await page.evaluate(failure=>{__journalError=failure.error;__journalErrorStatus=failure.status},failure);await date(page,'2026-10-10');
 await expect(page.locator('#journalMessageV12')).toContainText(failure.error.message);await expect(rows(page)).toHaveCount(0);await expect(page.locator('#journalBodyV12')).not.toContainText('Анна');expect((await calls(page))).toHaveLength(2);await noUnexpected(page);expect(errors).toEqual([]);
});

test('a late journal response for an older selected date cannot replace the newer day',async({page})=>{
 const errors=await boot(page);await open(page);await page.evaluate(()=>__journalHoldDates=['2026-10-11']);await page.click('#journalRefreshV12');await page.waitForFunction(()=>typeof __journalPending['2026-10-11']==='function');
 await expect(rows(page)).toHaveCount(0);await date(page,'2026-10-10');await expect(rows(page)).toHaveCount(1);await expect(rows(page)).toHaveAttribute('data-event-id','previous-proc');
 await page.evaluate(()=>__journalPending['2026-10-11']());await expect(page.locator('#journalDateV12')).toHaveValue('2026-10-10');await expect(rows(page)).toHaveCount(1);await expect(page.locator('#journalBodyV12')).not.toContainText('Анна');await noUnexpected(page);expect(errors).toEqual([]);
});

test('leaving the journal while a response is pending does not reopen it or display old patient data',async({page})=>{
 const errors=await boot(page);await open(page);await page.evaluate(()=>__journalHoldDates=['2026-10-11']);await page.click('#journalRefreshV12');await page.waitForFunction(()=>typeof __journalPending['2026-10-11']==='function');
 await page.click('#homeNav');await expect(page.locator('#workspace')).toBeVisible();await page.evaluate(()=>__journalPending['2026-10-11']());await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#shiftJournalV12')).not.toBeVisible();await expect(rows(page)).toHaveCount(0);await noUnexpected(page);expect(errors).toEqual([]);
});

test('logout and login of the same nurse invalidates a late journal response from the old session',async({page})=>{
 const errors=await boot(page);await open(page);await page.evaluate(()=>__journalHoldDates=['2026-10-11']);await page.click('#journalRefreshV12');await page.waitForFunction(()=>typeof __journalPending['2026-10-11']==='function');
 await page.evaluate(async()=>{
  await signOut();__journalHoldDates=[];currentStaff={id:'nurse-1',full_name:'Наталья',role:'nurse',active:true};
  __journalByDate['2026-10-11']={date:'2026-10-11',time_zone:'Europe/Moscow',reports:[{...__journalMorning,procedures:[{id:'new-session',at:'2026-10-11T07:00:00Z',patient:'Пациент новой сессии',nurse:'Наталья',type:'Укол',services:[{name:'Укол',quantity:1,line_total:100}],items:[],charge_total:100,paid_total:100,debt_total:0}],sales:[]}]};
  show('workspace');await openShiftJournalV12();
 });
 await expect(rows(page)).toHaveCount(1);await expect(page.locator('#journalBodyV12')).toContainText('Пациент новой сессии');await page.evaluate(()=>__journalPending['2026-10-11']());
 await expect(rows(page)).toHaveCount(1);await expect(rows(page)).toHaveAttribute('data-event-id','new-session');await expect(page.locator('#journalBodyV12')).not.toContainText('Анна');await noUnexpected(page);expect(errors).toEqual([]);
});
