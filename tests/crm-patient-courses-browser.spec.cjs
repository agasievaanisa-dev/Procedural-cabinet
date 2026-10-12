const {test,expect}=require('@playwright/test');
const path=require('node:path');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);
 if(!await page.evaluate(()=>!!window.CrmPatientCoursesV16?.installed))await page.addScriptTag({path:path.resolve(__dirname,'../crm-patient-courses-v16.js')});
 await page.evaluate(async()=>{
  currentStaff={id:'nurse-a',full_name:'Медсестра',role:'nurse',active:true};
  window.__courses=[];window.__courseCalls=[];window.__courseReceipts=new Map();window.__courseWrites=0;window.__statusWrites=0;
  window.__courseLost=false;window.__courseEmpty=false;window.__courseError=null;window.__courseHold=false;window.__courseListFailures=0;window.__statusLost=false;
  db.rpc=async(name,args={},options={})=>{
   if(name==='crm_management_v5'&&args.p_action==='patient_list')return {data:[{id:'patient-a',full_name:'Первый пациент'},{id:'patient-b',full_name:'Второй пациент'}],error:null};
   if(name==='patient_courses_test'){
    if(__courseListFailures-->0)throw new TypeError('Load failed');return {data:structuredClone(__courses.filter(course=>course.patient_id===args.p_patient_id)),error:null};
   }
   if(name==='add_patient_course_test'){
    __courseCalls.push({name,args:structuredClone(args),options:structuredClone(options)});
    if(__courseError)return {data:null,error:__courseError};
    let receipt=__courseReceipts.get(options.saveRequestIdV16);
    if(!receipt){receipt='course-'+(++__courseWrites);__courseReceipts.set(options.saveRequestIdV16,receipt);__courses.push({id:receipt,patient_id:args.p_patient_id,title:args.p_title,start_date:args.p_start,end_date:args.p_end,plan:args.p_plan,notes:args.p_notes,status:'active'})}
    if(__courseHold){__courseHold=false;await new Promise(resolve=>window.__releaseCourse=resolve)}
    if(__courseLost){__courseLost=false;return {data:null,error:{message:'Ответ о сохранении пока не получен',uncertain:true,retryable:true,recoveryAttemptedV16:true},status:503}}
    if(__courseEmpty){__courseEmpty=false;return {data:null,error:null,status:200}}
    return {data:receipt,error:null,status:200};
   }
   if(name==='set_course_status_test'){
    __courseCalls.push({name,args:structuredClone(args),options:structuredClone(options)});
    if(!__courseReceipts.has(options.saveRequestIdV16)){__courseReceipts.set(options.saveRequestIdV16,{done:true});__courses.find(course=>course.id===args.p_course_id).status=args.p_status;++__statusWrites}
    if(__statusLost){__statusLost=false;return {error:{message:'Ответ о статусе пока не получен',uncertain:true,retryable:true,recoveryAttemptedV16:true},status:503}}
    return {data:null,error:null,status:200};
   }
   if(name==='patient_history_v8'||name==='crm_clinical_v10')return {data:{procedures:[],sales:[]},error:null};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[]}:null,error:null};
   return {data:[],error:null};
  };
  await loadPatients();await openPatient('patient-a');$('patientCard').querySelectorAll('details').forEach(details=>details.open=true);
 });
 return errors;
}
const button=page=>page.locator('#patientCard button[onclick="addCourse()"]');
async function fill(page,title='Новый курс'){
 await page.fill('#courseTitle',title);await page.fill('#courseStart','2026-10-12');await page.fill('#courseEnd','2026-10-20');await page.fill('#coursePlan','Назначение врача');await page.fill('#courseNotes','Не терять заметку');
}

test('a confirmed course remains successful after list refresh failure',async({page})=>{
 const errors=await boot(page);await fill(page);await page.evaluate(()=>__courseListFailures=1);await button(page).click();
 await expect(page.locator('#courseMessageV16')).toContainText('Курс сохранён. Список пока не обновился.');await expect(button(page)).toBeEnabled();await expect(page.locator('#courseTitle')).toHaveValue('');
 expect(await page.evaluate(()=>__courseWrites)).toBe(1);await button(page).click();await expect(page.locator('#courseMessageV16')).toContainText('Укажите название');expect(await page.evaluate(()=>__courseWrites)).toBe(1);expect(errors).toEqual([]);
});

for(const mode of ['lost','empty'])test(`a ${mode} course response preserves one immutable draft and its recovery receipt`,async({page})=>{
 const errors=await boot(page);await fill(page);await page.evaluate(mode=>{if(mode==='lost')__courseLost=true;else __courseEmpty=true},mode);await button(page).click();
 await expect(button(page)).toContainText('Повторить сохранение курса');for(const id of ['courseTitle','courseStart','courseEnd','coursePlan','courseNotes'])await expect(page.locator('#'+id)).toBeDisabled();
 await expect(page.locator('#courseNotes')).toHaveValue('Не терять заметку');await button(page).click();await expect(page.locator('#courseMessageV16')).toHaveText('Курс сохранён.');await expect(page.locator('#patientCourses')).toContainText('Новый курс');
 const state=await page.evaluate(()=>({calls:__courseCalls,writes:__courseWrites}));expect(state.calls).toHaveLength(2);expect(state.calls[1]).toEqual(state.calls[0]);expect(state.calls[0].options.saveRequestIdV16).toMatch(/^[0-9a-f-]{36}$/i);expect(state.writes).toBe(1);expect(errors).toEqual([]);
});

test('double course Save emits one write, and its late confirmation cannot clear another patient',async({page})=>{
 const errors=await boot(page);await fill(page);await page.evaluate(()=>{__courseHold=true;void addCourse();void addCourse()});await page.waitForFunction(()=>typeof __releaseCourse==='function');await expect(button(page)).toBeDisabled();
 await page.evaluate(()=>openPatient('patient-b'));await page.fill('#courseTitle','Курс другого пациента');await page.evaluate(()=>__releaseCourse());
 await expect(page.locator('#patientCardName')).toHaveText('Второй пациент');await expect(page.locator('#courseTitle')).toHaveValue('Курс другого пациента');expect(await page.evaluate(()=>__courseCalls.length)).toBe(1);
 await page.evaluate(()=>openPatient('patient-a'));await expect(button(page)).toContainText('Завершить сохранение');await expect(page.locator('#courseTitle')).toHaveValue('Новый курс');await button(page).click();await expect(page.locator('#courseMessageV16')).toHaveText('Курс сохранён.');expect(await page.evaluate(()=>__courseCalls.length)).toBe(1);expect(errors).toEqual([]);
});

test('a confirmed database validation error keeps course fields editable without another request',async({page})=>{
 const errors=await boot(page);await fill(page);await page.evaluate(()=>__courseError={code:'P0001',message:'Проверьте даты курса'});await button(page).click();
 await expect(page.locator('#courseMessageV16')).toContainText('Проверьте даты курса');await expect(page.locator('#courseTitle')).toBeEnabled();await expect(page.locator('#courseNotes')).toHaveValue('Не терять заметку');expect(await page.evaluate(()=>__courseCalls.length)).toBe(1);expect(await page.evaluate(()=>__courseWrites)).toBe(0);expect(errors).toEqual([]);
});

test('status Save accepts a void reply, caches the result, and separates failed refresh',async({page})=>{
 const errors=await boot(page);await fill(page);await button(page).click();await page.evaluate(()=>__courseListFailures=1);await page.locator('[data-course-status="completed"]').click();
 await expect(page.locator('#courseMessageV16')).toContainText('Статус курса сохранён. Список пока не обновился.');await expect(page.locator('#patientCourses')).toContainText('Завершён');expect(await page.evaluate(()=>__statusWrites)).toBe(1);expect(errors).toEqual([]);
});

test('uncertain course status cannot be replaced with another status and retries the same UUID',async({page})=>{
 const errors=await boot(page);await fill(page);await button(page).click();await page.evaluate(()=>__statusLost=true);await page.locator('[data-course-status="completed"]').click();
 await expect(page.locator('#courseMessageV16')).toContainText('Повторите то же действие');await expect(page.locator('[data-course-status="cancelled"]')).toBeDisabled();await page.locator('[data-course-status="completed"]').click();
 await expect(page.locator('#courseMessageV16')).toHaveText('Статус курса сохранён.');const state=await page.evaluate(()=>({calls:__courseCalls.filter(call=>call.name==='set_course_status_test'),writes:__statusWrites}));expect(state.calls).toHaveLength(2);expect(state.calls[1]).toEqual(state.calls[0]);expect(state.writes).toBe(1);expect(errors).toEqual([]);
});

test('signing out invalidates a late course response even after the same nurse logs in',async({page})=>{
 const errors=await boot(page);await fill(page);await page.evaluate(()=>{__courseHold=true;void addCourse()});await page.waitForFunction(()=>typeof __releaseCourse==='function');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'nurse-a',role:'nurse',full_name:'Медсестра',active:true};await loadPatients();await openPatient('patient-b')});await page.fill('#courseTitle','Черновик новой сессии');await page.evaluate(()=>__releaseCourse());
 await expect(page.locator('#patientCardName')).toHaveText('Второй пациент');await expect(page.locator('#courseTitle')).toHaveValue('Черновик новой сессии');await expect(page.locator('#courseTitle')).toBeEnabled();expect(errors).toEqual([]);
});
