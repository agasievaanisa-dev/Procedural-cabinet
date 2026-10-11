const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page,role='nurse') {
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:`window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})}}};`}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(role=>{
  currentStaff={id:'staff-1',full_name:'Наталья',role,active:true};shift={id:'shift-1',a:'Наталья',b:'Лилия',type:'08:30–16:00'};
  financeAccountingMode5={payment_only:true,stock_deducted:false};
  window.__reportV10={shift:{id:'shift-1',date:'2026-10-11',started_at:'2026-10-11T05:30:00Z',planned_end_at:'2026-10-11T13:00:00Z',status:'closed'},staff:[{id:'staff-1',full_name:'Наталья',amount:99991},{id:'staff-2',full_name:'Лилия <img src=x>',amount:99992}],patients_count:3,procedures_count:2,sales_count:1,
   revenue:{cash:500,terminal:200,owner_card:300,total:1000},charge_total:1200,debt_total:200,payroll_total:99993,cash_after_salary:99994,
   used:[{name:'Скрытое списание',quantity:9}],untracked:[{name:'Скрытая операция',quantity:3}],stock:[{name:'Скрытый склад',work:99995,reserve:99996}],warnings:[],
   procedures:[{id:'procedure-1',at:'2026-10-11T09:00:00Z',patient:'Анна <script>bad()</script>',nurse:'Наталья',type:'Капельница',services:[{name:'Капельница со своими препаратами',quantity:1,line_total:500},{name:'Внутримышечный дополнительный укол',quantity:1,line_total:100}],items:[{name:'Милдронат 5 мл',quantity:2,unit:'амп.',line_total:600}],own_medications:[{name:'Препарат пациента',quantity:1,unit:'фл.'}],list_total:1200,charge_total:900,paid_total:700,debt_total:200,discount_amount:300,discount_reason:'Постоянная скидка',discount_comment:'Согласовано с владельцем',payments:{cash:500,terminal:200,owner_card:0}},
    {id:'procedure-2',at:'2026-10-11T10:00:00Z',patient:'Вера',nurse:'Лилия',type:'Внутривенный укол',own_medications:[{name:'Свой препарат',quantity:1,unit:'амп.'}],items:[],list_total:300,charge_total:0,paid_total:0,debt_total:0,discount_amount:300,discount_comment:'Бесплатно по решению владельца'}],
   sales:[{id:'sale-1',at:'2026-10-11T08:00:00Z',patient:'Первый пациент',nurse:'Лилия',items:[{name:'Флуимуцил Россия',quantity:1,unit:'амп.',line_total:300}],list_total:300,charge_total:300,paid_total:300,debt_total:0,payments:{cash:0,terminal:0,owner_card:300}}]};
  db.rpc=async(name,args)=>({data:window.__reportV10});window.__printCalls=0;window.print=()=>window.__printCalls++;
  show('workspace');
 },role);
 return errors;
}

test('nurse has explicit medication sale action and prints the entire own shift with finance only',async({page})=>{
 const errors=await boot(page);
 await expect(page.locator('#workspace .home-actions button')).toHaveCount(5);
 await expect(page.locator('#workspace .home-actions button[onclick="openSale()"]')).toContainText('Продажа препарата');
 await page.evaluate(()=>renderShiftReportV5(window.__reportV10,true));
 await expect(page.locator('#reportBody')).toContainText('1 000');await expect(page.locator('#reportBody')).toContainText('В долг');
 for (const secret of ['Скрыт','Зарплата','Списано со склада','Остатки']) await expect(page.locator('#reportBody')).not.toContainText(secret);
 await page.click('#reportPrintV5');expect(await page.evaluate(()=>window.__printCalls)).toBe(1);
 await page.emulateMedia({media:'print'});
 await expect(page.locator('#shiftPrintV5')).toBeVisible();await expect(page.locator('.app')).toBeHidden();
 await expect(page.locator('#shiftPrintV5 header')).toContainText('08:30–16:00');await expect(page.locator('#shiftPrintV5 header')).toContainText('Наталья');await expect(page.locator('#shiftPrintV5 header')).toContainText('Лилия <img src=x>');
 const entries=page.locator('#shiftPrintV5 .shift-print-event-v5');await expect(entries).toHaveCount(3);
 await expect(entries.nth(0)).toContainText('Первый пациент');await expect(entries.nth(1)).toContainText('Анна <script>bad()</script>');await expect(entries.nth(2)).toContainText('Вера');
 for (const expected of ['11.10.2026, 12:00','Капельница со своими препаратами','Внутримышечный дополнительный укол','Милдронат 5 мл × 2 амп.','Препарат пациента × 1 фл.','Согласовано с владельцем','Стоимость: 900','Оплачено: 700','В долг: 200']) await expect(entries.nth(1)).toContainText(expected);
 await expect(entries.nth(2)).toContainText('Бесплатно');await expect(page.locator('#shiftPrintV5 footer')).toContainText('1 200');await expect(page.locator('#shiftPrintV5 footer')).toContainText('1 000');
 for (const secret of ['Скрыт','9999','Зарплата','Остатки','Списано со склада','Без списания со склада']) await expect(page.locator('#shiftPrintV5')).not.toContainText(secret);
 expect(await page.locator('#shiftPrintV5 script,#shiftPrintV5 img').count()).toBe(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await expect(page.locator('#shiftPrintV5')).toHaveCount(0);
 await page.emulateMedia({media:'screen'});await expect(page.locator('#report')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

test('owner stock remains in app but stays outside the printed shift; failed next shift cannot print stale data',async({page})=>{
 const errors=await boot(page,'owner');await page.evaluate(()=>renderShiftReportV5(window.__reportV10,true));
 await expect(page.locator('#reportBody')).toContainText('Скрытый склад');await expect(page.locator('#reportBody')).toContainText('Зарплата');
 await page.click('#reportPrintV5');await page.emulateMedia({media:'print'});await expect(page.locator('#shiftPrintV5')).toBeVisible();
 await expect(page.locator('#shiftPrintV5')).not.toContainText('Скрытый склад');await expect(page.locator('#shiftPrintV5')).not.toContainText('99993');
 await page.emulateMedia({media:'screen'});await page.evaluate(async()=>{window.dispatchEvent(new Event('afterprint'));db.rpc=async()=>({error:{code:'P0001',message:'Не удалось получить смену'}});await openReportByIdV5('shift-2');printShiftReportV5()});
 await expect(page.locator('#reportPrintV5')).toBeDisabled();await expect(page.locator('#shiftPrintV5')).toHaveCount(0);expect(await page.evaluate(()=>window.__printCalls)).toBe(1);
 await expect(page.locator('#reportPrintMessageV5')).toContainText('Сначала откройте');expect(errors).toEqual([]);
});
