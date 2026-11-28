// Month-wise birthdays and work anniversaries. Run: node backend/tests/celebrations.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { celebrationsFor, buildCelebrationWorkbook, dateParts } from '../utils/celebrations.js';
const ExcelJS = createRequire(import.meta.url)('exceljs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const e = (code, dob, doj, extra = {}) => ({ employee_code: code, display_name: `N ${code}`, status: 'active', date_of_birth: dob, date_of_joining: doj, ...extra });
const list = [e('A', '1990-12-20', '2024-03-01'), e('B', '05-12-1992', '2023-12-02'), e('C', '1991-01-01', '2026-12-10'), e('D', '1993-12-03', '2022-12-15', { status: 'resigned' }), e('E', '', '2020-12-31'), e('F', '1996-02-29', '2025-06-01')];

await t('lists current employees by day, with years completed and no birth year', async () => {
  const r = celebrationsFor(list, 12, 2026);
  assert.deepEqual(r.rows.map((x) => x.employee_code), ['B', 'A', 'E']);
  assert.deepEqual([r.rows[0].birthday, r.rows[0].anniversary, r.rows[0].years], ['05 Dec', '02 Dec', 3]);
  assert.equal(r.totals.birthdays, 2); assert.equal(r.totals.anniversaries, 2); assert.equal(r.totals.missing_birth_date, 1);
  assert.ok(!JSON.stringify(r.rows).includes('1990') && !JSON.stringify(r.rows).includes('1992'));
});
await t('someone who joined this year has no anniversary yet; leap-day birthdays stay in February', async () => {
  assert.ok(!celebrationsFor(list, 12, 2026).rows.some((x) => x.employee_code === 'C'));
  assert.equal(celebrationsFor(list, 2, 2027).rows[0].birthday, '29 Feb');
  assert.equal(dateParts('2026-02-30'), null);
});
await t('the Excel has the month list, or one sheet per month', async () => {
  const one = new ExcelJS.Workbook(); const a = await buildCelebrationWorkbook(list, { month: 12, year: 2026 }, ExcelJS); await one.xlsx.load(a.buffer);
  assert.deepEqual(one.worksheets.map((w) => w.name), ['December list', 'Birthdays', 'Work anniversaries']);
  assert.equal(a.filename, 'Birthdays_Anniversaries_December_2026.xlsx');
  const only = new ExcelJS.Workbook(); await only.xlsx.load((await buildCelebrationWorkbook(list, { month: 12, year: 2026, kind: 'birthday' }, ExcelJS)).buffer);
  assert.equal(only.worksheets.length, 2);
  const all = new ExcelJS.Workbook(); await all.xlsx.load((await buildCelebrationWorkbook(list, { month: 0, year: 2026 }, ExcelJS)).buffer);
  assert.equal(all.worksheets.length, 12);
});
await t('contact numbers and emails appear on the list and in every month sheet', async () => {
  const one = [e('Z', '1990-12-20', '2020-12-01', { phone: '9876500000', official_phone: '9876511111', official_email: '', login_email: 'z@work.test', personal_email: 'z@home.test' })];
  const row = celebrationsFor(one, 12, 2026).rows[0];
  assert.deepEqual([row.phone, row.official_phone, row.email, row.personal_email], ['9876500000', '9876511111', 'z@work.test', 'z@home.test']);
  assert.equal(celebrationsFor([{ ...one[0], login_email: 'Z@home.test' }], 12, 2026).rows[0].email, '', 'a personal login is not shown twice');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await buildCelebrationWorkbook(one, { month: 12, year: 2026 }, ExcelJS)).buffer);
  for (const ws of wb.worksheets) { const text = JSON.stringify(ws.getSheetValues()); assert.ok(text.includes('9876500000') && text.includes('z@work.test') && text.includes('z@home.test') && text.includes('Contact number'), ws.name); }
});
console.log(`\n${n} passed`);
