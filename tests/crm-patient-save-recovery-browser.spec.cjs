const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);
 await page.evaluate(async()=>{
  currentStaff={id:'owner-a',full_name:'Администратор',role:'admin',active:true};
  window.__patientRows=[{id:'patient-a',full_name:'Тестовый пациент',archived:false,updated_at:'2026-10-12T10:00:00Z'},{id:'patient-b',full_name:'Другой пациент',archived:false,updated_at:'2026-10-12T10:00:00Z'}];
  window.__patientCalls=[];window.__patientReceipts=new Map();window.__patientWrites=[];window.__badPatientReplies=0;window.__badPatientMode='null';
  window.__archiveCalls=[];window.__archiveReceipts=new Map();window.__archiveWrites=0;window.__archiveLost=false;window.__archiveHold=false;
  window.__listFailures=0;window.__documentListFailures=0;window.__documentCalls=0;window.__documentLost=false;window.__documentWrites=0;window.__uploadedPaths=[];
  window.SaveRecoveryV16={isRetryable:(error,status)=>!!(error?.retryable||error?.uncertain||(!error?.code&&([0,502,503,504].includes(Number(status))||/Load failed|Failed to fetch/.test(error?.message||''))))};
  db.storage={from:()=>({upload:async path=>{__uploadedPaths.push(path);return {data:{path},error:null}},remove:async()=>({error:null})})};
  db.rpc=async(name,args={},options={})=>{
   if(name==='crm_patient_save_v11'){
    __patientCalls.push(structuredClone(args));let receipt=__patientReceipts.get(args.p_request_id);
    if(!receipt){receipt={...args.p_payload,id:args.p_payload.id||'patient-created',updated_at:'2026-10-12T12:00:00Z'};__patientRows.push(receipt);__patientReceipts.set(args.p_request_id,receipt);__patientWrites.push(receipt)}
    if(__badPatientReplies-->0)return __badPatientMode==='null'?{data:null,error:null,status:200}:{data:null,error:{code:'',message:'Unexpected gateway response'},status:503};
    return {data:structuredClone(receipt),error:null,status:200};
   }
   if(name==='crm_management_v5'&&args.p_action==='patient_list'){
    if(__listFailures-->0)throw new TypeError('Load failed');return {data:structuredClone(__patientRows.filter(row=>args.p_payload.include_archived||!row.archived)),error:null};
   }
   if(name==='crm_management_v5'&&args.p_action==='patient_archive'){
    __archiveCalls.push({args:structuredClone(args),options:structuredClone(options)});
    let receipt=__archiveReceipts.get(options.saveRequestIdV16);
    if(!receipt){const row=__patientRows.find(row=>row.id===args.p_payload.id);Object.assign(row,{archived:args.p_payload.archived,archived_at:args.p_payload.archived?'2026-10-12T12:00:00Z':null});receipt=structuredClone(row);__archiveReceipts.set(options.saveRequestIdV16,receipt);++__archiveWrites}
    if(__archiveHold){__archiveHold=false;await new Promise(resolve=>window.__releaseArchive=resolve)}
    if(__archiveLost){__archiveLost=false;return {error:{message:'Ответ пока не получен',uncertain:true,retryable:true,recoveryAttemptedV16:true},status:503}}
    return {data:receipt,error:null};
   }
   if(name==='register_patient_file_v8'){
    ++__documentCalls;if(__documentWrites===0)++__documentWrites;
    if(__documentLost){__documentLost=false;throw new TypeError('Load failed')}
    return {data:'document-a',error:null};
   }
   if(name==='patient_files_v8'){
    if(__documentListFailures-->0)throw new TypeError('Load failed');return {data:[],error:null};
   }
   if(name==='patient_history_v8'||name==='crm_clinical_v10')return {data:{procedures:[],sales:[]},error:null};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[]}:null,error:null};
   return {data:[],error:null};
  };
  await loadPatients();await openPatient('patient-a');$('patientCard').querySelectorAll('details').forEach(details=>details.open=true);
 });
 return errors;
}

for(const mode of ['null','gateway'])test(`patient save recovers a ${mode} response with its original receipt`,async({page})=>{
 const errors=await boot(page);await page.evaluate(mode=>{goNewPatient();__badPatientReplies=1;__badPatientMode=mode},mode);
 await page.fill('#pname','Сохранённый один раз');await page.fill('#pnotes','Сохранить заметку');await page.click('#newPatient button[onclick="addPatient()"]');
 await expect(page.locator('#patientCardName')).toHaveText('Сохранённый один раз');
 const state=await page.evaluate(()=>({calls:__patientCalls,writes:__patientWrites}));expect(state.calls).toHaveLength(2);expect(state.calls[1]).toEqual(state.calls[0]);expect(state.writes).toHaveLength(1);expect(errors).toEqual([]);
});

test('confirmed patient archival stays successful when its directory refresh fails',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>__listFailures=2);await page.click('#patientArchiveV5');
 await expect(page.locator('#patientCardMessageV5')).toContainText('Пациент в архиве.');await expect(page.locator('#patientCardMessageV5')).toContainText('Повторно сохранять не нужно.');
 expect(await page.evaluate(()=>__archiveWrites)).toBe(1);expect(await page.evaluate(()=>patients.some(row=>row.id==='patient-a'))).toBe(false);expect(errors).toEqual([]);
});

test('uncertain patient archival retries the same desired state and fixed recovery UUID',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>__archiveLost=true);await page.click('#patientArchiveV5');
 await expect(page.locator('#patientCardMessageV5')).toContainText('Повторите действие');await page.click('#patientArchiveV5');
 await expect(page.locator('#patientCardMessageV5')).toContainText('Пациент в архиве.');
 const state=await page.evaluate(()=>({calls:__archiveCalls,writes:__archiveWrites}));expect(state.calls).toHaveLength(2);expect(state.calls[1]).toEqual(state.calls[0]);expect(state.calls[0].options.saveRequestIdV16).toMatch(/^[0-9a-f-]{36}$/i);expect(state.writes).toBe(1);expect(errors).toEqual([]);
});

test('late archival confirmation leaves another patient card and its fields untouched',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__archiveHold=true;void archivePatientV5()});await page.waitForFunction(()=>typeof __releaseArchive==='function');
 await page.evaluate(()=>openPatient('patient-b'));await page.fill('#courseTitle','Не трогать новый курс');await page.evaluate(()=>__releaseArchive());
 await expect(page.locator('#patientCardName')).toHaveText('Другой пациент');await expect(page.locator('#courseTitle')).toHaveValue('Не трогать новый курс');expect(await page.evaluate(()=>__archiveWrites)).toBe(1);expect(errors).toEqual([]);
});

test('committed document registration recovers by the same uploaded path, without a second upload',async({page})=>{
 const errors=await boot(page);await page.fill('#docTitle','Тестовый анализ');await page.setInputFiles('#docFile',{name:'analysis.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 test')});
 await page.evaluate(()=>__documentLost=true);await page.click('#patientCard button[onclick="uploadPatientDocument()"]');
 await expect(page.locator('#docMessage')).toHaveText('Документ прикреплён.');expect(await page.evaluate(()=>__documentCalls)).toBe(2);expect(await page.evaluate(()=>__documentWrites)).toBe(1);expect(await page.evaluate(()=>__uploadedPaths.length)).toBe(1);expect(errors).toEqual([]);
});

test('document list refresh failure cannot relabel a confirmed attachment as a save failure',async({page})=>{
 const errors=await boot(page);await page.fill('#docTitle','Тестовый анализ');await page.setInputFiles('#docFile',{name:'analysis.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 test')});
 await page.evaluate(()=>__documentListFailures=1);await page.click('#patientCard button[onclick="uploadPatientDocument()"]');
 await expect(page.locator('#docMessage')).toContainText('Документ прикреплён. Список пока не обновился.');expect(await page.evaluate(()=>__documentWrites)).toBe(1);expect(await page.evaluate(()=>__uploadedPaths.length)).toBe(1);expect(errors).toEqual([]);
});
