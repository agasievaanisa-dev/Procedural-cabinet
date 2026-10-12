const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';

async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);
 await page.evaluate(async role=>{
  currentStaff={id:'staff-a',full_name:'Администратор',role,active:true};
  window.__patientCardPatients=[{id:'patient-a',full_name:'Анна <script>bad()</script>',birth_date:'1980-04-12',sex:'female',phone:'+79000000000',complaints:'Жалобы <img src=x>',request:'Запрос',prescriptions:'Назначение врача',notes:'Заметка пациента'},{id:'patient-b',full_name:'Другой пациент'}];
  window.__cardPrintCalls=0;window.__cardReads=0;window.__cardFailure=null;window.__holdNextCard=false;
  window.__patientCardHistory={procedures:Array.from({length:237},(_,index)=>({id:'procedure-'+index,at:new Date(Date.UTC(2026,0,1,8,index)).toISOString(),nurse:'Наталья',procedure_type:'Капельница',services:[{name:'Капельница',quantity:1,work_price:500,consumables_price:100,line_total:600}],items:[{name:'Препарат '+index,quantity:2,unit:'амп.',unit_price:500,line_total:1000,purchase_price:88888}],own_medications:[{name:'Свой препарат',quantity:1,unit:'фл.',source:'previously_purchased'}],list_total:1600,charge_total:1300,paid_total:0,received_total:0,debt_total:1300,payment_pending:true,editable:role==='admin',discount_reason:'Постоянная скидка',discount_comment:'Согласовано',notes:'Комментарий <b>не HTML</b>',salary:77777,stock:[{name:'Нельзя печатать склад'}]})).reverse(),sales:[{id:'sale-before',at:'2025-12-31T09:00:00Z',nurse:'Наталья',items:[{name:'Продажа до процедур',quantity:1,unit:'уп.',unit_price:100,line_total:100}],list_total:100,charge_total:100,paid_total:100,debt_total:0,editable:role==='admin'}]};
  window.print=()=>{++__cardPrintCalls;window.dispatchEvent(new Event('beforeprint'))};
  db.rpc=async(name,args={})=>{
   if(name==='crm_management_v5'&&args.p_action==='patient_list')return {data:structuredClone(__patientCardPatients),error:null};
   if(name==='crm_clinical_v10'&&args.p_action==='patient_treatments'){
    ++__cardReads;const data=args.p_payload.patient_id==='patient-a'?structuredClone(__patientCardHistory):{procedures:[],sales:[]};
    if(__holdNextCard){__holdNextCard=false;await new Promise(resolve=>window.__releasePatientCard=resolve)}
    if(__cardFailure)return {data:null,error:__cardFailure};return {data,error:null};
   }
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]},error:null};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[]}:null,error:null};
   return {data:[],error:null};
  };
  await loadPatients();await openPatient('patient-a');
 },role);
 return errors;
}

test('separate patient card displays all 238 chronological events, demographics and captured medicine prices',async({page})=>{
 const errors=await boot(page);await page.click('#patientCardOpenV20');
 await expect(page.locator('#patientMedicalCardV20')).toBeVisible();await expect(page.locator('#patientMedicalCardBodyV20 [data-card-event]')).toHaveCount(238);
 const events=page.locator('#patientMedicalCardBodyV20 [data-card-event]');await expect(events.first()).toHaveAttribute('data-card-event','sale-before');await expect(events.last()).toHaveAttribute('data-card-event','procedure-236');
 await expect(page.locator('#patientMedicalCardBodyV20')).toContainText('Дата рождения');await expect(page.locator('#patientMedicalCardBodyV20')).toContainText('12.04.1980');await expect(page.locator('#patientMedicalCardBodyV20')).toContainText('Назначение врача');await expect(page.locator('#patientMedicalCardBodyV20')).toContainText('500 ₽ за единицу');
 await expect(page.locator('#patientMedicalCardBodyV20')).toContainText('Свой препарат');await expect(page.locator('#patientMedicalCardBodyV20')).toContainText('Ранее куплен в кабинете');await expect(page.locator('#patientMedicalCardBodyV20 script,#patientMedicalCardBodyV20 img')).toHaveCount(0);expect(errors).toEqual([]);
});

test('print from patient detail loads the full latest history and prints only this card with no controls or warehouse',async({page})=>{
 const errors=await boot(page);const initialReads=await page.evaluate(()=>__cardReads);await page.click('#patientCardPrintButtonV20');
 await expect(page.locator('#patientCardPrintV20 [data-card-event]')).toHaveCount(238);expect(await page.evaluate(()=>__cardPrintCalls)).toBe(1);expect(await page.evaluate(()=>__cardReads)).toBe(initialReads+1);
 await expect(page.locator('#patientCardPrintV20')).toContainText('Скидка:');await expect(page.locator('#patientCardPrintV20')).toContainText('300 ₽');await expect(page.locator('#patientCardPrintV20')).toContainText('Ожидает оплаты:');
 const html=await page.locator('#patientCardPrintV20').innerHTML();for(const secret of ['88888','77777','Нельзя печатать склад','stock_deducted','<button','onclick=','<script','<img'])expect(html).not.toContain(secret);
 await page.emulateMedia({media:'print'});await expect(page.locator('#patientCardPrintV20')).toBeVisible();await expect(page.locator('.app')).toBeHidden();await expect(page.locator('#patientCardPrintV20')).toContainText('Анна <script>bad()</script>');
 await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await expect(page.locator('#patientCardPrintV20')).toHaveCount(0);expect(errors).toEqual([]);
});

test('nurse can print patient history without exposing stock or salaries',async({page})=>{
 const errors=await boot(page,'nurse');await expect(page.locator('#patientCardPrintButtonV20')).toBeVisible();await page.click('#patientCardPrintButtonV20');
 await expect(page.locator('#patientCardPrintV20 [data-card-event]')).toHaveCount(238);expect(await page.evaluate(()=>__cardPrintCalls)).toBe(1);await expect(page.locator('#patientCardPrintV20')).not.toContainText('77777');await expect(page.locator('#patientCardPrintV20')).not.toContainText('Нельзя печатать склад');expect(errors).toEqual([]);
});

test('failed or malformed full history never prints a stale or partial patient card',async({page})=>{
 const errors=await boot(page);await page.click('#patientCardPrintButtonV20');expect(await page.evaluate(()=>__cardPrintCalls)).toBe(1);
 await page.evaluate(()=>__cardFailure={code:'P0001',message:'Нет доступа к истории'});await page.click('#patientCardPrintButtonV20');await expect(page.locator('#patientCardMessageV5')).toContainText('Не удалось подготовить полную карту');await expect(page.locator('#patientCardPrintV20')).toHaveCount(0);expect(await page.evaluate(()=>__cardPrintCalls)).toBe(1);
 await page.evaluate(()=>{__cardFailure=null;__patientCardHistory={procedures:[]}});await page.click('#patientCardPrintButtonV20');await expect(page.locator('#patientCardMessageV5')).toContainText('Полная история пока не получена');expect(await page.evaluate(()=>__cardPrintCalls)).toBe(1);expect(errors).toEqual([]);
});

test('late complete-history response cannot print or replace a different patient card',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__holdNextCard=true;void printPatientCardV20()});await page.waitForFunction(()=>typeof __releasePatientCard==='function');
 await page.evaluate(()=>openPatient('patient-b'));await page.evaluate(()=>__releasePatientCard());await expect(page.locator('#patientCardName')).toHaveText('Другой пациент');await expect(page.locator('#patientCardPrintV20')).toHaveCount(0);expect(await page.evaluate(()=>__cardPrintCalls)).toBe(0);expect(errors).toEqual([]);
});

test('late error after sign-out leaves the next nurse and patient message untouched',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__holdNextCard=true;void printPatientCardV20()});await page.waitForFunction(()=>typeof __releasePatientCard==='function');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'staff-b',full_name:'Медсестра',role:'nurse',active:true};await loadPatients();await openPatient('patient-b');message('patientCardMessageV5','Новая сессия');__cardFailure={message:'Ошибка старой сессии'};__releasePatientCard()});
 await expect(page.locator('#patientCardMessageV5')).toHaveText('Новая сессия');await expect(page.locator('#patientCardPrintV20')).toHaveCount(0);expect(await page.evaluate(()=>__cardPrintCalls)).toBe(0);expect(errors).toEqual([]);
});

test('full-card edit and payment actions refer to the selected recorded event',async({page})=>{
 const errors=await boot(page);await page.click('#patientCardOpenV20');await expect(page.locator('#patientMedicalCardBodyV20 [data-card-event]')).toHaveCount(238);
 await page.evaluate(()=>{window.__cardActions=[];window.editTreatmentV10=(...args)=>__cardActions.push(['edit',...args]);window.openSavedPaymentV14=(...args)=>__cardActions.push(['pay',...args])});
 await page.locator('[data-card-event="procedure-0"] [data-card-edit-v20]').click();await page.locator('[data-card-event="procedure-0"] [data-card-payment-v20]').click();
 expect(await page.evaluate(()=>__cardActions)).toEqual([['edit','procedure','procedure-0'],['pay','procedure','procedure-0',1300,'patient-a',true]]);expect(errors).toEqual([]);
});
