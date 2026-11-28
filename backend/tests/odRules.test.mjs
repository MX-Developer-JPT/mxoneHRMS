// On Duty follows biometric attendance rules; everything else is unchanged. Run: node backend/tests/odRules.test.mjs
// The status rules live beside the database code, so they run only when DATABASE_URL points to a (throwaway) database.
import assert from 'node:assert/strict';
import { isRuledOd, OD_RULES_FROM } from '../utils/odRules.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

t('only On Duty selfie days from the rule date are covered', () => {
  assert.ok(isRuledOd({ selfie_reason: 'od', date: OD_RULES_FROM }) && isRuledOd({ selfie_reason: 'od', date: '2027-01-05' }));
  assert.ok(!isRuledOd({ selfie_reason: 'od', date: '2026-11-27' }) && !isRuledOd({ selfie_reason: 'wfh', date: '2027-01-05' }) && !isRuledOd({ status: 'on_duty', date: '2027-01-05' }) && !isRuledOd({ date: '2027-01-05' }));
});

if (process.env.DATABASE_URL) {
  const { applyDeclaredStatus, computeStatusFromSessions, buildSessions } = await import('../routes/attendancelog.js');
  const shift = { start_time: '09:00', end_time: '18:00', working_hours: 9, grace_period_minutes: 15 };
  const D = '2026-12-01';
  const day = (a, b) => { const p = [{ time: `${D}T${a}:00.000Z`, device_direction: 'IN' }]; if (b) p.push({ time: `${D}T${b}:00.000Z`, device_direction: 'OUT' }); return computeStatusFromSessions(buildSessions(p), shift); };
  const judge = (computed, extra = {}) => applyDeclaredStatus({ date: D, ...extra }, computed);
  const asOd = (status) => (status === 'present' ? 'on_duty' : status);

  t('an OD day gets the same verdict as a biometric day, with Present shown as On Duty', () => {
    for (const [a, b] of [['09:00', '18:00'], ['10:00', '18:00'], ['10:00', '19:00'], ['09:00', '14:00'], ['09:00', '11:00'], ['09:00', null]]) {
      const bio = judge(day(a, b)), od = judge(day(a, b), { selfie_reason: 'od' });
      assert.equal(od.status, asOd(bio.status), `${a}-${b}`);
      for (const k of ['late_minutes', 'late_arrival', 'early_departure_minutes', 'early_departure', 'overtime_minutes']) assert.equal(od[k], bio[k], `${a}-${b} ${k}`);
    }
    assert.equal(judge(day('09:00', '11:00'), { selfie_reason: 'od' }).status, 'short_attendance');
    assert.equal(judge(day('09:00', null), { selfie_reason: 'od' }).status, 'in_progress');
  });
  t('gate pass rules apply to OD days exactly as to biometric days', () => {
    for (const flag of ['gate_pass_half_day', 'gate_pass_official', 'gate_pass_departure_checkout']) {
      assert.equal(judge(day('09:00', '11:00'), { [flag]: true, selfie_reason: 'od' }).status, asOd(judge(day('09:00', '11:00'), { [flag]: true }).status), flag);
    }
  });
  t('Work From Home and plain biometric days are unchanged', () => {
    const wfh = judge(day('11:00', '12:00'), { selfie_reason: 'wfh' });
    assert.deepEqual([wfh.status, wfh.late_minutes, wfh.early_departure], ['work_from_home', 0, false]);
    assert.equal(judge(day('09:00', '18:00')).status, 'present');
    assert.equal(judge(day('09:00', '11:00'), { gate_pass_half_day: true }).status, 'half_day');
  });
  t('days before the change keep the earlier OD treatment', () => {
    const old = applyDeclaredStatus({ selfie_reason: 'od', date: '2026-11-20' }, day('11:00', '12:00'));
    assert.deepEqual([old.status, old.late_minutes], ['on_duty', 0]);
  });
}
console.log(`\n${n} passed${process.env.DATABASE_URL ? '' : ' (status rules skipped: set DATABASE_URL to a local database)'}`);
process.exit(0);
