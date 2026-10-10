let quickContext={favorites:[],recent:[],shifts:[]},pendingAction=null,lastTemplate=null,quickBusy=false,patientView4=0,hintView4=0;
const normalizeSearch=v=>String(v||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim();
function matchesMedication(m,q){const hay=normalizeSearch([m.name,m.search_name,m.generic_name,m.dosage,m.category,m.manufacturer,m.manufacturer_country].join(' '));return normalizeSearch(q).split(/\s+/).every(term=>hay.includes(term))}
async function quickRpc(action,payload={}){const {data,error}=await db.rpc('quick_ui_v4',{p_action:action,p_payload:payload});if(error)throw new Error(error.message);return data}
async function loadQuickContext(){quickContext=await quickRpc('context')||{favorites:[],recent:[],shifts:[]}}
function assignShift(s){if(!s)return false;const ns=s.staff||[];if(ns.length<2)return false;shift={id:s.id,aId:ns[0].id,a:ns[0].full_name,bId:ns[1].id,b:ns[1].full_name,type:shiftLabel(s.started_at,s.planned_end_at)};return true}
const originalEnterApp4=enterApp,originalSignOut4=signOut,originalShow4=show;
show=function(id){originalShow4(id);$('accountMenu').open=false;window.scrollTo({top:0,behavior:'instant'})};
enterApp=async function(user){
 await originalEnterApp4(user);
 if(!['admin','owner','nurse'].includes(currentStaff?.role))return;
 $('homeNav').classList.remove('hidden');$('accountMenu').classList.remove('hidden');
 try{await Promise.all([loadPatients(),loadNurses(),loadServices(),loadMeds(),loadQuickContext()]);
  const own=quickContext.shifts.find(s=>(s.staff||[]).some(n=>n.id===currentStaff.id));if(own)assignShift(own);
 }catch(e){message('homeMessage',e.message)}show('workspace');
};
signOut=async function(){await originalSignOut4();quickContext={favorites:[],recent:[],shifts:[]};lastTemplate=null;pendingAction=null;patients=[];$('homeNav').classList.add('hidden');$('accountMenu').classList.add('hidden')};
async function goPatients(){await loadPatients();show('patients')}
function goNewPatient(){show('newPatient');$('pname').focus()}
const originalAddPatient4=addPatient;let patientSaving4=false;
addPatient=async function(){if(patientSaving4)return;patientSaving4=true;const before=patients.length;try{await originalAddPatient4();if(patients.length>before)await openPatient(patients[0].id)}finally{patientSaving4=false}};
renderPatients=function(){const q=normalizeSearch($('patientSearch').value);$('patientList').innerHTML=patients.filter(p=>normalizeSearch(p.full_name+' '+(p.phone||'')).includes(q)).map(p=>`<button class="item click" style="text-align:left" onclick="openPatient('${p.id}')"><strong>${esc(p.full_name)}</strong><div class="small">${esc(p.birth_date||'Дата рождения не указана')} · ${esc(p.phone||'Телефон не указан')}</div></button>`).join('')||'<p>Ничего не найдено.</p>'};
staffOptions=function(){return [[shift.aId,shift.a],[shift.bId,shift.b]].map(x=>`<option value="${x[0]}">${esc(x[1])}</option>`).join('')};
async function openStock(){try{if(isManager()){show('admin');await loadInventory()}else{if(typeof loadAccountingModeV5==='function')await loadAccountingModeV5();show('workStock');await loadMeds();renderWorkStock()}}catch(e){message('homeMessage',e.message)}}
function renderWorkStock(){
 const q=$('workSearch').value,paymentOnly=typeof isPaymentOnlyV5==='function'&&isPaymentOnlyV5();
 const list=meds.filter(m=>matchesMedication(m,q));$('workStock').querySelector('h1').textContent=paymentOnly?'Прайс препаратов':'Препараты в работе';
 const cards=list.map(m=>`<div class="item inventory-heading">${medPhotoHtml(m,'stock-photo')}<div><strong>${esc(m.name)}</strong><div>${esc(m.dosage||'')}</div><b>${paymentOnly?(num(m.sale_price)>0?rub(m.sale_price)+' / '+esc(unit(m)):'Цена не задана'):qty(m.work_qty)+' '+esc(unit(m))}</b><div class="small">${paymentOnly?'Учёт оплаты без складского списания':num(m.work_qty)>0?'В рабочем шкафу':'Нет в рабочем шкафу — обратитесь к администратору'}</div></div></div>`).join('')||'<p>Препараты не найдены.</p>';
 $('workStockList').innerHTML=(paymentOnly?'<div class="notice accounting-mode-v5">Оплата учитывается по прайсу. Количество на складе не ограничивает запись и не меняется.</div>':'')+cards;
}
async function openShiftMenu(){
 try{await loadQuickContext();if(shift&&quickContext.shifts.some(s=>s.id===shift.id)){await openReport();return}
 shift=null;show('shift');await loadNurses();$('openShiftChoices').innerHTML=quickContext.shifts.map(s=>`<button class="btn secondary wide" onclick="selectOpenShift4('${s.id}')">Открытая смена: ${esc((s.staff||[]).map(n=>n.full_name).join(', '))} · ${esc(shiftLabel(s.started_at,s.planned_end_at))}</button>`).join('');
 }catch(e){message('homeMessage',e.message)}
}
async function selectOpenShift4(id){const s=quickContext.shifts.find(x=>x.id===id);if(!assignShift(s))return;const next=pendingAction;pendingAction=null;if(next)await next();else await openReport()}
async function requireShift4(next){
 await loadQuickContext();if(shift&&quickContext.shifts.some(s=>s.id===shift.id))return true;
 shift=null;const own=quickContext.shifts.find(s=>(s.staff||[]).some(n=>n.id===currentStaff.id));if(own&&assignShift(own))return true;
 pendingAction=next;await openShiftMenu();$('shiftMessage').textContent='Для записи процедуры или продажи начните смену или выберите открытую.';return false;
}
startShift=async function(){
 if(quickBusy)return;quickBusy=true;$('shiftMessage').textContent='Открываем смену…';
 try{const date=$('shiftDate').value||localDateValue(),st=$('shiftStartTime').value||'08:30',et=$('shiftEndTime').value||'16:00';const start=new Date(`${date}T${st}:00`),end=new Date(`${date}T${et}:00`);if(end<=start)end.setDate(end.getDate()+1);
 const {data,error}=await db.rpc('start_shift_v82',{p_shift_date:date,p_started_at:start.toISOString(),p_planned_end_at:end.toISOString(),p_nurse1:$('n1').value,p_nurse2:$('n2').value});if(error)throw Error(error.message);
 await loadQuickContext();if(!assignShift(quickContext.shifts.find(s=>s.id===data)))throw Error('Смена создана. Откройте её в меню «Смена и отчёт».');
 const next=pendingAction;pendingAction=null;if(next)await next();else show('workspace');
 }catch(e){$('shiftMessage').textContent=e.message}finally{quickBusy=false}
};
function sortedCatalog4(list){const favorites=new Set(quickContext.favorites||[]),recent=new Map((quickContext.recent||[]).map(x=>[x.id,x.count]));return [...list].sort((a,b)=>Number(favorites.has(b.id))-Number(favorites.has(a.id))||(recent.get(b.id)||0)-(recent.get(a.id)||0)||a.name.localeCompare(b.name,'ru'))}
filterMedicationRows=function(target,q){renderMedVisualCatalog(target,q)};
renderMedVisualCatalog=function(target,q=''){
 const panel=$(target==='procMeds'?'procPhotoCatalog':'salePhotoCatalog'),favorites=new Set(quickContext.favorites||[]),paymentOnly=typeof isPaymentOnlyV5==='function'&&isPaymentOnlyV5(target==='procMeds'?'proc':'sale');const matches=sortedCatalog4(meds.filter(m=>matchesMedication(m,q)));let group='';
 panel.innerHTML=matches.slice(0,q?40:12).map(m=>{const g=favorites.has(m.id)?'⭐ Избранные':(quickContext.recent||[]).some(x=>x.id===m.id)?'Недавно использовали':'Препараты';const heading=!q&&g!==group?`<h3 class="catalog-group">${g}</h3>`:'';group=g;
 return `${heading}<div class="med-tile ${(!paymentOnly&&num(m.work_qty)<=0)||(paymentOnly&&num(m.sale_price)<=0)?'empty':''}"><button class="favorite-toggle" aria-label="${favorites.has(m.id)?'Убрать из избранного':'В избранное'}: ${esc(m.name)}" aria-pressed="${favorites.has(m.id)}" onclick="toggleFavorite4('${m.id}','${target}')">${favorites.has(m.id)?'★':'☆'}</button><button class="photo-choice" onclick="chooseMedication('${target}','${m.id}')">${medPhotoHtml(m)}<span><strong>${esc(m.name)}</strong><small>${esc(m.dosage||m.search_name||'')}</small><small>${paymentOnly?(num(m.sale_price)>0?rub(m.sale_price)+' / '+esc(unit(m)):'Цена не задана'):qty(m.work_qty)+' '+esc(unit(m))+' в шкафу'}</small></span></button></div>`;
 }).join('')||'<p class="catalog-group">Не найдено. Попробуйте название, дозировку или категорию.</p>';
 if(!q&&matches.length>12)panel.innerHTML+='<p class="catalog-group small">Остальные препараты найдутся через поиск.</p>';
};
async function toggleFavorite4(id,target){if(quickBusy)return;quickBusy=true;try{const selected=!(quickContext.favorites||[]).includes(id);await quickRpc('favorite',{id,selected});quickContext.favorites=selected?[...quickContext.favorites,id]:quickContext.favorites.filter(x=>x!==id);renderMedVisualCatalog(target,$(target==='procMeds'?'procMedSearch':'saleMedSearch').value)}catch(e){message(target==='procMeds'?'procedureMessage':'saleMessage',e.message)}finally{quickBusy=false}}
addMedRow=function(target,id='',amount=1,fallback=null){
 const m=meds.find(x=>x.id===id)||fallback;if(!m)return;
 const d=document.createElement('div');d.className='medrow';d.dataset.medicationId=id;
 d.innerHTML=`<div class="medphoto">${medPhotoHtml(m)}</div><div class="chosen-name"><strong>${esc(m.name)}</strong><small>${esc(m.dosage||'')} · ${esc(unit(m))}</small><small class="stock-hint"></small></div><select class="medsel" aria-label="Препарат"><option value="${esc(id)}" selected>${esc(m.name)}</option></select><input class="medqty" aria-label="Количество: ${esc(m.name)}" type="number" inputmode="numeric" min="1" step="1" value="${Number(amount)}" oninput="recalc()"><button class="btn danger" aria-label="Убрать: ${esc(m.name)}" onclick="this.parentElement.remove();recalc()">×</button>`;
 $(target).appendChild(d);recalc();
};
chooseMedication=function(target,id){const row=[...$(target).querySelectorAll('.medrow')].find(r=>r.dataset.medicationId===id);if(row)row.querySelector('.medqty').value=num(row.querySelector('.medqty').value)+1;else addMedRow(target,id);recalc()};
const originalRecalc4=recalc;
function renderTreatmentAvailability4(){for(const target of ['procMeds','saleMeds']){
 const paymentOnly=typeof isPaymentOnlyV5==='function'&&isPaymentOnlyV5(target==='procMeds'?'proc':'sale');
 const total=new Map();rows(target).forEach(x=>total.set(x.medication_id,(total.get(x.medication_id)||0)+x.quantity));
 $(target).querySelectorAll('.medrow').forEach(r=>{const m=meds.find(x=>x.id===r.dataset.medicationId),n=total.get(r.dataset.medicationId),missing=!m||(paymentOnly?num(m.sale_price)<=0:n>num(m.work_qty));r.classList.toggle('short',missing);const h=r.querySelector('.stock-hint');if(h)h.textContent=!m?'Препарат недоступен':paymentOnly?(num(m.sale_price)>0?`${rub(m.sale_price)} / ${unit(m)} · без списания со склада`:'Цена не задана — обратитесь к владельцу'):missing?`Не хватает ${qty(n-num(m.work_qty))} ${unit(m)} в шкафу`:`В шкафу: ${qty(m.work_qty)} ${unit(m)}`});
 }renderShortages4();}
recalc=function(){originalRecalc4();renderTreatmentAvailability4()};
function renderShortages4(){
 const kind=$('procedure').classList.contains('active')?'proc':$('sale').classList.contains('active')?'sale':null;if(!kind)return;const host=$(kind+'Meds');let box=$(kind+'Shortage');if(!box){box=document.createElement('div');box.id=kind+'Shortage';host.after(box)}
 if(typeof isPaymentOnlyV5==='function'&&isPaymentOnlyV5(kind)){box.innerHTML='';return}
 const missing=rows(kind+'Meds').map(x=>({...x,m:meds.find(m=>m.id===x.medication_id)})).filter(x=>!x.m||x.quantity>num(x.m.work_qty));
 box.innerHTML=missing.map(x=>{const stock=isManager()?inventory.find(m=>m.id===x.medication_id):null;const amount=stock?Math.ceil((x.quantity-num(x.m?.work_qty))/packSize(stock))*packSize(stock):0;
 return `<div class="shortage">${esc(x.m?.name||'Препарат')}: недостаточно в рабочем шкафу. ${stock&&amount<=num(stock.reserve_available??stock.reserve_qty)?`<button class="btn secondary" onclick="quickTransfer4('${stock.id}',${amount})">Перевести ${qty(amount/packSize(stock))} уп. из запаса</button>`:isManager()?'Оформите приход или проверьте запас.':'Обратитесь к администратору для пополнения.'}</div>`}).join('');
}
async function prepareTreatment4(kind,patientId){
 if(!await requireShift4(()=>prepareTreatment4(kind,patientId)))return false;
 await Promise.all([loadMeds(),loadPatients(),loadServices(),isManager()?loadInventory():Promise.resolve()]);
 const p=kind==='procedure'?'proc':'sale';$(p+'Nurse').innerHTML=staffOptions();if([shift.aId,shift.bId].includes(currentStaff.id))$(p+'Nurse').value=currentStaff.id;
 $(p+'Patient').innerHTML=patientOptions(true).replace('Без пациента',p==='proc'?'Выберите пациента':'Без пациента');if(patientId)$(p+'Patient').value=patientId;
 if(p==='proc')$('procService').innerHTML='<option value="">Выберите услугу</option>'+services.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
 for(const suffix of ['Notes','Paid','DiscountReason','DiscountComment','MedSearch'])$(p+suffix).value='';$(p+'Meds').innerHTML='';message(kind+'Message','');show(kind);renderMedVisualCatalog(p+'Meds');if(p==='proc'){calcProcedure();await showRepeatHint()}else calcSale();recalc();return true;
}
openProcedure=async function(patientId=null){try{await prepareTreatment4('procedure',patientId)}catch(e){message('homeMessage',e.message)}};
openSale=async function(){try{await prepareTreatment4('sale',null)}catch(e){message('homeMessage',e.message)}};
const originalSaveTreatment4=saveTreatment;
saveTreatment=async function(kind){
 const p=kind==='procedure'?'proc':'sale';try{
  if(kind==='procedure'&&(!$('procPatient').value||!$('procService').value))throw Error('Выберите пациента и услугу');
  const paymentOnly=typeof isPaymentOnlyV5==='function'&&isPaymentOnlyV5(p),selected=rows(p+'Meds');for(const x of selected){const m=meds.find(m=>m.id===x.medication_id);if(!m||(!paymentOnly&&x.quantity>num(m.work_qty)))throw Error('Недостаточно препарата в рабочем шкафу. Сначала пополните шкаф или исправьте количество.');if(paymentOnly&&num(m.sale_price)<=0)throw Error('У препарата не указана цена продажи. Владелец может добавить её в карточке препарата.')}
  await originalSaveTreatment4(kind);
  if($('workspace').classList.contains('active'))message('homeMessage',(kind==='procedure'?'Процедура сохранена. ':'Продажа сохранена. ')+(paymentOnly?'Оплата учтена, остатки склада не изменены.':'Препараты списаны.'),true);
 }catch(e){message(kind+'Message',e.message)}
};
function templateText4(t){return `${new Date(t.at).toLocaleDateString('ru-RU')} · ${esc(t.service_name||'Процедура')}${t.stock_deducted===false?' · без списания со склада':''}<br>${(t.items||[]).map(m=>`${esc(m.name)} × ${qty(m.quantity)} ${esc(m.unit||'')}`).join(', ')||'Без препаратов'}`}
async function showRepeatHint(){const token=++hintView4,id=$('procPatient').value;$('repeatHint').innerHTML='';if(!id)return;try{const t=await quickRpc('last_procedure',{patient_id:id});if(token!==hintView4)return;if(t)$('repeatHint').innerHTML=`<div class="card"><span class="small">Последняя процедура</span><p>${templateText4(t)}</p><button class="btn secondary" onclick="repeatLast4('${id}')">Повторить прошлую процедуру</button></div>`}catch(e){message('repeatHint',e.message)}}
const originalOpenPatient4=openPatient;
openPatient=async function(id){const token=++patientView4;lastTemplate=null;$('lastProcedure').textContent='Загружаем последнюю процедуру…';await originalOpenPatient4(id);try{const t=await quickRpc('last_procedure',{patient_id:id});if(token!==patientView4||currentPatientId!==id)return;lastTemplate=t;$('lastProcedure').innerHTML=t?`<span class="small">Последняя процедура</span><p>${templateText4(t)}</p><button class="btn primary wide" onclick="repeatLast4('${id}')">Повторить прошлую процедуру</button>`:'Процедур пока нет.'}catch(e){$('lastProcedure').textContent=e.message}};
async function repeatLast4(id){
 try{if(!await requireShift4(()=>repeatLast4(id)))return;const t=await quickRpc('last_procedure',{patient_id:id});if(!t)return;
 await prepareTreatment4('procedure',id);$('procMeds').innerHTML='';$('procService').value=services.some(s=>s.id===t.service_id)?t.service_id:'';
 (t.items||[]).forEach(m=>addMedRow('procMeds',m.medication_id,m.quantity,{id:m.medication_id,name:m.name,consumption_unit:m.unit}));
 // Current prices, current nurse and no inherited discount/payment/notes.
 calcProcedure();recalc();message('procedureMessage','Черновик заполнен по прошлой процедуре. Проверьте назначение, препараты, количество и оплату перед сохранением.');
 if(!$('procService').value)message('repeatHint','Прежняя услуга недоступна. Выберите действующую услугу из прайса.');
 }catch(e){message('procedureMessage',e.message)}
}
async function quickTransfer4(id,quantity){
 if(quickBusy||!isManager())return;quickBusy=true;try{await warehouseRpc('transfer',{id,quantity,comment:'Быстрое пополнение рабочего шкафа'},true);await Promise.all([loadInventory(),loadMeds()]);
 const prefix=$('procedure').classList.contains('active')?'proc':$('sale').classList.contains('active')?'sale':null,paid=prefix?$(prefix+'Paid').value:null;
 recalc();if(prefix){$(prefix+'Paid').value=paid;prefix==='proc'?calcProcedure(false):calcSale(false);renderMedVisualCatalog(prefix+'Meds',$(prefix+'MedSearch').value)}
 message(prefix==='proc'?'procedureMessage':prefix==='sale'?'saleMessage':'warehouseMessage','Рабочий шкаф пополнен.',true)}catch(e){const active=$('procedure').classList.contains('active')?'procedureMessage':$('sale').classList.contains('active')?'saleMessage':'warehouseMessage';message(active,e.message)}finally{quickBusy=false}
}
const originalRenderInventory4=renderInventory;
renderInventory=function(){originalRenderInventory4();$('inventoryNudges').innerHTML=inventory.filter(m=>m.active!==false&&num(m.work_available??m.work_qty)<num(m.work_threshold)&&num(m.reserve_available??m.reserve_qty)>=packSize(m)).slice(0,5).map(m=>`<div class="quick-alert"><strong>${esc(m.name)}</strong> · в шкафу ${qty(m.work_available??m.work_qty)} ${esc(unit(m))}<button class="btn primary wide" onclick="quickTransfer4('${m.id}',${packSize(m)})">Перевести 1 упаковку (${qty(packSize(m))} ${esc(unit(m))})</button></div>`).join('')};
const originalOpenMedForm4=openMedForm;
openMedForm=function(id='',focus=''){originalOpenMedForm4(id,focus);$('medDetails').open=!id||focus==='prices';if(id&&!focus)$('openingPanel').open=stockFacts(inventory.find(m=>m.id===id)).total===0};
const originalStockCells4=stockCells;
stockCells=function(m){const days=expiryDays(m.nearest_expiry);return originalStockCells4(m)+(days!==null&&days<=30?`<div class="notice">${days<0?'Есть партия с истёкшим сроком. Проверьте партии и оформите списание.':`Ближайший срок годности — через ${days} дн. При расходе программа выберет эту годную партию первой.`}</div>`:'')};
let photosLoadedAt4=0;const originalSignPhotos4=signMedicationPhotos;
signMedicationPhotos=async function(items){if(Date.now()-photosLoadedAt4>20*60*1000){medPhotoUrls.clear();photosLoadedAt4=Date.now()}await originalSignPhotos4(items)};
let reportId4=null;
function renderReport4(data,closed=false){
 const used=data.used||[];$('reportBody').innerHTML=`${closed?'<div class="notice success">Смена закрыта. Итог сохранён.</div>':''}<p class="small">${esc(data.shift?.date||'')} · ${esc(shiftLabel(data.shift?.started_at,data.shift?.ended_at||data.shift?.planned_end_at))}</p><div class="stats"><div class="stat">Пациентов<b>${num(data.patients_count)}</b></div><div class="stat">Процедур<b>${num(data.procedures_count)}</b></div><div class="stat">Оплачено<b>${rub(data.cash_total)}</b></div></div><h2>Списано препаратов</h2><div class="report-used">${used.map(m=>`<div class="item"><div><strong>${esc(m.name)}</strong><div class="small">Процедуры: ${qty(m.procedure_qty)} · продажи: ${qty(m.sale_qty)}</div></div><strong>${qty(m.quantity)} ${esc(m.unit)}</strong></div>`).join('')||'<p>Списаний нет.</p>'}</div><details><summary>По сотрудникам</summary>${(data.by_nurse||[]).map(n=>`<div class="item"><strong>${esc(n.nurse)}</strong> · ${num(n.procedures_count)} процедур · ${rub(n.total)}</div>`).join('')}</details><details><summary>Все операции</summary>${[...(data.procedures||[]).map(x=>({...x,kind:'Процедура'})),...(data.sales||[]).map(x=>({...x,kind:'Продажа'}))].sort((a,b)=>new Date(a.at)-new Date(b.at)).map(x=>`<div class="item"><strong>${x.kind}: ${esc(x.patient||'Без пациента')}</strong><div>${esc(x.type||'')} · ${rub(x.paid)}</div><div class="small">${esc(x.nurse||'')} · ${(x.items||[]).map(m=>`${esc(m.name)} × ${qty(m.quantity)}`).join(', ')}</div></div>`).join('')||'<p>Операций нет.</p>'}</details>`;
 $('report').querySelector('button[onclick="closeShift()"]').classList.toggle('hidden',closed||data.shift?.status!=='open');show('report');
}
openReport=async function(){try{if(!shift){await openShiftMenu();return}reportId4=shift.id;const r=await quickRpc('report',{shift_id:reportId4});renderReport4(r)}catch(e){message('homeMessage',e.message)}};
closeShift=async function(){if(quickBusy||!reportId4)return;quickBusy=true;try{const r=await quickRpc('close',{shift_id:reportId4});shift=null;renderReport4(r,true);await loadQuickContext()}catch(e){$('reportBody').insertAdjacentHTML('afterbegin',`<div class="notice">${esc(e.message)}</div>`)}finally{quickBusy=false}};
