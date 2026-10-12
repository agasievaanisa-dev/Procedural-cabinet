/* Patient course saves retain one request until its server receipt is confirmed. */
(function (global) {
 'use strict';
 if (typeof document === 'undefined') return;
 if (global.CrmPatientCoursesV16?.installed) return;
 global.CrmPatientCoursesV16 = {installed:true};
 let session = 0, cardVersion = 0;
 const drafts = new Map(), statusDrafts = new Map(), lists = new Map(), listVersions = new Map(), busy = new Set();
 const fieldIds = ['courseTitle','courseStart','courseEnd','coursePlan','courseNotes'];
 const actorKey = () => JSON.stringify([currentStaff?.id,currentStaff?.role,session]);
 const allowed = () => ['owner','admin','nurse'].includes(currentStaff?.role);
 const archived = patient => !!(patient?.archived_at || patient?.archived || patient?.is_archived || patient?.deleted_at);
 const patient = id => patients.find(item => item.id === id);
 const readonly = id => !patient(id) || archived(patient(id));
 const keyFor = id => JSON.stringify([actorKey(),id]);
 function assertActor(actor) { if (!allowed() || actor !== actorKey()) throw Error('Учётная запись изменилась. Откройте карточку пациента заново.'); }
 function stillCurrent(actor,id,view,navigation) {
  return actor === actorKey() && currentPatientId === id && cardVersion === view && $('patientCard').classList.contains('active') &&
   (navigation === null || navigation === quickNavigation4);
 }
 function ensureMessage() {
  if (!$('courseMessageV16')) {
   const box = document.createElement('div'); box.id = 'courseMessageV16'; box.setAttribute('role','status'); box.setAttribute('aria-live','polite');
   $('patientCard').querySelector('button[onclick="addCourse()"]').after(box);
  }
 }
 function courseMessage(text,success = false) { ensureMessage(); message('courseMessageV16',text,success); }
 function controls(id = currentPatientId) {
  const key = keyFor(id), draft = drafts.get(key), frozen = !!draft, readOnly = readonly(id);
  fieldIds.forEach(field => { $(field).disabled = frozen || readOnly; });
  const button = $('patientCard').querySelector('button[onclick="addCourse()"]');
  button.disabled = busy.has(key) || readOnly;
  button.textContent = draft?.confirmed ? 'Завершить сохранение курса' : draft?.uncertain ? 'Повторить сохранение курса' : 'Добавить курс';
  $('patientCourses').querySelectorAll('[data-course-id]').forEach(button => {
   const statusKey = JSON.stringify([key,button.dataset.courseId]);
   const pending = statusDrafts.get(statusKey);
   button.disabled = readOnly || busy.has(statusKey) || (!!pending && pending.args.p_status !== button.dataset.courseStatus);
  });
 }
 function restoreDraft(id) {
  ensureMessage(); const draft = drafts.get(keyFor(id));
  if (draft) {
   const values = {courseTitle:draft.args.p_title,courseStart:draft.args.p_start,courseEnd:draft.args.p_end,coursePlan:draft.args.p_plan,courseNotes:draft.args.p_notes};
   fieldIds.forEach(field => { $(field).value = values[field] || ''; });
   courseMessage(draft.confirmed ? 'Курс уже сохранён. Нажмите «Завершить сохранение курса».' : busy.has(keyFor(id)) ? 'Сохраняем курс…' : 'Ответ о сохранении пока не получен. Повторите сохранение: второй курс не будет создан.');
  } else courseMessage('');
  controls(id);
 }
 function uncertain(error,status) {
  if (error?.uncertain || error?.retryable) return true;
  if (typeof global.SaveRecoveryV16?.isRetryable === 'function') return global.SaveRecoveryV16.isRetryable(error,status);
  return !error?.code && (status == null || status === 0) && /(?:Load failed|Failed to fetch|Network request failed|NetworkError)/i.test(String(error?.message || error || ''));
 }
 async function write(name,args,requestId,actor) {
  assertActor(actor); let response;
  try { response = await db.rpc(name,args,{saveRequestIdV16:requestId}); }
  catch (error) { response = {error}; }
  assertActor(actor);
  if (response && !response.error && Object.prototype.hasOwnProperty.call(response,'data') &&
   (name !== 'add_patient_course_test' || (typeof response.data === 'string' && !!response.data))) return response.data;
  const source = response?.error || {message:'Ответ о сохранении пока не получен.',uncertain:true};
  const failure = Error(source.message || 'Не удалось сохранить курс.'); failure.uncertain = uncertain(source,response?.status); failure.code = source.code;
  throw failure;
 }
 function renderCourses(id) {
  const readOnly = readonly(id);
  $('patientCourses').innerHTML = (lists.get(id) || []).map(course => `<div class="item"><div class="row between"><strong>${esc(course.title)}</strong><span>${esc(({active:'Активен',completed:'Завершён',cancelled:'Отменён'})[course.status] || course.status)}</span></div><div class="small">${esc(course.start_date || '')}${course.end_date ? ' — ' + esc(course.end_date) : ''}</div>${course.plan ? `<div>${esc(course.plan)}</div>` : ''}${course.notes ? `<div class="small">${esc(course.notes)}</div>` : ''}${!readOnly && course.status === 'active' ? `<div class="row"><button type="button" class="btn secondary" data-course-id="${esc(course.id)}" data-course-status="completed">Завершить</button><button type="button" class="btn secondary" data-course-id="${esc(course.id)}" data-course-status="cancelled">Отменить</button></div>` : ''}</div>`).join('') || '<div class="notice">Курсов пока нет.</div>';
  controls(id);
 }
 loadCourses = async function (id) {
  const actor = actorKey(), view = cardVersion, version = (listVersions.get(id) || 0) + 1;
  listVersions.set(id,version); assertActor(actor);
  const response = await db.rpc('patient_courses_test',{p_patient_id:id}); assertActor(actor);
  if (currentPatientId !== id || view !== cardVersion || version !== listVersions.get(id) || !$('patientCard').classList.contains('active')) return false;
  if (response?.error || !Array.isArray(response?.data)) {
   const text = response?.error?.message || 'Список курсов пока не получен.';
   if (lists.has(id)) renderCourses(id); else $('patientCourses').innerHTML = `<div class="notice">${esc(text)}</div>`;
   throw Error(text);
  }
  lists.set(id,response.data); renderCourses(id); return true;
 };
 addCourse = async function () {
  const id = currentPatientId, actor = actorKey(), key = keyFor(id), view = cardVersion;
  const navigation = typeof quickNavigation4 === 'undefined' ? null : quickNavigation4;
  if (busy.has(key)) return;
  let draft = drafts.get(key);
  try {
   assertActor(actor); if (!id || !patient(id) || archived(patient(id))) throw Error('Выберите действующего пациента для курса.');
   if (!draft) {
    const title = $('courseTitle').value.trim(), start = $('courseStart').value || null, end = $('courseEnd').value || null;
    if (!title || title.length > 200) throw Error('Укажите название курса длиной до 200 символов.');
    if (start && end && end < start) throw Error('Окончание курса не может быть раньше начала.');
    draft = {args:{p_patient_id:id,p_title:title,p_start:start,p_end:end,p_plan:$('coursePlan').value.trim() || null,p_notes:$('courseNotes').value.trim() || null},requestId:crypto.randomUUID(),uncertain:false,confirmed:false};
    drafts.set(key,draft);
   }
   busy.add(key); controls(id); courseMessage(draft.confirmed ? 'Завершаем сохранение…' : 'Сохраняем курс…');
   if (!draft.confirmed) { await write('add_patient_course_test',draft.args,draft.requestId,actor); draft.confirmed = true; draft.uncertain = false; }
   if (!stillCurrent(actor,id,view,navigation)) return;
   drafts.delete(key); fieldIds.forEach(field => { $(field).value = field === 'courseStart' ? localDateValue() : ''; });
   courseMessage('Курс сохранён.',true);
   try { await loadCourses(id); }
   catch (error) { if (stillCurrent(actor,id,view,navigation)) courseMessage('Курс сохранён. Список пока не обновился. Повторно добавлять курс не нужно.',true); }
  } catch (error) {
   if (actor !== actorKey()) return;
   if (draft && error.uncertain) draft.uncertain = true;
   else if (draft && !draft.confirmed && !draft.uncertain) drafts.delete(key);
   if (stillCurrent(actor,id,view,navigation)) courseMessage(error.message + (draft?.uncertain ? ' Данные сохранены в форме. Нажмите «Повторить сохранение курса».' : ''));
  } finally { busy.delete(key); if (actor === actorKey() && currentPatientId === id) controls(id); }
 };
 setCourseStatus = async function (courseId,status) {
  const id = currentPatientId, actor = actorKey(), patientKey = keyFor(id), key = JSON.stringify([patientKey,courseId]), view = cardVersion;
  const navigation = typeof quickNavigation4 === 'undefined' ? null : quickNavigation4;
  if (busy.has(key)) return;
  let draft = statusDrafts.get(key);
  try {
   assertActor(actor); if (!id || !patient(id) || archived(patient(id))) throw Error('Выберите действующего пациента.');
   if (!['completed','cancelled'].includes(status)) throw Error('Выберите статус курса.');
   if (!draft) { draft = {args:{p_course_id:courseId,p_status:status},requestId:crypto.randomUUID(),uncertain:false}; statusDrafts.set(key,draft); }
   if (draft.args.p_status !== status) throw Error('Сначала завершите предыдущую смену статуса курса.');
   busy.add(key); controls(id); courseMessage('Сохраняем статус курса…');
   await write('set_course_status_test',draft.args,draft.requestId,actor); statusDrafts.delete(key);
   listVersions.set(id,(listVersions.get(id) || 0) + 1);
   lists.set(id,(lists.get(id) || []).map(course => course.id === courseId ? {...course,status} : course));
   if (!stillCurrent(actor,id,view,navigation)) return;
   renderCourses(id); courseMessage('Статус курса сохранён.',true);
   try { await loadCourses(id); }
   catch (error) { if (stillCurrent(actor,id,view,navigation)) courseMessage('Статус курса сохранён. Список пока не обновился. Повторно сохранять не нужно.',true); }
  } catch (error) {
   if (actor !== actorKey()) return;
   if (draft && error.uncertain) draft.uncertain = true;
   else if (draft && !draft.uncertain) statusDrafts.delete(key);
   if (stillCurrent(actor,id,view,navigation)) courseMessage(error.message + (draft?.uncertain ? ' Повторите то же действие: запрос сохранён.' : ''));
  } finally { busy.delete(key); if (actor === actorKey() && currentPatientId === id) controls(id); }
 };
 const openBase = openPatient;
 openPatient = async function (id) {
  const actor = actorKey(), view = ++cardVersion;
  await openBase(id);
  if (actor === actorKey() && view === cardVersion && currentPatientId === id && $('patientCard').classList.contains('active')) restoreDraft(id);
 };
 const signOutBase = signOut;
 signOut = async function () {
  ++session; ++cardVersion; drafts.clear(); statusDrafts.clear(); busy.clear(); lists.clear(); listVersions.clear();
  fieldIds.forEach(field => { $(field).disabled = false; });
  if ($('courseMessageV16')) $('courseMessageV16').textContent = '';
  await signOutBase();
 };
 ensureMessage();
})(typeof window !== 'undefined' ? window : globalThis);
