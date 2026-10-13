const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';

for(const role of ['admin','nurse'])test(`${role}: patient dose remains visible and escaped in compact history, full card and PDF`,async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);
 await page.evaluate(async role=>{
  currentStaff={id:'dose-history-'+role,full_name:'Проверка дозы',role,active:true};window.__dosePrints=0;window.print=()=>++__dosePrints;
  const patient={id:'dose-history-patient',full_name:'Пациент с индивидуальной дозой'};
  const medication={name:'Препарат из шаблона',dosage:'500 мг / 2 мл',dose:'250 мг <img src=x onerror="window.__unsafeDose=true">',quantity:2,unit:'амп.',unit_price:500,line_total:1000};
  const history={procedures:[{id:'dose-history-procedure',at:'2026-10-13T08:05:00Z',procedure_type:'Капельница',items:[medication],medications:[medication],list_total:1600,charge_total:1300,paid_total:0,debt_total:1300,editable:true}],sales:[]};
  db.rpc=async(name,args={})=>{
   if(name==='crm_management_v5'&&args.p_action==='patient_list')return {data:[patient],error:null};
   if(name==='patient_history_v8'||(name==='crm_clinical_v10'&&args.p_action==='patient_treatments'))return {data:structuredClone(history),error:null};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[]}:null,error:null};
   return {data:[],error:null};
  };
  await loadPatients();await openPatient(patient.id);
 },role);
 const row='Препарат из шаблона · 500 мг / 2 мл × 2 амп. · Доза: 250 мг <img src=x onerror="window.__unsafeDose=true">';
 await expect(page.locator('#patientHistory')).toContainText(row);
 await expect(page.locator('#patientHistory img')).toHaveCount(0);
 await page.click('#patientCardOpenV20');await expect(page.locator('#patientMedicalCardBodyV20')).toContainText(row);
 await expect(page.locator('#patientMedicalCardBodyV20')).toContainText('1 000 ₽');
 await page.click('#patientMedicalCardPrintV20');await expect(page.locator('#patientCardPrintV20')).toContainText(row);
 await expect(page.locator('#patientCardPrintV20 img')).toHaveCount(0);
 expect(await page.evaluate(()=>__dosePrints)).toBe(1);expect(await page.evaluate(()=>window.__unsafeDose||false)).toBe(false);
 expect(errors).toEqual([]);
});
