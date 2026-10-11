const {test,expect}=require('@playwright/test');
async function boot(page,role='owner'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',r=>r.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})},rpc:async()=>({data:[]})})}'}));
 await page.goto('/');
 await page.evaluate(async role=>{
  window.deleteCalls=[];window.confirmations=[];window.deleteFailure=false;window.holdDelete=false;window.holdPatients=false;
  window.patientFixtures=[{id:'p1',full_name:'Анна',updated_at:'2026-10-11T10:00:00Z'},{id:'p2',full_name:'Ольга',updated_at:'2026-10-11T11:00:00Z'},{id:'removed',full_name:'Удалённая',deleted_at:'2026-10-11T12:00:00Z',archived:true}];
  currentStaff={id:role+'-1',full_name:role==='owner'?'Аниса':'Наталья',role};
  window.confirm=text=>{confirmations.push(text);return window.confirmResult!==false};
  db.rpc=async(name,args={})=>{
   if(name==='crm_patient_delete_v10'){
    deleteCalls.push(args.p_payload);
    if(holdDelete)await new Promise(resolve=>window.releaseDelete=resolve);
    if(deleteFailure)return {error:{message:'TypeError: Load failed'}};
    const p=patientFixtures.find(p=>p.id===args.p_payload.id);p.deleted_at='2026-10-11T12:00:00Z';return {data:{id:p.id,deleted_at:p.deleted_at}};
   }
   if(name==='crm_management_v5'&&args.p_action==='patient_list'){
    if(holdPatients)await new Promise(resolve=>window.releasePatients=resolve);
    // Deliberately return a deleted card to prove clients also reject stale data.
    return {data:patientFixtures};
   }
   if(name==='patient_history_v8')return {data:{procedures:[{id:'old-1',visit_at:'2026-10-01T12:00:00Z',paid_total:100,procedure_type:'Укол',medications:[]}],sales:[]}};
   if(name==='patient_files_v8'||name==='patient_courses_test')return {data:[]};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[]}:null};
   if(name==='crm_clinical_v10')return {data:{procedures:[],sales:[]}};
   return {data:[]};
  };
  await loadPatients();await openPatient('p1');
 },role);
 return errors;
}
test('only owner can remove a patient; confirmation preserves history and no old card remains selectable',async({page})=>{
 const errors=await boot(page,'nurse');await expect(page.locator('#patientDeleteV10')).toBeHidden();
 await page.evaluate(()=>deletePatientV10());expect(await page.evaluate(()=>deleteCalls.length)).toBe(0);
 await page.evaluate(async()=>{currentStaff={id:'owner-1',role:'owner',full_name:'Аниса'};await loadPatients();await openPatient('p1')});
 await page.evaluate(()=>window.confirmResult=false);await page.click('#patientDeleteV10');expect(await page.evaluate(()=>deleteCalls.length)).toBe(0);
 await page.evaluate(()=>window.confirmResult=true);await page.click('#patientDeleteV10');await expect(page.locator('#patients')).toBeVisible();
 expect(await page.evaluate(()=>deleteCalls.length)).toBe(1);
 expect(await page.evaluate(()=>confirmations.at(-1))).toMatch(/История процедур и оплат останется.*Документы сохранятся/);
 await expect(page.locator('[data-patient-id="p1"]')).toHaveCount(0);await expect(page.locator('[data-patient-id="removed"]')).toHaveCount(0);
 expect(await page.evaluate(()=>patientOptions())).not.toContain('p1');expect(await page.evaluate(()=>patientOptions())).not.toContain('removed');
 expect(errors).toEqual([]);
});
test('uncertain deletion retry reuses the same request and selected version',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>window.deleteFailure=true);await page.click('#patientDeleteV10');
 await expect(page.locator('#patientCardMessageV5')).toContainText('Load failed');await expect(page.locator('#patientCard')).toBeVisible();
 await page.evaluate(()=>window.deleteFailure=false);await page.click('#patientDeleteV10');await expect(page.locator('#patients')).toBeVisible();
 expect(await page.evaluate(()=>deleteCalls[0].request_id)).toBe(await page.evaluate(()=>deleteCalls[1].request_id));
 expect(await page.evaluate(()=>deleteCalls[0].expected_updated_at)).toBe('2026-10-11T10:00:00Z');expect(errors).toEqual([]);
});
test('patient deletion finishing after navigation does not replace the current screen or another patient',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{window.holdDelete=true;void deletePatientV10()});await page.waitForFunction(()=>typeof releaseDelete==='function');
 await page.evaluate(()=>show('workspace'));await page.evaluate(()=>releaseDelete());await expect(page.locator('#workspace')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>patients.some(p=>p.id==='p1'))).toBe(false);
 await page.evaluate(()=>openPatient('p2'));await expect(page.locator('#patientCardName')).toHaveText('Ольга');expect(errors).toEqual([]);
});
test('patient list opens immediately and a late load cannot replace the new-patient form',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{window.holdPatients=true;void goPatients()});await expect(page.locator('#patients')).toBeVisible();
 await page.waitForFunction(()=>typeof releasePatients==='function');await page.evaluate(()=>goNewPatient());await expect(page.locator('#newPatient')).toBeVisible();
 await page.evaluate(()=>releasePatients());await expect(page.locator('#newPatient')).toBeVisible();expect(errors).toEqual([]);
});
test('a patient list captured before deletion cannot resurrect a removed card',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{
  const original=db.rpc,captured=JSON.parse(JSON.stringify(patientFixtures));
  db.rpc=async(name,args)=>name==='crm_management_v5'&&args.p_action==='patient_list'?
   new Promise(resolve=>window.releaseOldList=()=>resolve({data:captured})):original(name,args);
  window.pendingList=loadPatients();
 });
 await page.waitForFunction(()=>typeof releaseOldList==='function');await page.click('#patientDeleteV10');await expect(page.locator('#patients')).toBeVisible();
 await page.evaluate(async()=>{releaseOldList();await pendingList;renderPatients()});
 await expect(page.locator('[data-patient-id="p1"]')).toHaveCount(0);expect(await page.evaluate(()=>patientOptions())).not.toContain('p1');expect(errors).toEqual([]);
});
