const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVoiceCommand, voiceQuantity, isArchived } = require('../crm-patients-v5.js');

test('patient voice draft permits a single name and optional phone', () => {
  assert.deepEqual(parseVoiceCommand('Создай пациента Аниса'), { kind: 'patient_create', name: 'Аниса', phone: '' });
  assert.deepEqual(parseVoiceCommand('Создай пациента имя Анна телефон +7 (900) 123-45-67'), { kind: 'patient_create', name: 'Анна', phone: '+79001234567' });
  assert.throws(() => parseVoiceCommand('Создай пациента Анна телефон восемь девятьсот'), /цифрами/);
});
test('medical quantities must be explicit positive whole consumption units', () => {
  assert.deepEqual(parseVoiceCommand('Добавь препарат Самыр количество 1'), { kind: 'med_add', query: 'Самыр', quantity: 1 });
  assert.deepEqual(parseVoiceCommand('Добавь препарат Самыр количество 1 ампула'), { kind: 'med_add', query: 'Самыр', quantity: 1 });
  assert.deepEqual(parseVoiceCommand('Измени препарат Физраствор количество 100 мл'), { kind: 'med_change', query: 'Физраствор', quantity: 100 });
  assert.deepEqual(parseVoiceCommand('Добавь Самыр 400 мг 1 ампула'), { kind: 'med_add', query: 'Самыр 400 мг', quantity: 1 });
  for (const text of ['Добавь препарат Самыр', 'Добавь препарат Самыр 400 мг', 'Измени препарат Самыр количество 0', 'Добавь Самыр количество 1,5']) assert.throws(() => parseVoiceCommand(text));
  for (const amount of [0, -1, '1.5', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => voiceQuantity(amount));
});
test('voice never accepts save, dispensing, price, or dosing commands', () => {
  for (const text of ['Сохрани процедуру', 'Спиши Самыр количество 1', 'Поставь диагноз', 'Назначь Самыр', 'Измени дозировку Самыр 400 мг', 'Измени цену Самыр 500']) assert.throws(() => parseVoiceCommand(text));
  assert.deepEqual(parseVoiceCommand('Убери препарат Самыр'), { kind: 'med_remove', query: 'Самыр' });
});
test('patient and medication searches and new procedure retain exact user query', () => {
  assert.deepEqual(parseVoiceCommand('Найди пациента Анна'), { kind: 'patient_find', query: 'Анна' });
  assert.deepEqual(parseVoiceCommand('Создай процедуру для Анна'), { kind: 'procedure', query: 'Анна' });
  assert.deepEqual(parseVoiceCommand('Создай процедуру'), { kind: 'procedure', query: '' });
  assert.deepEqual(parseVoiceCommand('Найди препарат Самыр 400 мг'), { kind: 'med_find', query: 'Самыр 400 мг' });
});
test('archive formats exclude records without deleting history', () => {
  assert.equal(isArchived({ archived_at: '2026-10-06T10:00:00Z' }), true);
  assert.equal(isArchived({ archived: true }), true);
  assert.equal(isArchived({ archived_at: null, archived: false }), false);
});
