// Leavers, overtime, offer salary and the signatory block. Run: node backend/tests/hrEnhancements.test.mjs
import assert from 'node:assert/strict';
import { isLeaver, rosterFor, afterExit } from '../utils/leavers.js';
import { overtimeForDay, workedFromPunches, buildOvertimeReport, cleanPolicy, standardMinutes } from '../utils/overtime.js';
import { computeOfferSalary } from '../utils/offerSalary.js';
import { resolveSigner, signatoryHtml, signatoryNode, parseSignatoryBlock } from '../utils/signatory.js';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const shift = { id: 's', start_time: '09:00', end_time: '18:00', working_hours: 9, grace_period_minutes: 15, days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
const policy = cleanPolicy({});
const eligible = { user_id: 'u', overtime_eligible: true, status: 'active', department: 'Production', display_name: 'A', employee_code: 'E1' };
const at = (d, h) => `${d}T${h}:00.000Z`;
const rec = (date, pairs, extra = {}) => ({ user_id: 'u', date, status: 'present', check_in_time: pairs[0]?.[0], check_out_time: pairs.at(-1)?.[1] || undefined, sessions: pairs.map(([a, b]) => ({ check_in: a, check_out: b })), ...extra });
const day = (record, extra = {}) => overtimeForDay({ record, shift, employee: eligible, policy, ...extra });
const D = '2026-11-10'; // a Tuesday

t('leavers stay on reports up to their last working month, never after', () => {
  const left = { user_id: 'l', status: 'resigned', exit_date: '2026-10-15' };
  assert.ok(isLeaver(left) && isLeaver({ status: 'Left' }) && !isLeaver({ status: 'active', exit_date: '2026-12-01' }));
  assert.equal(rosterFor([left], '2026-10-01').length, 1); assert.equal(rosterFor([left], '2026-09-01').length, 1); assert.equal(rosterFor([left], '2026-11-01').length, 0);
  assert.ok(afterExit(left, '2026-10-16') && !afterExit(left, '2026-10-15') && !afterExit({ status: 'active', exit_date: '2026-10-01' }, '2026-11-01'));
  assert.equal(rosterFor([{ user_id: 'x', status: 'terminated' }], '2026-11-01', new Set(['x'])).length, 1);
});
t('overtime is time beyond the shift hours, once it passes the grace period', () => {
  assert.equal(day(rec(D, [[at(D, '09:00'), at(D, '20:00')]])).ot_minutes, 120);
  assert.equal(day(rec(D, [[at(D, '09:00'), at(D, '18:10')]])).ot_minutes, 0);
  assert.equal(day(rec(D, [[at(D, '11:00'), at(D, '20:00')]])).ot_minutes, 0, 'a late start is not overtime');
});
t('breaks are not worked time and repeated sessions are counted once', () => {
  const r = rec(D, [[at(D, '09:00'), at(D, '13:00')], [at(D, '14:00'), at(D, '20:00')], [at(D, '14:00'), at(D, '20:00')]]);
  assert.equal(workedFromPunches(r).minutes, 600); assert.equal(day(r).ot_minutes, 60);
});
t('an overnight shift counts across midnight', () => {
  const night = { ...shift, start_time: '20:00', end_time: '05:00', working_hours: 9 };
  assert.equal(day(rec(D, [[at(D, '20:00'), at('2026-11-11', '07:00')]]), { shift: night }).ot_minutes, 120);
  assert.equal(standardMinutes({ start_time: '20:00', end_time: '05:00' }), 540);
});
t('a missing punch adds nothing and is reported; an impossible day is held for checking', () => {
  const open = day(rec(D, [[at(D, '09:00'), null]]));
  assert.equal(open.ot_minutes, 0); assert.ok(open.missing_punch);
  const long = day(rec(D, [[at(D, '00:01'), at(D, '20:00')]]));
  assert.equal(long.ot_minutes, 0); assert.ok(long.check);
});
t('weekly offs and holidays count every worked minute; half-day holidays shorten the day', () => {
  const sun = '2026-11-08';
  assert.equal(day(rec(sun, [[at(sun, '10:00'), at(sun, '14:00')]])).ot_minutes, 240);
  assert.equal(day(rec(D, [[at(D, '10:00'), at(D, '14:00')]]), { holiday: { date: D } }).day_type, 'holiday');
  assert.equal(day(rec(D, [[at(D, '09:00'), at(D, '16:00')]]), { holiday: { date: D, is_half_day: true, half_day_hours: 5 } }).ot_minutes, 120);
});
t('only eligible employees earn it; absent and leave days never do', () => {
  const r = rec(D, [[at(D, '09:00'), at(D, '21:00')]]);
  assert.equal(day(r, { employee: { ...eligible, overtime_eligible: false } }).ot_minutes, 0);
  assert.equal(day({ ...r, status: 'leave' }).ot_minutes, 0);
  assert.equal(day(r, { employee: { ...eligible, status: 'resigned', exit_date: '2026-11-01' } }).ot_minutes, 0);
});
t('every report view adds up to the same total, with duplicate rows counted once', () => {
  const other = { ...eligible, user_id: 'v', employee_code: 'E2', department: 'Quality' };
  const records = [
    rec('2026-10-31', [[at('2026-10-31', '09:00'), at('2026-10-31', '20:00')]]),
    rec(D, [[at(D, '09:00'), at(D, '20:30')]]), rec(D, [[at(D, '09:00'), at(D, '20:30')]], { user_id: 'u' }),
    rec(D, [[at(D, '09:00'), at(D, '19:00')]], { user_id: 'v' }),
  ];
  const r = buildOvertimeReport({ records, employees: [eligible, other], shiftById: {}, defaultShift: shift, holidayByDate: {}, basicByUser: { u: 20800, v: 41600 }, policy });
  const sum = (list) => list.reduce((s, x) => s + x.ot_minutes, 0);
  assert.equal(r.totals.ot_minutes, 120 + 150 + 60);
  for (const list of [r.days, r.months, r.departments, r.employees]) assert.equal(sum(list), r.totals.ot_minutes);
  assert.equal(r.months.length, 3);
  assert.equal(r.totals.ot_amount, 400 + 500 + 400);   // 100/h x2 x(2h + 2.5h), 200/h x2 x1h
});
t('the offer salary reconciles to the CTC, with and without edited components', () => {
  for (const ctc of [300000, 500000, 999999, 1234567, 2800000]) {
    const s = computeOfferSalary(ctc);
    assert.equal(s.gross_annual + s.contribution_annual, ctc);
    assert.equal(s.rows.earnings.reduce((a, r) => a + r[1], 0), s.gross_annual);
    assert.equal(s.rows.contributions.reduce((a, r) => a + r[1], 0), s.contribution_annual);
    assert.deepEqual(s.problems, []);
  }
  const s = computeOfferSalary(1200000, 500, { basic: 40000, hra: 16000, conveyance: 3000, allowances: [{ name: 'Phone', monthly: 1000 }], deductions: [{ name: 'Professional tax', monthly: 200 }], gratuity: true });
  assert.equal(s.gross_annual + s.contribution_annual, 1200000);
  assert.ok(s.special_monthly > 0 && s.gratuity_monthly === 1924);
  assert.equal(s.net_annual, s.gross_annual - s.deduction_annual);
  assert.equal(s.pf_emp_monthly, 3000);
  assert.ok(computeOfferSalary(200000, 0, { basic: 30000 }).problems.length);
  assert.equal(computeOfferSalary(1200000).pf_emp_monthly, 3000);
  assert.equal(computeOfferSalary(900000, 0, {}, { pfCeiling: 15000 }).pf_emp_monthly, 1800);
});
t('the signatory block keeps stamp above the name and designation', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const list = [{ id: '1', name: 'Asha Rao', designation: 'Head HR', signature: png, is_default: true }];
  assert.equal(resolveSigner(list).name, 'Asha Rao');
  assert.equal(resolveSigner(list, { name: 'Other', designation: 'GM' }).designation, 'GM');
  assert.equal(resolveSigner([], { role: 'HR Head' }).designation, 'HR Head');
  const node = signatoryNode(list[0], { stamp: png });
  const order = node.stack.map((x) => (x.image ? 'img' : x.text));
  assert.deepEqual(order, ['For Maxvolt Energy Industries Limited', 'img', 'img', 'Asha Rao', 'Head HR']);
  assert.ok(node.unbreakable && node.stack[1].margin[1] >= 0 && node.stack[2].margin[3] >= 0);
  const html = signatoryHtml(list[0], { stamp: png });
  assert.equal((html.match(/<div/g) || []).length, 1);
  const m = html.match(/^<div([^>]*)>([\s\S]*?)<\/div>/);
  const back = parseSignatoryBlock(m[1], m[2], list);
  assert.deepEqual(back.signer, { name: 'Asha Rao', designation: 'Head HR', signature: png });
});
console.log(`\n${n} passed`);
