const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page,role='nurse'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const origin=new URL(base).origin;
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.addInitScript(()=>{
  window.__previewUrlsV40=[];window.__previewRevokedV40=[];window.__previewDownloadsV40=[];
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=blob=>{const url=create(blob);__previewUrlsV40.push(url);return url};
  URL.revokeObjectURL=url=>{__previewRevokedV40.push(url);return revoke(url)};
  document.addEventListener('click',event=>{const link=event.target.closest?.('a[download]');if(link?.href.startsWith('blob:'))__previewDownloadsV40.push(link.href)},true);
 });
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(role=>{
  currentStaff={id:'preview-staff',full_name:'Наталья',role,active:true};
  shift={id:'preview-shift',a:'Наталья',b:'Лилия',type:'08:30–16:00'};
  financeAccountingMode5={payment_only:true,stock_deducted:false};
  window.__previewPrintCallsV40=0;window.print=()=>{++__previewPrintCallsV40};
  const procedure=index=>({id:'preview-procedure-'+index,at:new Date(Date.UTC(2026,9,16,6,index)).toISOString(),patient:index===0?'Анна <script>bad()</script>':'Пациент отчёта '+index,nurse:'Наталья',type:'Капельница',services:[{name:'Капельница по сохранённому прайсу',quantity:1,line_total:600}],items:[{name:'Препарат '+index,quantity:2,unit:'амп.',unit_price:500,line_total:1000,purchase_price:88888}],own_medications:[{name:'Препарат пациента',quantity:1,unit:'фл.'}],list_total:1600,charge_total:1300,paid_total:1100,received_total:1100,debt_total:200,discount_amount:300,discount_reason:'Согласованная скидка',discount_comment:'Скидка сохранённой записи',payments:{cash:500,terminal:200,owner_card:400},notes:'Комментарий <img src=x onerror="bad()">'});
  window.__previewReportV40={shift:{id:'preview-shift',date:'2026-10-16',started_at:'2026-10-16T05:30:00Z',planned_end_at:'2026-10-16T13:00:00Z',ended_at:'2026-10-16T13:00:00Z',status:'closed'},staff:[{id:'preview-staff',full_name:'Наталья',amount:2000,reason:'Закрытая причина зарплаты'},{id:'preview-second',full_name:'Лилия',amount:2000}],patients_count:31,procedures_count:31,sales_count:0,revenue:{cash:15500,terminal:6200,owner_card:12400,total:34100},charge_total:40300,debt_total:6200,loan_debt_total:6200,pending_total:0,payroll_total:4000,payroll_complete:true,payroll_unknown:0,cash_drawer:{opening_confirmed:true,opening:2000,received_cash:15500,salary_paid:4000,cash_in:0,cash_out:0,balance:13500},used:[{name:'Секретное списание склада',quantity:9}],untracked:[{name:'Секретная сверка склада',quantity:3}],stock:[{name:'Секретный склад',work:99995,reserve:99996}],warnings:[],procedures:Array.from({length:31},(_,index)=>procedure(index)),sales:[],receipts:[]};
  window.__previewPatientV40={id:'preview-patient',full_name:'Полная карта Анны',birth_date:'1980-04-12',phone:'+79001234567',complaints:'Жалобы пациента',request:'Запрос пациента',prescriptions:'Назначение врача',notes:'Заметка пациента'};
  window.__previewHistoryV40={procedures:Array.from({length:67},(_,index)=>({...procedure(index),procedure_type:'Капельница',salary:77777,stock:[{name:'Секретный склад карты'}]})).reverse(),sales:[]};
  window.__previewCardReadsV40=0;
  window.__previewSummaryV40={from:'2026-10-01',to:'2026-10-16',time_zone:'Europe/Moscow',group_by:'day',patients_count:31,procedures_count:31,sales_count:0,revenue:{cash:15500,terminal:6200,owner_card:12400,total:34100},charge_total:40300,loan_debt_total:6200,pending_total:0,payroll_total:4000,payroll_complete:true,rows:[{id:'period-row',label:'Строка выбранного периода',patients_count:31,procedures_count:31,sales_count:0,revenue:{cash:15500,terminal:6200,owner_card:12400,total:34100}}],shifts:[]};
  db.rpc=async(name,args={})=>{
   if(name==='crm_finance_v5'&&args.p_action==='shift_report')return {data:structuredClone(__previewReportV40),error:null};
   if(name==='crm_finance_v5'&&args.p_action==='summary')return {data:structuredClone(__previewSummaryV40),error:null};
   if(name==='crm_management_v5'&&args.p_action==='patient_list')return {data:[structuredClone(__previewPatientV40)],error:null};
   if(name==='crm_clinical_v10'&&args.p_action==='patient_treatments'){++__previewCardReadsV40;return {data:structuredClone(__previewHistoryV40),error:null}}
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]},error:null};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[]}:null,error:null};
   return {data:[],error:null};
  };
  loadQuickContext=async()=>{};refreshDashboard=async()=>{};refreshOwnerDashboardV5=async()=>{};
  show('workspace');renderShiftReportV5(__previewReportV40,true);
 },role);
 return errors;
}

async function openShiftPreview(page){
 await page.click('#reportPrintV5');
 await expect(page.locator('#crmPrintPreviewV40')).toBeVisible();
 await expect(page.locator('#crmPrintDocumentV40')).toBeVisible();
}
async function expectCleared(page){
 await expect(page.locator('#crmPrintPreviewV40')).toBeHidden();
 await expect(page.locator('#crmPrintDocumentV40,#shiftPrintV5,#patientCardPrintV20')).toHaveCount(0);
 expect(await page.locator('.app').evaluate(element=>element.inert)).toBe(false);
}
async function holdPdf(page){
 await page.evaluate(()=>{
  window.crmPdfBlobV40=()=>new Promise(resolve=>{window.__releasePdfV40=()=>resolve(new Blob(['%PDF-1.7\n','x'.repeat(4096),'\n%%EOF'],{type:'application/pdf'}))});
 });
 await page.click('#crmPrintPdfV40');
 await page.waitForFunction(()=>typeof window.__releasePdfV40==='function');
}
async function releasePdf(page){
 await page.evaluate(async()=>{__releasePdfV40();await new Promise(resolve=>setTimeout(resolve,30))});
}
async function openPeriod(page){
 await page.evaluate(async()=>{installFinanceScreensV5();show('reportsV5');reportsV5From.value='2026-10-01';reportsV5To.value='2026-10-16';await loadFinanceSummaryV5('reportsV5')});
 await expect(page.locator('#reportsV5Print')).toBeEnabled();
 await page.click('#reportsV5Print');await expect(page.locator('#crmPrintPreviewV40')).toBeVisible();
}

for(const role of ['nurse','owner'])test(`${role}: ignored native print leaves a complete readable shift preview with PDF and close controls`,async({page})=>{
 const errors=await boot(page,role);await openShiftPreview(page);
 expect(await page.evaluate(()=>__previewPrintCallsV40)).toBe(1);
 await expect(page.locator('#report')).toHaveClass(/active/);
 expect(await page.locator('.app').evaluate(element=>element.inert)).toBe(true);
 expect(await page.locator('#crmPrintPreviewV40').evaluate(element=>!element.closest('.app'))).toBe(true);
 const document=page.locator('#crmPrintDocumentV40');
 await expect(document.locator('.shift-print-event-v5')).toHaveCount(31);
 await expect(document).toContainText('Пациент отчёта 30');await expect(document).toContainText('Анна <script>bad()</script>');
 for(const text of ['Капельница по сохранённому прайсу','Препарат пациента','Скидка сохранённой записи','Зарплата за смену','Остаток наличных в кассе'])await expect(document).toContainText(text);
 for(const secret of ['Секретное','Секретная','Секретный','Закрытая причина зарплаты','99 995','99 996','88888'])await expect(document).not.toContainText(secret);
 await expect(document.locator('button,input,select,textarea,script,img,[onclick]')).toHaveCount(0);
 await expect(page.locator('#crmPrintRetryV40')).toBeVisible();await expect(page.locator('#crmPrintPdfV40')).toBeVisible();await expect(page.locator('#crmPrintCloseV40')).toBeVisible();
 await expect(page.locator('#crmPrintMessageV40')).toContainText(/PDF/i);
 await page.click('#crmPrintCloseV40');await expectCleared(page);await expect(page.locator('#report')).toBeVisible();expect(errors).toEqual([]);
});

test('immediate beforeprint and afterprint keep the preview; retries prepare exactly one printable article',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{window.__printArticleCountsV40=[];window.print=()=>{++__previewPrintCallsV40;dispatchEvent(new Event('beforeprint'));__printArticleCountsV40.push(document.querySelectorAll('#shiftPrintV5').length);dispatchEvent(new Event('afterprint'))}});
 await openShiftPreview(page);
 for(let index=0;index<2;index++){
  await page.click('#crmPrintRetryV40');await expect(page.locator('#crmPrintPreviewV40')).toBeVisible();
  await expect(page.locator('#shiftPrintV5')).toHaveCount(0);await expect(page.locator('#crmPrintDocumentV40 .shift-print-event-v5')).toHaveCount(31);
 }
 expect(await page.evaluate(()=>__previewPrintCallsV40)).toBe(3);
 expect(await page.evaluate(()=>__printArticleCountsV40)).toEqual([1,1,1]);
 await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));
 await page.emulateMedia({media:'print'});await expect(page.locator('#shiftPrintV5')).toBeVisible();await expect(page.locator('.app')).toBeHidden();
 await page.emulateMedia({media:'screen'});await page.evaluate(()=>dispatchEvent(new Event('afterprint')));await expect(page.locator('#crmPrintPreviewV40')).toBeVisible();
 await page.click('#crmPrintCloseV40');await expectCleared(page);expect(errors).toEqual([]);
});

test('beforeprint after the actor changes renders a nonblank safe message without the stale report',async({page})=>{
 const errors=await boot(page,'owner');await openShiftPreview(page);
 await page.evaluate(()=>{currentStaff={...currentStaff,id:'another-staff'};dispatchEvent(new Event('beforeprint'))});
 await expect(page.locator('#crmPrintPreviewV40')).toBeHidden();
 await expect(page.locator('#shiftPrintV5')).toHaveCount(1);
 await expect(page.locator('#shiftPrintV5')).toContainText(/Документ изменился|Отчёт не подготовлен/);
 for(const stale of ['Пациент отчёта','Анна','Секретный склад','Секретное списание','34 100'])await expect(page.locator('#shiftPrintV5')).not.toContainText(stale);
 await page.emulateMedia({media:'print'});await expect(page.locator('#shiftPrintV5')).toBeVisible();await expect(page.locator('.app')).toBeHidden();
 await page.emulateMedia({media:'screen'});await page.evaluate(()=>dispatchEvent(new Event('afterprint')));await expectCleared(page);expect(errors).toEqual([]);
});

test('a native print exception leaves the document visible with a useful PDF fallback message',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{window.print=()=>{++__previewPrintCallsV40;throw new Error('Embedded native print unavailable')}});
 await openShiftPreview(page);await expect(page.locator('#crmPrintDocumentV40')).toContainText('Пациент отчёта 30');
 await expect(page.locator('#crmPrintMessageV40')).toContainText(/PDF|печат/i);
 await expect(page.locator('#crmPrintPdfV40')).toBeEnabled();await expect(page.locator('#crmPrintRetryV40')).toBeEnabled();
 await page.click('#crmPrintCloseV40');await expectCleared(page);expect(errors).toEqual([]);
});

test('PDF fallback downloads a real PDF even when native print does nothing, then close revokes its URL',async({page},testInfo)=>{
 const errors=await boot(page);await openShiftPreview(page);
 const downloadPromise=page.waitForEvent('download');await page.click('#crmPrintPdfV40');const download=await downloadPromise;
 expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
 await download.saveAs(testInfo.outputPath('shift-report.pdf'));
 const bytes=fs.readFileSync(await download.path());expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(bytes.length).toBeGreaterThan(2000);expect(bytes.subarray(-1024).toString()).toContain('%%EOF');
 await expect(page.locator('#crmPrintOpenPdfV40')).toHaveAttribute('href',/^blob:/);await expect(page.locator('#crmPrintDownloadV40')).toHaveAttribute('href',/^blob:/);
 const urls=await page.evaluate(()=>[...__previewUrlsV40]);expect(urls.length).toBeGreaterThan(0);
 expect(await page.evaluate(()=>__previewPrintCallsV40)).toBe(1);await expect(page.locator('#crmPrintPreviewV40')).toBeVisible();
 await page.click('#crmPrintCloseV40');await expectCleared(page);
 expect(await page.evaluate(urls=>urls.every(url=>__previewRevokedV40.includes(url)),urls)).toBe(true);expect(errors).toEqual([]);
});

for(const change of ['actor','session','signout'])test(`a held PDF is discarded after ${change} and cannot create a URL or download`,async({page})=>{
 const errors=await boot(page);await openShiftPreview(page);await holdPdf(page);
 await page.evaluate(async change=>{
  if(change==='actor')currentStaff={...currentStaff,id:'new-preview-staff'};
  else if(change==='session')++financeSession5;
  else await signOut();
 },change);
 await releasePdf(page);await expectCleared(page);
 expect(await page.evaluate(()=>__previewUrlsV40)).toEqual([]);expect(await page.evaluate(()=>__previewDownloadsV40)).toEqual([]);
 if(change==='signout')await expect(page.locator('#login')).toBeVisible();expect(errors).toEqual([]);
});

test('navigation closes a ready PDF and revokes it before another screen appears',async({page})=>{
 const errors=await boot(page);await openShiftPreview(page);
 await page.evaluate(()=>{window.crmPdfBlobV40=async()=>new Blob(['%PDF-1.7\n','x'.repeat(4096),'\n%%EOF'],{type:'application/pdf'})});
 await page.click('#crmPrintPdfV40');await expect(page.locator('#crmPrintOpenPdfV40')).toHaveAttribute('href',/^blob:/);
 const urls=await page.evaluate(()=>[...__previewUrlsV40]);
 await page.evaluate(()=>show('workspace'));await expectCleared(page);await expect(page.locator('#workspace')).toBeVisible();
 expect(await page.evaluate(urls=>urls.every(url=>__previewRevokedV40.includes(url)),urls)).toBe(true);expect(errors).toEqual([]);
});

test('the complete patient card remains visible after ignored print and retry uses its authorized snapshot',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(async()=>{await loadPatients();await openPatient('preview-patient')});
 const reads=await page.evaluate(()=>__previewCardReadsV40);
 await page.click('#patientCardPrintButtonV20');await expect(page.locator('#crmPrintPreviewV40')).toBeVisible();
 await expect(page.locator('#crmPrintDocumentV40 [data-card-event]')).toHaveCount(67);
 for(const text of ['Полная карта Анны','12.04.1980','+79001234567','Назначение врача','Препарат 66'])await expect(page.locator('#crmPrintDocumentV40')).toContainText(text);
 for(const secret of ['88888','77777','Секретный склад карты'])await expect(page.locator('#crmPrintDocumentV40')).not.toContainText(secret);
 expect(await page.evaluate(()=>__previewCardReadsV40)).toBe(reads+1);
 await page.click('#crmPrintRetryV40');expect(await page.evaluate(()=>__previewCardReadsV40)).toBe(reads+1);expect(await page.evaluate(()=>__previewPrintCallsV40)).toBe(2);
 await expect(page.locator('#patientCardPrintV20')).toHaveCount(1);await expect(page.locator('#crmPrintDocumentV40 [data-card-event]')).toHaveCount(67);
 await page.click('#crmPrintCloseV40');await expectCleared(page);await expect(page.locator('#patientCard')).toBeVisible();expect(errors).toEqual([]);
});

test('period print previews the selected snapshot and changing a filter discards an in-flight PDF',async({page})=>{
 const errors=await boot(page,'owner');
 await page.evaluate(()=>{__previewSummaryV40.shifts=[{id:'period-shift',shift_date:'2026-10-15',status:'closed',started_at:'2026-10-15T05:30:00Z',ended_at:'2026-10-15T13:00:00Z',staff:[{full_name:'Медсестра периода Наталья'},{full_name:'Медсестра периода Лилия'}],payroll_total:4000,payroll_complete:true}]});
 await openPeriod(page);
 await expect(page.locator('#crmPrintDocumentV40')).toContainText('01.10.2026');await expect(page.locator('#crmPrintDocumentV40')).toContainText('16.10.2026');await expect(page.locator('#crmPrintDocumentV40')).toContainText('Строка выбранного периода');
 const shiftRow=page.locator('#crmPrintDocumentV40 div.finance-shift-v5');await expect(shiftRow).toHaveCount(1);
 for(const text of ['15.10.2026','Закрыта','Медсестра периода Наталья','Медсестра периода Лилия','зарплата 4 000 ₽'])await expect(shiftRow).toContainText(text);
 await expect(shiftRow).not.toHaveAttribute('onclick');
 await expect(page.locator('#crmPrintDocumentV40 button,#crmPrintDocumentV40 input,#crmPrintDocumentV40 select')).toHaveCount(0);
 await holdPdf(page);
 await page.evaluate(()=>{reportsV5From.value='2026-10-02';invalidateFinanceSummaryV5('reportsV5')});
 await releasePdf(page);await expectCleared(page);await expect(page.locator('#reportsV5Print')).toBeDisabled();
 expect(await page.evaluate(()=>__previewUrlsV40)).toEqual([]);expect(await page.evaluate(()=>__previewDownloadsV40)).toEqual([]);expect(errors).toEqual([]);
});

test('a phone can read and scroll a long preview without horizontal overflow',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{__previewReportV40.procedures[0].patient='ДлиннаяФамилия'.repeat(30);__previewReportV40.procedures[0].notes='ДлинноеПримечание'.repeat(50);renderShiftReportV5(__previewReportV40,true)});
 await openShiftPreview(page);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 for(const selector of ['#crmPrintPreviewV40','#crmPrintDocumentV40'])expect(await page.locator(selector).evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
 await page.locator('#crmPrintDocumentV40 .shift-print-event-v5').last().scrollIntoViewIfNeeded();await expect(page.locator('#crmPrintDocumentV40 .shift-print-event-v5').last()).toBeInViewport();
 await page.click('#crmPrintCloseV40');await expectCleared(page);expect(errors).toEqual([]);
});
