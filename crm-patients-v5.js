/* Patient records and confirmed voice commands. Patient drafts stay in memory. */
(function (global) {
  'use strict';
  const normalize = value => String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
  const isArchived = patient => !!(patient?.archived_at || patient?.archived || patient?.is_archived);
  const isDeleted = patient => !!patient?.deleted_at;
  const sexLabel = value => ({ female: 'Женский', male: 'Мужской', unknown: 'Не указан' }[value] || 'Не указан');
  function voiceQuantity(value) {
    const amount = Number(String(value).replace(',', '.'));
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Укажите целое количество единиц списания больше нуля. Дозировку программа не подбирает.');
    return amount;
  }
  function parseVoiceCommand(value) {
    const text = String(value || '').trim().replace(/[.!?]+$/, '').trim();
    if (!text || text.length > 500) throw new Error('Введите команду длиной до 500 символов.');
    let match;
    if ((match = text.match(/^(?:создай|создать|добавь|добавить|новый|нового)\s+пациент(?:а|ку)?\s+(.+)$/iu))) {
      let name = match[1].replace(/^(?:имя|фио|по имени)\s+/iu, '').trim(), phone = '';
      const phonePart = name.match(/\s+(?:телефон|номер(?: телефона)?)\s+(.+)$/iu);
      if (phonePart) {
        const entered = phonePart[1].trim();
        if (!/^\+?[\d\s()-]+$/.test(entered)) throw new Error('Телефон укажите цифрами. Можно исправить распознанный текст.');
        phone = entered.replace(/[\s()-]/g, '');
        if (!/^\+?\d{5,15}$/.test(phone)) throw new Error('Проверьте номер телефона: от 5 до 15 цифр.');
        name = name.slice(0, phonePart.index).trim();
      }
      if (!name || name.length > 200) throw new Error('Укажите имя пациента длиной до 200 символов.');
      return { kind: 'patient_create', name, phone };
    }
    if ((match = text.match(/^(?:найди|найти|поиск|найти мне)\s+пациент(?:а|ку)?\s+(.+)$/iu))) return { kind: 'patient_find', query: match[1].trim() };
    if ((match = text.match(/^(?:создай|создать|начни|начать|новая|открой)\s+процедур(?:у|а)(?:\s+(?:для|пациент(?:а|ки)?))?\s*(.*)$/iu))) return { kind: 'procedure', query: match[1].trim() };
    if ((match = text.match(/^(?:найди|найти|поиск)\s+препарат\s+(.+)$/iu))) return { kind: 'med_find', query: match[1].trim() };
    if ((match = text.match(/^(?:создай|создать|новый)\s+препарат\s+(.+)$/iu))) return { kind: 'med_create', name: match[1].trim() };
    if ((match = text.match(/^(?:убери|удали|убрать)\s+(?:препарат\s+)?(.+)$/iu))) return { kind: 'med_remove', query: match[1].trim() };
    if ((match = text.match(/^(добавь|добавить|измени|изменить)\s+(?:препарат\s+)?(.+)$/iu))) {
      const tail = match[2].trim();
      const amount = tail.match(/^(.+?)\s+(?:количество|количеством|х|×)\s+(\d+(?:[.,]\d+)?)(?:\s+(?:ампул[а-яё]*|флакон[а-яё]*|таблет[а-яё]*|штук[а-яё]*|единиц[а-яё]*|мл))?$/iu)
        || tail.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s+(?:ампул[а-я]*|флакон[а-я]*|таблет[а-я]*|штук[а-я]*|единиц[а-я]*|мл)$/iu);
      if (!amount) throw new Error('Укажите препарат и количество: «Добавь препарат Самыр количество 1». Единицы указаны в карточке препарата.');
      return { kind: /^добав/iu.test(match[1]) ? 'med_add' : 'med_change', query: amount[1].trim(), quantity: voiceQuantity(amount[2]) };
    }
    throw new Error('Команда не распознана. Используйте один из примеров ниже или исправьте текст.');
  }
  const pure = { parseVoiceCommand, voiceQuantity, normalize, isArchived, isDeleted, sexLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;
  global.CrmPatientsV5 = pure;

  let directory = [], editId = null, saving = false, archiveBusy = false, cardVersion = 0, listVersion = 0, documentSaving = false;
  let patientSession = 0, formVersion = 0, saveDraft = null, saveOperation = null;
  let archiveOperation = null, documentOperation = null;
  const documentDrafts = new Map();
  const archiveDrafts = new Map();
  const deletionRequests = new Map();
  let deletionBusy = false;
  let recognition = null, voicePlan = null, voiceVersion = 0, voiceBusy = false, voiceReturnFocus = null;
  const allowed = () => ['owner', 'admin', 'nurse'].includes(currentStaff?.role);
  const owner = () => ['owner', 'admin'].includes(currentStaff?.role);
  const patientFields = { pname: 'full_name', pdob: 'birth_date', psexV5: 'sex', pphone: 'phone', pcomplaints: 'complaints', prequest: 'request', pprescriptions: 'prescriptions', pnotes: 'notes' };
  function requireAccess() { if (!allowed()) throw new Error('Войдите под учётной записью владельца или медсестры.'); }
  function patientMessage(text, success = false) { message('patientFormMessageV5', text, success); }
  const patientActor = () => JSON.stringify([currentStaff?.id, currentStaff?.role, patientSession]);
  function requirePatientActor(actor) { requireAccess(); if (actor !== patientActor()) throw new Error('Учётная запись изменилась. Откройте форму заново.'); }
  function networkFailure(error, status) {
    if (typeof global.SaveRecoveryV16?.isRetryable === 'function') return global.SaveRecoveryV16.isRetryable(error, status);
    if (error?.retryable || error?.uncertain) return true;
    if (error?.code || (status != null && status !== 0)) return false;
    return /^(?:(?:TypeError|NetworkError):\s*)?(?:Load failed|Failed to fetch|Network request failed|NetworkError when attempting to fetch resource)\.?$/i.test(String(error?.message || '').trim());
  }
  function patientResponseValid(name, args, data) {
    if (name === 'crm_patient_save_v11') { const patient = data?.patient || data; return typeof patient?.id === 'string' && typeof patient?.full_name === 'string'; }
    if (name === 'crm_management_v5' && args.p_action === 'patient_list') return Array.isArray(data) || Array.isArray(data?.patients);
    if (name === 'crm_management_v5' && args.p_action === 'patient_archive') return !!data?.id;
    if (name === 'register_patient_file_v8') return typeof data === 'string' && !!data;
    return true;
  }
  async function patientRequest(name, args, retrySafe = false, onAmbiguous = null, options = undefined) {
    requireAccess(); const actor = patientActor();
    for (let attempt = 0; attempt < 2; attempt++) {
      requirePatientActor(actor); let response;
      try { response = await db.rpc(name, args, options); } catch (error) { response = {error}; }
      requirePatientActor(actor);
      if (response && !response.error && patientResponseValid(name, args, response.data)) return response.data;
      if (response && !response.error) response = { error: { message: 'Ответ о сохранении пока не получен.', uncertain: true, retryable: true }, status: 0 };
      const error = response?.error || {message:'Load failed'}, network = networkFailure(error, response?.status);
      if (network || error.uncertain) onAmbiguous?.();
      if (network && retrySafe && attempt === 0 && !error.recoveryAttemptedV16) { await new Promise(resolve => setTimeout(resolve,350)); continue; }
      const failure = new Error(network ? 'Не удалось получить ответ от сервера. Проверьте интернет и повторите действие.' : error.message || 'Не удалось выполнить действие.');
      failure.network = network || !!error.uncertain; failure.uncertain = !!error.uncertain; failure.code = error.code; throw failure;
    }
  }
  async function patientRpc(action, payload = {}) {
    return patientRequest('crm_management_v5', {p_action:action,p_payload:payload}, action === 'patient_list');
  }
  function patientById(id) { return directory.find(patient => patient.id === id) || patients.find(patient => patient.id === id); }
  // The printable card uses the same authorized directory as the patient screen.
  // Export only card fields, never the directory or internal database attributes.
  global.patientCardRecordV20 = function (id) {
    requireAccess(); const patient = patientById(id);
    if (!patient || isDeleted(patient) || (isArchived(patient) && !owner())) throw new Error('Пациент не найден. Откройте его карточку заново.');
    return Object.fromEntries(['id', 'full_name', 'birth_date', 'sex', 'phone', 'complaints', 'request', 'prescriptions', 'notes'].map(key => [key, patient[key] ?? null]));
  };
  loadPatients = async function () {
    requireAccess();
    const version = ++listVersion, staffId = currentStaff.id;
    const data = await patientRpc('patient_list', { include_archived: owner() });
    if (version !== listVersion || currentStaff?.id !== staffId) return;
    directory = (Array.isArray(data) ? data : data?.patients || []).filter(patient => !isDeleted(patient));
    patients = directory.filter(patient => !isArchived(patient));
    if ($('patientArchiveFilterV5')) $('patientArchiveFilterV5').classList.toggle('hidden', !owner());
    if ($('patients').classList.contains('active')) renderPatients();
  };
  patientOptions = function (blank = false) {
    return (blank ? '<option value="">Без пациента</option>' : '') + patients.filter(patient => !isArchived(patient) && !isDeleted(patient)).map(patient => `<option value="${esc(patient.id)}">${esc(patient.full_name)}</option>`).join('');
  };
  renderPatients = function () {
    const query = normalize($('patientSearch').value), archived = owner() && $('patientIncludeArchivedV5')?.checked;
    const visible = (archived ? directory : patients).filter(patient => normalize([patient.full_name, patient.phone].join(' ')).includes(query));
    $('patientList').innerHTML = visible.map(patient => `<button type="button" class="item click patient-list-item-v5" data-patient-id="${esc(patient.id)}"><strong>${esc(patient.full_name)}</strong>${isArchived(patient) ? '<span class="pill">В архиве</span>' : ''}<div class="small">${esc(patient.birth_date || 'Дата рождения не указана')} · ${esc(patient.phone || 'Телефон не указан')}</div></button>`).join('') || '<div class="notice">Пациенты не найдены.</div>';
  };
  goPatients = async function () {
    const staffId = currentStaff?.id;
    const navigation = typeof beginQuickNavigation4 === 'function' ? beginQuickNavigation4() : null;
    const stillCurrent = () => currentStaff?.id === staffId && $('patients').classList.contains('active') &&
      (navigation === null || quickNavigationCurrent4(navigation, staffId));
    try {
      requireAccess(); show('patients'); $('patientList').innerHTML = '<div class="notice">Загрузка пациентов…</div>';
      await loadPatients(); if (stillCurrent()) renderPatients();
    } catch (error) { if (stillCurrent()) $('patientList').innerHTML = `<div class="notice">${esc(error.message)}</div>`; }
  };
  function fillPatientForm(patient = {}) {
    ++formVersion;
    Object.entries(patientFields).forEach(([id, key]) => { $(id).value = patient[key] || (key === 'sex' ? 'unknown' : ''); });
    $('newPatient').querySelector('h1').textContent = editId ? 'Редактирование пациента' : 'Новый пациент';
    $('newPatient').querySelector('button[onclick="addPatient()"]').textContent = editId ? 'Сохранить изменения' : 'Сохранить пациента';
    patientMessage('');
    updatePatientSaveControls();
  }
  function updatePatientSaveControls() {
    const pending = saveDraft?.actor === patientActor() && (saving || saveDraft.uncertain || saveDraft.result);
    Object.keys(patientFields).forEach(id => { $(id).disabled = !!pending; });
    const button = $('newPatient').querySelector('button[onclick="addPatient()"]');
    button.disabled = saving;
    button.textContent = saveDraft?.result ? 'Открыть сохранённую карточку' : saveDraft?.uncertain ? 'Повторить сохранение' : editId ? 'Сохранить изменения' : 'Сохранить пациента';
  }
  function resumePatientSave() {
    if (!saveDraft || saveDraft.actor !== patientActor()) return false;
    editId = saveDraft.payload.id || null; fillPatientForm(saveDraft.payload); show('newPatient');
    patientMessage(saveDraft.result ? 'Пациент уже сохранён. Откройте карточку.' : saving ? 'Сохраняем…' : 'Ответ о сохранении пока не получен. Повторите сохранение: вторая карточка не будет создана.', !!saveDraft.result);
    return true;
  }
  goNewPatient = function () {
    try { requireAccess(); if (typeof beginQuickNavigation4 === 'function') beginQuickNavigation4(); if (resumePatientSave()) return false; saveDraft = null; editId = null; fillPatientForm(); show('newPatient'); $('pname').focus(); return true; }
    catch (error) { message('homeMessage', error.message); }
  };
  global.editPatientV5 = function () {
    if (!owner()) return;
    if (resumePatientSave()) return;
    const patient = patientById(currentPatientId); if (!patient) return;
    editId = patient.id; fillPatientForm(patient); show('newPatient'); $('pname').focus();
  };
  addPatient = async function () {
    if (saving) return;
    const actor = patientActor(), version = formVersion, navigation = typeof quickNavigation4 === 'undefined' ? null : quickNavigation4;
    const stillCurrent = () => actor === patientActor() && version === formVersion && $('newPatient').classList.contains('active') && (navigation === null || quickNavigation4 === navigation);
    const operation = {}; let draft;
    try {
      requireAccess();
      if (editId && !owner()) throw new Error('Изменять карточку пациента может только владелец.');
      const payload = Object.fromEntries(Object.entries(patientFields).map(([id, key]) => [key, $(id).value.trim() || null]));
      if (!payload.full_name) throw new Error('Укажите имя пациента. Фамилия и остальные поля необязательны.');
      if (payload.full_name.length > 200) throw new Error('Имя пациента должно содержать не более 200 символов.');
      if (payload.birth_date && payload.birth_date > localDateValue()) throw new Error('Дата рождения не может быть в будущем.');
      if (editId) payload.id = editId;
      draft = saveDraft?.actor === actor ? saveDraft : {actor,payload,requestId:crypto.randomUUID(),uncertain:false,result:null};
      saveDraft = draft; saving = true; saveOperation = operation; updatePatientSaveControls(); patientMessage(draft.result ? 'Открываем сохранённую карточку…' : 'Сохраняем…');
      if (!draft.result) {
        const result = await patientRequest('crm_patient_save_v11', {p_payload:draft.payload,p_request_id:draft.requestId}, true, () => {draft.uncertain = true;});
        const patient = result?.patient || result;
        if (!patient?.id) { const error = new Error('Ответ о сохранении пока не получен. Повторите сохранение.'); error.network = true; throw error; }
        draft.result = patient; draft.uncertain = false;
      }
      requirePatientActor(actor);
      const patient = draft.result;
      directory = directory.filter(item => item.id !== patient.id).concat(patient);
      patients = patients.filter(item => item.id !== patient.id).concat(isArchived(patient) || isDeleted(patient) ? [] : patient);
      if (!stillCurrent()) return;
      saveDraft = null; editId = null; fillPatientForm();
      const card = openPatient(patient.id); let refreshError = null;
      try { await loadPatients(); } catch (error) { refreshError = error; }
      await card;
      if (actor === patientActor() && currentPatientId === patient.id && $('patientCard').classList.contains('active') && (navigation === null || quickNavigation4 === navigation)) message('patientCardMessageV5', 'Пациент сохранён.' + (refreshError ? ' Список пока не обновился. Карточка доступна; повторно создавать пациента не нужно.' : ''), true);
    } catch (error) {
      if (draft && actor === patientActor()) {
        if (error.network) draft.uncertain = true;
        else if (saveDraft === draft && !draft.result && !draft.uncertain) saveDraft = null;
      }
      if (stillCurrent()) patientMessage(error.message + (draft?.uncertain ? ' Данные остались в форме. Нажмите «Повторить сохранение».' : ''));
    } finally {
      if (saveOperation === operation) { saving = false; saveOperation = null; updatePatientSaveControls(); }
    }
  };
  global.archivePatientV5 = async function () {
    if (!owner() || archiveBusy) return;
    const patient = patientById(currentPatientId); if (!patient) return;
    const actor = patientActor(), key = JSON.stringify([actor, patient.id]);
    let draft = archiveDrafts.get(key);
    const archived = draft ? draft.payload.archived : !isArchived(patient);
    if (!draft && !global.confirm(archived ? `Архивировать пациента «${patient.full_name}»? История и документы сохранятся.` : `Восстановить пациента «${patient.full_name}» из архива?`)) return;
    if (!draft) { draft = { payload: { id: patient.id, archived }, requestId: crypto.randomUUID() }; archiveDrafts.set(key, draft); }
    const version = cardVersion, navigation = typeof quickNavigation4 === 'undefined' ? null : quickNavigation4;
    const stillCurrent = () => actor === patientActor() && currentPatientId === patient.id && version === cardVersion && $('patientCard').classList.contains('active') && (navigation === null || navigation === quickNavigation4);
    const operation = {}; archiveOperation = operation; archiveBusy = true;
    try {
      const saved = await patientRequest('crm_management_v5', { p_action: 'patient_archive', p_payload: draft.payload }, false, null, { saveRequestIdV16: draft.requestId });
      archiveDrafts.delete(key); requirePatientActor(actor);
      directory = directory.filter(item => item.id !== saved.id).concat(saved);
      patients = patients.filter(item => item.id !== saved.id).concat(isArchived(saved) || isDeleted(saved) ? [] : saved);
      if (!stillCurrent()) return;
      const resultText = archived ? 'Пациент в архиве. История и документы сохранены.' : 'Пациент восстановлен.';
      message('patientCardMessageV5', resultText, true);
      const refresh = await Promise.allSettled([loadPatients(), openPatient(patient.id)]);
      if (actor === patientActor() && currentPatientId === patient.id && $('patientCard').classList.contains('active') && (navigation === null || navigation === quickNavigation4)) message('patientCardMessageV5', resultText + (refresh.some(result => result.status === 'rejected') ? ' Часть данных пока не обновилась. Повторно сохранять не нужно.' : ''), true);
    } catch (error) {
      if (!error.network && !error.uncertain) archiveDrafts.delete(key);
      if (stillCurrent()) message('patientCardMessageV5', error.message + (error.network || error.uncertain ? ' Повторите действие: запрос сохранён и не создаст повторную запись.' : ''));
    }
    finally { if (archiveOperation === operation) { archiveBusy = false; archiveOperation = null; } }
  };
  global.deletePatientV10 = async function () {
    if (!owner() || deletionBusy) return;
    const patient = patientById(currentPatientId), staffId = currentStaff?.id;
    if (!patient || isDeleted(patient)) return;
    if (!global.confirm(`Удалить пациента «${patient.full_name}» из списка? Новые процедуры для него будут недоступны. История процедур и оплат останется в отчётах. Документы сохранятся.`)) return;
    const key = JSON.stringify([staffId, patient.id, patient.updated_at]);
    if (!deletionRequests.has(key)) deletionRequests.set(key, crypto.randomUUID());
    const stillCurrent = () => currentStaff?.id === staffId && currentPatientId === patient.id && $('patientCard').classList.contains('active');
    deletionBusy = true; $('patientDeleteV10').disabled = true;
    try {
      requireAccess();
      if (!owner()) throw new Error('Удалять пациента может только владелец.');
      const { error } = await db.rpc('crm_patient_delete_v10', { p_payload: { id: patient.id, request_id: deletionRequests.get(key), expected_updated_at: patient.updated_at } });
      if (error) throw new Error(error.message || 'Не удалось удалить пациента. Повторите действие.');
      if (currentStaff?.id !== staffId) return;
      deletionRequests.delete(key);
      ++listVersion;
      directory = directory.filter(item => item.id !== patient.id); patients = patients.filter(item => item.id !== patient.id);
      if (stillCurrent()) {
        ++cardVersion; ++patientView4; currentPatientId = null; lastTemplate = null;
        ['patientHistory', 'patientDocuments', 'patientCourses', 'patientCardInfo', 'lastProcedure'].forEach(id => { $(id).textContent = ''; });
        renderPatients(); show('patients'); message('homeMessage', 'Пациент удалён из списка. История и документы сохранены.', true);
      }
    } catch (error) { if (stillCurrent()) message('patientCardMessageV5', error.message); }
    finally { deletionBusy = false; $('patientDeleteV10').disabled = false; }
  };
  function renderPatientInfo(patient) {
    const fields = [['Дата рождения', patient.birth_date], ['Пол', sexLabel(patient.sex)], ['Телефон', patient.phone], ['Жалобы', patient.complaints], ['Запрос', patient.request], ['Назначения врача', patient.prescriptions], ['Комментарий', patient.notes]];
    $('patientCardInfo').innerHTML = fields.filter(([, value], index) => index < 3 || value).map(([label, value]) => `<div><b>${label}:</b> ${esc(value || '—')}</div>`).join('');
  }
  function renderPatientHistory(data) {
    const events = [...(data?.procedures || []).map(event => ({ ...event, kind: 'Процедура', at: event.visit_at, items: event.medications || [] })), ...(data?.sales || []).map(event => ({ ...event, kind: 'Продажа препарата', at: event.sold_at, items: event.items || [] }))].sort((a, b) => new Date(b.at) - new Date(a.at));
    $('patientHistory').innerHTML = events.map(event => `<div class="item"><div class="row between"><strong>${event.kind}${event.procedure_type ? ' · ' + esc(event.procedure_type) : ''}</strong>${owner() && event.paid_total != null ? `<span>${rub(event.paid_total)}</span>` : ''}</div>${event.stock_deducted === false ? '<span class="pill accounting-badge-v5">Без списания со склада</span>' : ''}<div class="small">${esc(new Date(event.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }))} · ${esc(event.nurse || '')}</div>${event.items.length ? `<div class="small">${event.items.map(item => `${esc(item.name)} × ${esc(qty(item.quantity))} ${esc(item.unit || '')}`).join(', ')}</div>` : ''}${owner() && num(event.discount_amount) > 0 ? `<div class="small">Скидка: ${rub(event.discount_amount)}</div>` : ''}${event.notes ? `<div class="small">${esc(event.notes)}</div>` : ''}</div>`).join('') || '<div class="notice">История пока пустая.</div>';
  }
  loadPatientDocuments = async function (patientId) {
    const staffId = currentStaff?.id;
    const { data, error } = await db.rpc('patient_files_v8', { p_patient_id: patientId });
    if (currentPatientId !== patientId || currentStaff?.id !== staffId) return;
    if (error) { $('patientDocuments').innerHTML = `<div class="notice">${esc(error.message)}</div>`; return false; }
    if (!Array.isArray(data)) { $('patientDocuments').innerHTML = '<div class="notice">Список документов пока не получен. Откройте карточку снова.</div>'; return false; }
    const documents = data;
    $('patientDocuments').innerHTML = documents.map(doc => `<button type="button" class="item click patient-list-item-v5" data-document-path="${esc(doc.storage_path)}"><div class="row between"><strong>${esc(doc.title)}</strong><span class="small">${esc(doc.document_date || '')}</span></div><div class="small">${esc(doc.original_name || 'Файл')} · ${doc.mime_type === 'application/pdf' ? 'PDF' : 'Фото'}</div></button>`).join('') || '<div class="notice">Пока нет прикреплённых анализов или документов.</div>';
    return true;
  };
  uploadPatientDocument = async function () {
    if (documentSaving) return;
    const patientId = currentPatientId, staffId = currentStaff?.id, actor = patientActor();
    const file = $('docFile').files[0], title = $('docTitle').value.trim(), date = $('docDate').value || null;
    const button = $('patientCard').querySelector('button[onclick="uploadPatientDocument()"]');
    const stillCurrent = () => currentPatientId === patientId && currentStaff?.id === staffId && actor === patientActor() && $('patientCard').classList.contains('active');
    const status = text => { if (stillCurrent()) $('docMessage').textContent = text; };
    let draft, key, operation;
    try {
      requireAccess();
      if (!patientId || !patientById(patientId)) throw new Error('Выберите пациента.');
      if (isArchived(patientById(patientId))) throw new Error('Для добавления документа восстановите пациента из архива.');
      if (!title || title.length > 200) throw new Error('Укажите название документа длиной до 200 символов.');
      if (!file) throw new Error('Выберите фото или PDF.');
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Можно прикрепить PDF, JPG, PNG или WEBP.');
      if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('Размер файла должен быть от 1 байта до 15 МБ.');
      key = JSON.stringify([staffId, patientId, file.name, file.size, file.lastModified, title, date]);
      draft = documentDrafts.get(key);
      if (!draft) {
        const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
        draft = { path: `${patientId}/${Date.now()}_${crypto.randomUUID()}_${safeName}`, uploaded: false, attempted: false };
        documentDrafts.set(key, draft);
      }
      operation = {}; documentOperation = operation; documentSaving = true; button.disabled = true; status(draft.uploaded ? 'Сохраняем карточку документа…' : 'Загружаем файл…');
      if (!draft.uploaded) {
        const retried = draft.attempted; draft.attempted = true;
        const { error } = await db.storage.from('patient-documents').upload(draft.path, file, { contentType: file.type, upsert: false });
        // A timed-out upload can have succeeded. Retrying the same random path never overwrites it.
        if (error && !(retried && (String(error.statusCode) === '409' || error.error === 'Duplicate'))) throw new Error('Не удалось загрузить файл: ' + error.message + '. Повторите с тем же файлом и названием.');
        draft.uploaded = true;
      }
      requirePatientActor(actor);
      let registrationError = null;
      try { await patientRequest('register_patient_file_v8', { p_patient_id: patientId, p_title: title, p_document_date: date, p_storage_path: draft.path, p_original_name: file.name, p_mime_type: file.type }, true); }
      catch (error) { registrationError = error; }
      if (registrationError) {
        // Only a confirmed database rollback permits cleanup. The policy rejects registered paths.
        if (!registrationError.network && !registrationError.uncertain && /^[0-9A-Z]{5}$/.test(registrationError.code || '')) {
          const removed = await db.storage.from('patient-documents').remove([draft.path]);
          if (!removed.error) documentDrafts.delete(key);
        }
        throw new Error('Не удалось сохранить карточку документа: ' + registrationError.message + '. Повторите с тем же файлом и названием.');
      }
      documentDrafts.delete(key); status('Документ прикреплён.');
      if (stillCurrent()) {
        if ($('docTitle').value.trim() === title && $('docDate').value === (date || '') && $('docFile').files[0] === file) { $('docTitle').value = ''; $('docFile').value = ''; }
        try { if (await loadPatientDocuments(patientId) === false) status('Документ прикреплён. Список пока не обновился. Повторно загружать файл не нужно.'); }
        catch (error) { status('Документ прикреплён. Список пока не обновился. Повторно загружать файл не нужно.'); }
      }
    } catch (error) { status(error.message); }
    finally { if (operation && documentOperation === operation) { documentSaving = false; documentOperation = null; button.disabled = isArchived(patientById(currentPatientId)); } }
  };
  loadCourses = async function (patientId) {
    const staffId = currentStaff?.id;
    const { data, error } = await db.rpc('patient_courses_test', { p_patient_id: patientId });
    if (currentPatientId !== patientId || currentStaff?.id !== staffId) return;
    if (error) { $('patientCourses').innerHTML = `<div class="notice">${esc(error.message)}</div>`; return; }
    const readonly = isArchived(patientById(patientId));
    $('patientCourses').innerHTML = (data || []).map(course => `<div class="item"><div class="row between"><strong>${esc(course.title)}</strong><span>${({ active: 'Активен', completed: 'Завершён', cancelled: 'Отменён' }[course.status]) || esc(course.status)}</span></div><div class="small">${esc(course.start_date || '')}${course.end_date ? ' — ' + esc(course.end_date) : ''}</div>${course.plan ? `<div>${esc(course.plan)}</div>` : ''}${course.notes ? `<div class="small">${esc(course.notes)}</div>` : ''}${!readonly && course.status === 'active' ? `<div class="row"><button type="button" class="btn secondary" data-course-id="${esc(course.id)}" data-course-status="completed">Завершить</button><button type="button" class="btn secondary" data-course-id="${esc(course.id)}" data-course-status="cancelled">Отменить</button></div>` : ''}</div>`).join('') || '<div class="notice">Курсов пока нет.</div>';
  };
  openPatient = async function (id) {
    requireAccess();
    const patient = patientById(id); if (!patient || isDeleted(patient) || (isArchived(patient) && !owner())) return;
    const version = ++cardVersion; ++patientView4; currentPatientId = id; lastTemplate = null;
    const archived = isArchived(patient);
    ['courseTitle', 'courseEnd', 'coursePlan', 'courseNotes', 'docTitle', 'docFile'].forEach(input => { $(input).value = ''; });
    $('courseStart').value = localDateValue(); $('docDate').value = localDateValue(); $('docMessage').textContent = '';
    $('patientCardName').textContent = patient.full_name; renderPatientInfo(patient);
    message('patientCardMessageV5', archived ? 'Пациент в архиве. Для новой процедуры восстановите карточку.' : '');
    $('patientEditV5').classList.toggle('hidden', !owner()); $('patientArchiveV5').classList.toggle('hidden', !owner());
    $('patientDeleteV10').classList.toggle('hidden', !owner());
    $('patientArchiveV5').textContent = archived ? 'Восстановить из архива' : 'Архивировать';
    $('patientCard').querySelector('button[onclick="openProcedure(currentPatientId)"]').disabled = archived;
    $('patientCard').querySelector('button[onclick="uploadPatientDocument()"]').disabled = archived || documentSaving;
    $('patientCard').querySelector('button[onclick="addCourse()"]').disabled = archived;
    $('patientHistory').innerHTML = '<div class="notice">Загрузка истории…</div>';
    $('patientDocuments').innerHTML = '<div class="notice">Загрузка документов…</div>';
    $('lastProcedure').textContent = 'Загрузка последней процедуры…'; show('patientCard');
    const results = await Promise.allSettled([loadPatientDocuments(id), loadCourses(id), db.rpc('patient_history_v8', { p_patient_id: id }), quickRpc('last_procedure', { patient_id: id })]);
    if (version !== cardVersion || currentPatientId !== id || !allowed()) return;
    const history = results[2];
    if (history.status === 'fulfilled' && !history.value.error) renderPatientHistory(history.value.data);
    else $('patientHistory').innerHTML = `<div class="notice">${esc(history.status === 'rejected' ? history.reason.message : history.value.error.message)}</div>`;
    const latest = results[3];
    if (latest.status === 'fulfilled') {
      lastTemplate = latest.value;
      $('lastProcedure').innerHTML = lastTemplate ? `<span class="small">Последняя процедура</span><p>${templateText4(lastTemplate)}</p>${archived ? '' : '<button class="btn primary wide" id="patientRepeatV5">Повторить с корректировкой</button>'}` : 'Процедур пока нет.';
      if ($('patientRepeatV5')) $('patientRepeatV5').onclick = () => repeatLast4(id);
    } else $('lastProcedure').textContent = latest.reason.message;
    const rejected = results.slice(0, 2).filter(result => result.status === 'rejected');
    if (rejected.length) message('patientCardMessageV5', 'Не удалось загрузить часть данных: ' + rejected.map(result => result.reason.message).join('; '));
  };

  function activeTreatment() { return $('procedure').classList.contains('active') ? 'proc' : $('sale').classList.contains('active') ? 'sale' : null; }
  function invalidateVoice() { ++voiceVersion; voicePlan = null; $('voicePreviewV5').textContent = ''; $('voiceApplyV5').disabled = true; }
  function voiceStatus(text) { $('voiceStatusV5').textContent = text; }
  function stopRecognition() { const active = recognition; recognition = null; if (active) active.abort(); $('voiceListenV5').textContent = '🎙 Начать запись'; }
  global.closeVoiceV5 = function () {
    if (voiceBusy) return;
    stopRecognition(); invalidateVoice();
    const dialog = $('voiceDialogV5'); if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    $('voiceTextV5').value = ''; voiceStatus(''); voiceReturnFocus?.focus();
  };
  global.openVoiceV5 = function () {
    if (!allowed()) return;
    voiceReturnFocus = document.activeElement;
    $('voiceTextV5').value = ''; invalidateVoice();
    const supported = !!(global.SpeechRecognition || global.webkitSpeechRecognition);
    $('voiceListenV5').disabled = !supported;
    voiceStatus(supported ? 'Нажмите микрофон или введите команду. Перед применением проверьте текст и действие.' : 'Этот браузер не поддерживает распознавание речи. Введите команду ниже — подтверждение работает так же.');
    const dialog = $('voiceDialogV5'); if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
    $('voiceTextV5').focus();
  };
  global.listenVoiceV5 = function () {
    if (recognition) { recognition.stop(); return; }
    const SpeechRecognition = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SpeechRecognition) { voiceStatus('Распознавание недоступно. Введите команду вручную.'); return; }
    invalidateVoice();
    const speech = new SpeechRecognition(); recognition = speech; speech.lang = 'ru-RU'; speech.continuous = false; speech.interimResults = true;
    $('voiceListenV5').textContent = '⏹ Закончить запись'; voiceStatus('Слушаю…');
    speech.onresult = event => {
      if (recognition !== speech || !$('voiceDialogV5').open) return;
      $('voiceTextV5').value = Array.from(event.results).map(result => result[0].transcript).join(' '); invalidateVoice();
      if (event.results[event.results.length - 1].isFinal) global.previewVoiceV5();
    };
    speech.onerror = event => {
      if (recognition !== speech) return;
      voiceStatus(({ 'not-allowed': 'Доступ к микрофону отключён. Разрешите его в настройках браузера или введите команду.', 'audio-capture': 'Микрофон недоступен. Введите команду вручную.', 'no-speech': 'Речь не распознана. Повторите запись или введите команду.', network: 'Не удалось распознать речь из-за соединения. Введите команду вручную.', 'language-not-supported': 'Русский язык недоступен для распознавания в этом браузере.' }[event.error]) || 'Не удалось распознать речь. Можно ввести команду вручную.');
    };
    speech.onend = () => { if (recognition === speech) recognition = null; $('voiceListenV5').textContent = '🎙 Начать запись'; };
    try { speech.start(); } catch (error) { recognition = null; $('voiceListenV5').textContent = '🎙 Начать запись'; voiceStatus('Не удалось включить микрофон. Введите команду вручную.'); }
  };
  function candidatesFor(query, data, nameKey) {
    const exact = data.filter(item => normalize(item[nameKey]) === normalize(query));
    if (exact.length) return exact;
    return data.filter(item => nameKey === 'name' ? matchesMedication(item, query) : normalize([item.full_name, item.phone].join(' ')).includes(normalize(query)));
  }
  function describeVoice(plan, selected) {
    switch (plan.kind) {
      case 'patient_create': return `Заполнить карточку нового пациента: ${plan.name}${plan.phone ? ', телефон ' + plan.phone : ''}. Затем проверьте поля и нажмите «Сохранить пациента».`;
      case 'patient_find': return `Открыть список пациентов с поиском «${plan.query}».`;
      case 'procedure': return selected ? `Открыть черновик процедуры для пациента «${selected.full_name}». Услугу и назначения выберите вручную.` : 'Открыть черновик процедуры. Выберите пациента, услугу и назначения.';
      case 'med_find': return `Найти препарат «${plan.query}».`;
      case 'med_create': return `Открыть новую карточку препарата с названием «${plan.name}». Остальные поля и цены проверьте перед сохранением.`;
      case 'med_add': return `Добавить в черновик «${selected.name}»: ${plan.quantity} ${unit(selected)}. ${typeof isPaymentOnlyV5 === 'function' && isPaymentOnlyV5() ? 'Оплата будет учтена по прайсу без списания со склада.' : `Это количество единиц списания. Остаток в работе: ${qty(selected.work_qty)} ${unit(selected)}.`}`;
      case 'med_change': return `Изменить количество «${selected.name}» в черновике на ${plan.quantity} ${unit(selected)}. Это количество единиц списания.`;
      case 'med_remove': return `Убрать «${selected.name}» из черновика.`;
      default: return '';
    }
  }
  function selectedVoiceItem(plan) { const id = $('voiceChoiceV5')?.value; return plan.candidates?.find(item => item.id === id) || (plan.candidates?.length === 1 ? plan.candidates[0] : null); }
  function updateVoiceDescription() {
    if (!voicePlan) return;
    const item = selectedVoiceItem(voicePlan), needsChoice = !!voicePlan.candidates?.length;
    $('voiceDescriptionV5').textContent = needsChoice && !item ? 'Выберите точное совпадение. Программа не выбирает пациента или препарат автоматически.' : describeVoice(voicePlan, item);
    $('voiceApplyV5').disabled = needsChoice && !item;
  }
  global.previewVoiceV5 = async function () {
    if (voiceBusy) return;
    invalidateVoice(); const version = voiceVersion, text = $('voiceTextV5').value.trim();
    try {
      requireAccess(); const plan = parseVoiceCommand(text); plan.text = text; plan.staffId = currentStaff.id;
      if (plan.kind === 'patient_find' || plan.kind === 'procedure') await loadPatients();
      if (plan.kind === 'procedure' && plan.query) {
        plan.candidates = candidatesFor(plan.query, patients, 'full_name');
        if (!plan.candidates.length) throw new Error('Пациент не найден. Уточните имя или сначала создайте карточку.');
      } else if (plan.kind === 'procedure') {
        const id = $('patientCard').classList.contains('active') ? currentPatientId : activeTreatment() === 'proc' ? $('procPatient').value : null;
        const patient = id && patientById(id);
        if (patient && !isArchived(patient)) plan.candidates = [patient];
      }
      if (['med_add', 'med_change', 'med_remove'].includes(plan.kind)) {
        plan.target = activeTreatment();
        if (!plan.target) throw new Error('Сначала откройте процедуру или продажу. Команда меняет только её черновик.');
        await loadMeds();
        let available = meds.filter(med => med.active !== false);
        if (plan.kind !== 'med_add') {
          const ids = new Set(rows(plan.target + 'Meds').map(item => item.medication_id)); available = available.filter(med => ids.has(med.id));
        }
        plan.candidates = candidatesFor(plan.query, available, 'name');
        if (!plan.candidates.length) throw new Error(plan.kind === 'med_add' ? 'Препарат не найден. Уточните название.' : 'Такого препарата нет в черновике. Уточните название.');
      }
      if (plan.kind === 'med_create' && !owner()) throw new Error('Создавать карточку препарата может только владелец. Медсестра добавляет препараты в черновик процедуры.');
      if (version !== voiceVersion || !$('voiceDialogV5').open || currentStaff?.id !== plan.staffId) return;
      voicePlan = plan;
      $('voicePreviewV5').innerHTML = `<h3>Подтвердите действие</h3>${plan.candidates?.length > 1 ? `<label for="voiceChoiceV5">Найдено несколько совпадений</label><select id="voiceChoiceV5"><option value="">Выберите…</option>${plan.candidates.map(item => `<option value="${esc(item.id)}">${esc(item.full_name || item.name)}${item.phone ? ' · ' + esc(item.phone) : ''}${item.dosage ? ' · ' + esc(item.dosage) : ''}</option>`).join('')}</select>` : ''}<p id="voiceDescriptionV5"></p><p class="small">Будет заполнен черновик или поиск. Для сохранения пациента, процедуры, продажи или препарата используйте кнопку соответствующего экрана.</p>`;
      if ($('voiceChoiceV5')) $('voiceChoiceV5').onchange = updateVoiceDescription;
      updateVoiceDescription(); voiceStatus('Проверьте распознанный текст и действие.');
    } catch (error) { if (version === voiceVersion) voiceStatus(error.message); }
  };
  global.applyVoiceV5 = async function () {
    if (voiceBusy || !voicePlan) return;
    const plan = voicePlan, selected = selectedVoiceItem(plan);
    try {
      requireAccess();
      if (currentStaff.id !== plan.staffId || $('voiceTextV5').value.trim() !== plan.text) throw new Error('Текст или пользователь изменились. Проверьте команду заново.');
      if (plan.candidates?.length && !selected) throw new Error('Выберите пациента или препарат.');
      voiceBusy = true; $('voiceApplyV5').disabled = true;
      if (plan.kind === 'patient_create') { if (!goNewPatient()) throw new Error('Сначала завершите сохранение текущего пациента.'); $('pname').value = plan.name; $('pphone').value = plan.phone; }
      if (plan.kind === 'patient_find') { await loadPatients(); $('patientSearch').value = plan.query; if ($('patientIncludeArchivedV5')) $('patientIncludeArchivedV5').checked = false; show('patients'); renderPatients(); }
      if (plan.kind === 'procedure') {
        if (selected && isArchived(patientById(selected.id))) throw new Error('Пациент в архиве. Сначала восстановите карточку.');
        await openProcedure(selected?.id || null);
        if (!$('procedure').classList.contains('active') && !$('shift').classList.contains('active')) throw new Error('Не удалось открыть процедуру. Проверьте сообщение на главном экране.');
      }
      if (plan.kind === 'med_find') {
        const target = activeTreatment();
        if (target) { $(target + 'MedSearch').value = plan.query; renderMedVisualCatalog(target + 'Meds', plan.query); }
        else { await openStock(); const searchId = owner() ? 'inventorySearch' : 'workSearch'; $(searchId).value = plan.query; owner() ? renderInventory() : renderWorkStock(); }
      }
      if (plan.kind === 'med_create') {
        if (!owner()) throw new Error('Нет доступа к созданию препаратов.');
        openMedForm();
        if (!$('medForm').classList.contains('active') || $('medId').value) throw new Error('Не удалось открыть новую карточку препарата. Завершите текущую операцию и повторите.');
        $('medName').value = plan.name;
      }
      if (['med_add', 'med_change', 'med_remove'].includes(plan.kind)) {
        if (activeTreatment() !== plan.target) throw new Error('Черновик изменился. Повторите проверку команды.');
        const med = meds.find(item => item.id === selected.id); if (!med || med.active === false) throw new Error('Препарат больше недоступен. Повторите поиск.');
        const matching = [...$(plan.target + 'Meds').querySelectorAll('.medrow')].filter(row => row.dataset.medicationId === med.id);
        if (plan.kind === 'med_add') {
          if (matching.length) matching[0].querySelector('.medqty').value = voiceQuantity(voiceQuantity(matching[0].querySelector('.medqty').value) + plan.quantity);
          else addMedRow(plan.target + 'Meds', med.id, plan.quantity);
        } else {
          if (!matching.length) throw new Error('Препарат уже убран из черновика. Проверьте команду снова.');
          if (plan.kind === 'med_remove') matching.forEach(row => row.remove());
          else { matching[0].querySelector('.medqty').value = plan.quantity; matching.slice(1).forEach(row => row.remove()); }
        }
        recalc(); message(plan.target === 'proc' ? 'procedureMessage' : 'saleMessage', 'Черновик изменён. Проверьте назначение и количество перед сохранением.', true);
      }
      voiceBusy = false; global.closeVoiceV5();
    } catch (error) { voiceBusy = false; voiceStatus(error.message); $('voiceApplyV5').disabled = false; }
  };
  function install() {
    const nameLabel = document.querySelector('label[for="pname"]'); if (nameLabel) nameLabel.textContent = 'Имя или ФИО *';
    $('pname').maxLength = 200; $('pname').autocomplete = 'off'; $('pphone').type = 'tel'; $('pphone').inputMode = 'tel';
    const sex = document.createElement('div'); sex.className = 'patient-sex-v5';
    sex.innerHTML = '<label for="psexV5">Пол</label><select id="psexV5"><option value="unknown">Не указан</option><option value="female">Женский</option><option value="male">Мужской</option></select><p class="small">Для сохранения достаточно имени. Остальные поля можно заполнить позже.</p>';
    $('pphone').before(sex);
    const formMessage = document.createElement('div'); formMessage.id = 'patientFormMessageV5'; formMessage.setAttribute('role', 'status'); $('newPatient').querySelector('.card').append(formMessage);
    const filter = document.createElement('div'); filter.id = 'patientArchiveFilterV5'; filter.className = 'hidden patient-archive-filter-v5'; filter.innerHTML = '<label><input id="patientIncludeArchivedV5" type="checkbox"> Показать архив пациентов</label>';
    $('patientSearch').after(filter); $('patientIncludeArchivedV5').onchange = renderPatients;
    $('patientSearch').placeholder = 'Поиск по имени или телефону';
    $('patientList').addEventListener('click', event => { const button = event.target.closest('[data-patient-id]'); if (button) openPatient(button.dataset.patientId).catch(error => message('homeMessage', error.message)); });
    $('patientDocuments').addEventListener('click', event => { const button = event.target.closest('[data-document-path]'); if (button) openPatientDocument(button.dataset.documentPath); });
    $('patientCourses').addEventListener('click', event => { const button = event.target.closest('[data-course-id]'); if (button && !isArchived(patientById(currentPatientId))) setCourseStatus(button.dataset.courseId, button.dataset.courseStatus); });
    const controls = document.createElement('div'); controls.className = 'row patient-controls-v5'; controls.innerHTML = '<button id="patientEditV5" type="button" class="btn secondary hidden">Редактировать</button><button id="patientArchiveV5" type="button" class="btn secondary hidden">Архивировать</button><button id="patientDeleteV10" type="button" class="btn danger hidden">Удалить пациента</button>';
    $('patientCardName').after(controls); $('patientEditV5').onclick = global.editPatientV5; $('patientArchiveV5').onclick = global.archivePatientV5;
    $('patientDeleteV10').onclick = global.deletePatientV10;
    const cardMessage = document.createElement('div'); cardMessage.id = 'patientCardMessageV5'; cardMessage.setAttribute('role', 'status'); controls.after(cardMessage);
    const back = $('newPatient').querySelector(':scope > button'); if (back) back.onclick = () => { const id = editId; editId = null; if (id) openPatient(id); else show('workspace'); };
    const voiceButton = (host, label = '🎙 Голосовой помощник') => { if (!host) return; const button = document.createElement('button'); button.type = 'button'; button.className = 'btn secondary voice-button-v5'; button.textContent = label; button.onclick = global.openVoiceV5; host.append(button); };
    voiceButton($('workspace').querySelector('.home-actions')); voiceButton($('patients').querySelector('.card')); voiceButton($('newPatient').querySelector('.card'));
    for (const prefix of ['proc', 'sale']) { const input = $(prefix + 'MedSearch'); if (input) { const button = document.createElement('button'); button.type = 'button'; button.className = 'btn secondary voice-button-v5'; button.textContent = '🎙 Добавить голосом'; button.onclick = global.openVoiceV5; input.after(button); } }
    const dialog = document.createElement('dialog'); dialog.id = 'voiceDialogV5'; dialog.className = 'voice-dialog-v5'; dialog.setAttribute('aria-labelledby', 'voiceTitleV5');
    dialog.innerHTML = '<div class="row between"><h2 id="voiceTitleV5">Голосовой помощник</h2><button type="button" id="voiceCloseV5" class="btn secondary" aria-label="Закрыть помощник">×</button></div><p class="small">Помощник заполняет поля. Назначения и количество препаратов определяет сотрудник по назначению врача.</p><button type="button" id="voiceListenV5" class="btn primary wide">🎙 Начать запись</button><label for="voiceTextV5">Команда — текст можно исправить</label><textarea id="voiceTextV5" rows="3" maxlength="500" placeholder="Добавь препарат Самыр количество 1"></textarea><button type="button" id="voicePreviewButtonV5" class="btn secondary wide">Проверить команду</button><div id="voiceStatusV5" class="notice" role="status" aria-live="polite"></div><div id="voicePreviewV5" class="voice-preview-v5"></div><button type="button" id="voiceApplyV5" class="btn primary wide" disabled>Подтвердить и заполнить</button><details><summary>Примеры команд</summary><ul><li>Создай пациента Аниса телефон 89001234567</li><li>Найди пациента Аниса</li><li>Создай процедуру для Аниса</li><li>Найди препарат Самыр</li><li>Добавь препарат Самыр количество 1</li><li>Измени препарат Самыр количество 2</li><li>Убери препарат Самыр</li><li>Создай препарат Самыр — только владелец</li></ul><p class="small">Указывайте имя как в карточке пациента. Количество — целое число в единицах списания из карточки препарата. Голосовой помощник не сохраняет процедуры и не списывает препараты.</p></details>';
    document.body.append(dialog); $('voiceCloseV5').onclick = global.closeVoiceV5; $('voiceListenV5').onclick = global.listenVoiceV5; $('voicePreviewButtonV5').onclick = global.previewVoiceV5; $('voiceApplyV5').onclick = global.applyVoiceV5; $('voiceTextV5').oninput = invalidateVoice;
    dialog.addEventListener('cancel', event => { event.preventDefault(); global.closeVoiceV5(); });
    const originalSignOut = signOut;
    signOut = async function () { ++patientSession; ++cardVersion; ++listVersion; saveDraft = null; saveOperation = null; archiveOperation = null; documentOperation = null; archiveBusy = false; documentSaving = false; saving = false; voiceBusy = false; global.closeVoiceV5(); directory = []; documentDrafts.clear(); archiveDrafts.clear(); editId = null; fillPatientForm(); currentPatientId = null; $('patientIncludeArchivedV5').checked = false; for (const id of ['patientHistory', 'patientDocuments', 'patientCourses', 'patientCardInfo', 'lastProcedure']) $(id).textContent = ''; await originalSignOut(); };
  }
  install();
})(typeof window !== 'undefined' ? window : globalThis);
