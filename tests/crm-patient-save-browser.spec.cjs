const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// A receipt-backed server fixture distinguishes a lost response from a failed write.
// It deliberately commits before throwing, so a replacement UUID would duplicate a card.
async function boot(page,role='owner'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);
 await page.evaluate(async role=>{
  currentStaff={id:'actor-1',full_name:role==='owner'?'Аниса':'Наталья',role,active:true};
  window.__patientSaveCalls=[];window.__patientWrites=[];window.__patientReceipts=new Map();
  window.__patientFixtures=[{id:'existing-1',full_name:'Анна',phone:'89000000000',notes:'Исходная заметка',sex:'female',updated_at:'2026-10-11T10:00:00Z'}];
  window.__patientLostResponses=0;window.__patientLostReturned=false;window.__patientFailure=null;window.__patientAfterNetworkFailure=null;window.__patientHoldSave=false;window.__patientListFailures=0;window.__patientHistoryFailure=false;
  db.rpc=async(name,args={})=>{
   if(name==='crm_patient_save_v11'){
    __patientSaveCalls.push(JSON.parse(JSON.stringify(args)));
    if(__patientFailure)return {error:__patientFailure};
    let receipt=__patientReceipts.get(args.p_request_id);
    if(!receipt){
     const payload=JSON.parse(JSON.stringify(args.p_payload));
     let patient=payload.id&&__patientFixtures.find(p=>p.id===payload.id);
     if(!patient){patient={id:'created-'+(__patientWrites.length+1)};__patientFixtures.push(patient)}
     Object.assign(patient,payload,{updated_at:'2026-10-11T12:00:00Z'});
     receipt={patient:JSON.parse(JSON.stringify(patient))};
     __patientReceipts.set(args.p_request_id,receipt);__patientWrites.push({request_id:args.p_request_id,payload});
    }
    if(__patientHoldSave){__patientHoldSave=false;await new Promise(resolve=>window.__releasePatientSave=resolve)}
    if(__patientLostResponses>0){
     --__patientLostResponses;
     if(__patientAfterNetworkFailure)__patientFailure=__patientAfterNetworkFailure;
     if(__patientLostReturned)return {error:{message:'TypeError: Load failed',code:'',details:'',hint:''}};
     throw new TypeError('Load failed');
    }
    return {data:receipt};
   }
   if(name==='crm_management_v5'&&args.p_action==='patient_list'){
    if(__patientListFailures>0){--__patientListFailures;throw new TypeError('Load failed')}
    return {data:JSON.parse(JSON.stringify(__patientFixtures))};
   }
   if(name==='patient_history_v8'){
    if(__patientHistoryFailure)throw new TypeError('Load failed');
    return {data:{procedures:[],sales:[]}};
   }
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[]}:null};
   if(name==='crm_clinical_v10')return {data:{procedures:[],sales:[]}};
   if(name==='crm_finance_v5')return {data:{payment_only:true}};
   return {data:[]};
  };
  await loadPatients();goNewPatient();
 },role);
 await expect(page.locator('#newPatient')).toBeVisible();return errors;
}
const saveButton=page=>page.locator('#newPatient button[onclick="addPatient()"]');
async function draft(page,name='Мария'){
 await page.fill('#pname',name);await page.fill('#pphone','89123456789');
 await page.fill('#pcomplaints','Записать жалобы');await page.fill('#prequest','Плановый приём');
 await page.fill('#pprescriptions','Назначение врача');await page.fill('#pnotes','Не терять эту заметку');
}
const calls=page=>page.evaluate(()=>__patientSaveCalls);
const writes=page=>page.evaluate(()=>__patientWrites);
async function expectDraft(page,name='Мария'){
 await expect(page.locator('#pname')).toHaveValue(name);await expect(page.locator('#pphone')).toHaveValue('89123456789');
 await expect(page.locator('#pcomplaints')).toHaveValue('Записать жалобы');await expect(page.locator('#prequest')).toHaveValue('Плановый приём');
 await expect(page.locator('#pprescriptions')).toHaveValue('Назначение врача');await expect(page.locator('#pnotes')).toHaveValue('Не терять эту заметку');
}

for(const returned of [false,true])test(`a committed patient with one ${returned?'returned Safari':'thrown'} network error retries the identical receipt and opens one card`,async({page})=>{
 const errors=await boot(page,'nurse');await draft(page);await page.evaluate(returned=>{__patientLostResponses=1;__patientLostReturned=returned},returned);await saveButton(page).click();
 await expect(page.locator('#patientCard')).toBeVisible();await expect(page.locator('#patientCardName')).toHaveText('Мария');
 const saved=await calls(page);expect(saved).toHaveLength(2);expect(saved[1]).toEqual(saved[0]);
 expect(saved[0].p_request_id).toMatch(/^[0-9a-f-]{36}$/i);expect((await writes(page))).toHaveLength(1);
 expect(saved[0].p_payload).toMatchObject({full_name:'Мария',phone:'89123456789',complaints:'Записать жалобы',request:'Плановый приём',prescriptions:'Назначение врача',notes:'Не терять эту заметку'});
 expect(errors).toEqual([]);
});

test('two lost responses preserve every draft field and a manual retry reuses the original receipt',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>__patientLostResponses=2);await saveButton(page).click();
 await expect.poll(async()=>((await calls(page)).length)).toBe(2);await expect(saveButton(page)).toBeEnabled();await expectDraft(page);
 await expect(page.locator('#newPatient')).toBeVisible();await expect(page.locator('#patientFormMessageV5')).not.toBeEmpty();
 await expect(page.locator('#pname')).toBeDisabled();await expect(page.locator('#pnotes')).toBeDisabled();
 await saveButton(page).click();await expect(page.locator('#patientCard')).toBeVisible();
 const saved=await calls(page);expect(saved).toHaveLength(3);expect(saved[1]).toEqual(saved[0]);expect(saved[2]).toEqual(saved[0]);expect((await writes(page))).toHaveLength(1);
 expect(errors).toEqual([]);
});

test('a lost patient commit followed by an explicit permission error retains the receipt until recovery',async({page})=>{
 const errors=await boot(page);await draft(page);
 await page.evaluate(()=>{__patientLostResponses=1;__patientAfterNetworkFailure={code:'42501',message:'Нет доступа к сохранению пациента.'}});await saveButton(page).click();
 await expect(page.locator('#patientFormMessageV5')).toContainText('Нет доступа к сохранению пациента.');await expect(saveButton(page)).toBeEnabled();await expectDraft(page);await expect(page.locator('#pname')).toBeDisabled();
 const uncertain=await calls(page);expect(uncertain).toHaveLength(2);expect(uncertain[1]).toEqual(uncertain[0]);expect((await writes(page))).toHaveLength(1);
 await page.evaluate(()=>{__patientFailure=null;__patientAfterNetworkFailure=null});await saveButton(page).click();await expect(page.locator('#patientCardName')).toHaveText('Мария');
 const requests=await calls(page);expect(requests).toHaveLength(3);expect(requests[2]).toEqual(requests[0]);expect((await writes(page))).toHaveLength(1);expect(errors).toEqual([]);
});

test('editing a patient after a lost response resolves the same patient ID without creating another card',async({page})=>{
 const errors=await boot(page);await page.evaluate(async()=>{await openPatient('existing-1');editPatientV5()});
 await expect(page.locator('#newPatient h1')).toContainText('Редактирование');await draft(page,'Анна исправленная');
 await page.evaluate(()=>__patientLostResponses=1);await saveButton(page).click();await expect(page.locator('#patientCardName')).toHaveText('Анна исправленная');
 const saved=await calls(page);expect(saved).toHaveLength(2);expect(saved[1]).toEqual(saved[0]);expect(saved[0].p_payload.id).toBe('existing-1');
 expect((await writes(page))).toHaveLength(1);expect(await page.evaluate(()=>__patientFixtures.length)).toBe(1);expect(errors).toEqual([]);
});

test('a second Save invocation while awaiting the response cannot create a second request',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>{__patientHoldSave=true;void addPatient();void addPatient()});
 await page.waitForFunction(()=>typeof __releasePatientSave==='function');await expect(saveButton(page)).toBeDisabled();expect((await calls(page))).toHaveLength(1);
 await page.evaluate(()=>__releasePatientSave());await expect(page.locator('#patientCard')).toBeVisible();expect((await calls(page))).toHaveLength(1);expect((await writes(page))).toHaveLength(1);expect(errors).toEqual([]);
});

for(const error of [{code:'P0001',message:'Проверьте дату рождения.'},{code:'42501',message:'Нет доступа к сохранению пациента.'}])
test(`a confirmed ${error.code} error preserves the draft and is not retried as a network failure`,async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(error=>__patientFailure=error,error);await saveButton(page).click();
 await expect(page.locator('#patientFormMessageV5')).toContainText(error.message);await expect(saveButton(page)).toBeEnabled();await expectDraft(page);
 expect((await calls(page))).toHaveLength(1);expect((await writes(page))).toHaveLength(0);expect(errors).toEqual([]);
});

test('a patient response after leaving the form does not replace the screen the user opened',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>{__patientHoldSave=true;void addPatient()});await page.waitForFunction(()=>typeof __releasePatientSave==='function');
 await page.evaluate(()=>show('workspace'));await page.evaluate(()=>__releasePatientSave());await expect(saveButton(page)).toBeEnabled();
 await expect(page.locator('#workspace')).toBeVisible();expect((await writes(page))).toHaveLength(1);expect(errors).toEqual([]);
});

test('starting another patient while saving resumes the unresolved draft instead of risking a second card',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>{__patientHoldSave=true;void addPatient()});await page.waitForFunction(()=>typeof __releasePatientSave==='function');
 await page.evaluate(()=>{show('workspace');goNewPatient()});await expect(page.locator('#newPatient')).toBeVisible();await expectDraft(page);await expect(page.locator('#pname')).toBeDisabled();
 await page.evaluate(()=>__releasePatientSave());await expect(saveButton(page)).toBeEnabled();await expect(saveButton(page)).toContainText('Открыть');
 await expect(page.locator('#newPatient')).toBeVisible();await expectDraft(page);await expect(page.locator('#pname')).toBeDisabled();
 await saveButton(page).click();await expect(page.locator('#patientCardName')).toHaveText('Мария');expect((await writes(page))).toHaveLength(1);
 await page.evaluate(()=>goNewPatient());await draft(page,'Другой пациент');
 await saveButton(page).click();await expect(page.locator('#patientCardName')).toHaveText('Другой пациент');
 const saved=await calls(page);expect(saved).toHaveLength(2);expect(saved[1].p_request_id).not.toBe(saved[0].p_request_id);expect((await writes(page))).toHaveLength(2);expect(errors).toEqual([]);
});

test('a save confirmed after leaving can be opened again without another RPC or lost draft',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>{__patientHoldSave=true;void addPatient()});await page.waitForFunction(()=>typeof __releasePatientSave==='function');
 await page.evaluate(()=>show('workspace'));await page.evaluate(()=>__releasePatientSave());await expect(saveButton(page)).toBeEnabled();await expect(page.locator('#workspace')).toBeVisible();
 await page.evaluate(()=>goNewPatient());await expect(page.locator('#newPatient')).toBeVisible();await expectDraft(page);await expect(saveButton(page)).toContainText('Открыть');
 await saveButton(page).click();await expect(page.locator('#patientCardName')).toHaveText('Мария');expect((await calls(page))).toHaveLength(1);expect((await writes(page))).toHaveLength(1);expect(errors).toEqual([]);
});

test('signing out and reentering the same staff account invalidates a late patient response',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>{__patientHoldSave=true;void addPatient()});await page.waitForFunction(()=>typeof __releasePatientSave==='function');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'actor-1',full_name:'Аниса',role:'owner',active:true};goNewPatient()});await draft(page,'Новая сессия');
 await page.evaluate(()=>__releasePatientSave());await expect(saveButton(page)).toBeEnabled();await expect(page.locator('#newPatient')).toBeVisible();await expectDraft(page,'Новая сессия');
 expect(await page.evaluate(()=>patients.some(p=>p.full_name==='Мария'))).toBe(false);expect(errors).toEqual([]);
});

test('a confirmed save survives failed directory refresh and repeating Save never recreates the patient',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>__patientListFailures=2);await saveButton(page).click();
 await expect(saveButton(page)).toBeEnabled();expect((await writes(page))).toHaveLength(1);
 await expect(page.locator('#patientCard')).toBeVisible();await expect(page.locator('#patientCardName')).toHaveText('Мария');
 await expect(page.locator('#patientCardMessageV5')).toContainText('Пациент сохранён.');
 await expect(page.locator('#patientCardMessageV5')).toContainText('Список пока не обновился.');
 await expect(page.locator('#patientCardMessageV5')).toContainText('повторно создавать пациента не нужно');
 expect(await page.evaluate(()=>patients.some(p=>p.id==='created-1'&&p.full_name==='Мария'))).toBe(true);
 await page.evaluate(()=>addPatient());expect((await writes(page))).toHaveLength(1);
 expect(await page.evaluate(()=>__patientFixtures.filter(p=>p.full_name==='Мария').length)).toBe(1);expect(errors).toEqual([]);
});

test('failure to load saved patient history cannot undo or duplicate the confirmed save',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>__patientHistoryFailure=true);await saveButton(page).click();
 await expect(page.locator('#patientCard')).toBeVisible();await expect(page.locator('#patientCardName')).toHaveText('Мария');
 await expect(page.locator('#patientHistory')).toContainText(/загруз|соедин|Load failed/i);
 expect((await writes(page))).toHaveLength(1);expect((await calls(page))).toHaveLength(1);expect(errors).toEqual([]);
});
