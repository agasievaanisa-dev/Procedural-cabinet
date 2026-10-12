# Изменения 5.5.7

Исправлены сохранения, отчёт смены, ввод остатков и карточка пациента. Добавлены печать полной истории, редактирование до оплаты без ручного комментария и визуальное выделение импортных препаратов.

## Проверки

- `npm test`: 24 набора, все прошли.
- `npm run test:browser`: 201 сценарий, все прошли.
- Новые SQL-наборы v16/v17/v18/v19: локальная и рабочая базы, синтетические данные, ROLLBACK.
- Прежние локальные SQL-наборы клинического учёта, финансов, журнала и отложенной оплаты прошли.
- Складские исходники и канонические копии четырёх миграций сверены; `git diff --check` прошёл.

## Файлы выпуска

- `README.md`
- `crm-app-v5.css`
- `crm-clinical-v10.js`
- `crm-finance-v5.css`
- `crm-finance-v5.js`
- `crm-inline-stock-v8.js`
- `crm-management-v5.js`
- `crm-medication-delete-v7.js`
- `crm-medication-origin-v21.css`
- `crm-medication-origin-v21.js`
- `crm-patient-card-v20.css`
- `crm-patient-card-v20.js`
- `crm-patient-courses-v16.js`
- `crm-patients-v5.js`
- `crm-save-recovery-v16.js`
- `crm-stock-correction-v6.js`
- `crm-stock-totals-v18.css`
- `crm-stock-totals-v18.js`
- `db/crm-clinical-v10-test.sql`
- `db/crm-save-recovery-v16-test.sql`
- `db/crm-save-recovery-v16.sql`
- `db/crm-shift-summary-v17-test.sql`
- `db/crm-shift-summary-v17.sql`
- `db/crm-stock-totals-v18-test.sql`
- `db/crm-stock-totals-v18.sql`
- `db/crm-unpaid-edit-v19-test.sql`
- `db/crm-unpaid-edit-v19.sql`
- `docs/RELEASE-5.5.7.md`
- `index.html`
- `package-lock.json`
- `package.json`
- `quick-v4.js`
- `supabase/migrations/20261012024154_crm_save_recovery_v16.sql`
- `supabase/migrations/20261012074054_crm_shift_summary_v17.sql`
- `supabase/migrations/20261012084200_crm_stock_totals_v18.sql`
- `supabase/migrations/20261012152715_crm_unpaid_edit_v19.sql`
- `tests/bulk-import-save-recovery-browser.spec.cjs`
- `tests/bulk-import-save-recovery.test.cjs`
- `tests/crm-clinical-save-recovery.test.cjs`
- `tests/crm-finance.test.cjs`
- `tests/crm-inline-stock-browser.spec.cjs`
- `tests/crm-login-browser.spec.cjs`
- `tests/crm-management-browser.spec.cjs`
- `tests/crm-management-save-recovery-v16.test.cjs`
- `tests/crm-medication-delete.test.cjs`
- `tests/crm-patient-card-browser.spec.cjs`
- `tests/crm-patient-card-v20.test.cjs`
- `tests/crm-patient-courses-browser.spec.cjs`
- `tests/crm-patient-save-recovery-browser.spec.cjs`
- `tests/crm-payment-only.test.cjs`
- `tests/crm-payment-pending-browser.spec.cjs`
- `tests/crm-save-recovery-v16.test.cjs`
- `tests/crm-save-transport-browser.spec.cjs`
- `tests/crm-shift-print-browser.spec.cjs`
- `tests/crm-shift-print.test.cjs`
- `tests/crm-shift-summary-browser.spec.cjs`
- `tests/crm-stock-correction-browser.spec.cjs`
- `tests/crm-stock-correction.test.cjs`
- `tests/crm-stock-delete-save-recovery.test.cjs`
- `tests/crm-stock-totals-browser.spec.cjs`
- `tests/crm-unpaid-edit-v19-browser.spec.cjs`
- `tests/crm-unpaid-edit-v19.test.cjs`
- `tests/medication-save-recovery-browser.spec.cjs`
- `tests/medication-save-recovery.test.cjs`
- `tests/quick-transfer-save-recovery.test.cjs`
- `tests/quick-ui.test.cjs`
- `tests/warehouse.test.cjs`
- `warehouse-v3.js`
- `warehouse.js`
- `workflow-v3.js`
