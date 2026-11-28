// Attendance transfer rules. Run: node backend/tests/attendanceTransfer.test.mjs
import assert from 'node:assert/strict';
import { planTransfer, suggestPairs, hasContent } from '../utils/attendanceTransferRules.js';
import { rosterFor, joinedFrom } from '../utils/leavers.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const r = (id, date, extra = {}) => ({ id, data: { date, status: 'present', check_in_time: `${date}T09:00:00.000Z`, ...extra } });
const empty = (id, date) => ({ id, data: { date, status: 'absent', auto_marked: true } });

t('days move, placeholders are replaced, real records on the new code are kept by default', () => {
  const old = [r('a', '2026-11-01'), r('b', '2026-11-02'), r('c', '2026-11-03'), empty('d', '2026-11-04'), r('e', '2026-11-05')];
  const neu = [empty('x', '2026-11-02'), r('y', '2026-11-03'), r('z', '2026-11-04'), empty('w', '2026-11-06')];
  const p = planTransfer(old, neu);
  assert.deepEqual(p.move.map((x) => x.id), ['a', 'b', 'e']); assert.deepEqual(p.remove.map((x) => x.id), ['x']); assert.deepEqual(p.keep.map((x) => x.id), ['c', 'd']);
  assert.equal(p.clashes.length, 1); assert.deepEqual([p.first, p.last], ['2026-11-01', '2026-11-05']);
  const u = planTransfer(old, neu, { onClash: 'use_old' });
  assert.deepEqual(u.move.map((x) => x.id), ['a', 'b', 'c', 'e']); assert.deepEqual(u.remove.map((x) => x.id), ['x', 'y']);
  assert.deepEqual(planTransfer(old, neu, { from: '2026-11-02', to: '2026-11-02' }).move.map((x) => x.id), ['b']);
  assert.ok(hasContent({ status: 'leave' }) && hasContent({ status: 'absent', regularised: true }) && !hasContent({ status: 'week_off' }));
});
t('suggestions need an identity match or the same name', () => {
  const s = suggestPairs([{ user_id: 'o1', display_name: 'Ravi Kumar', pan_number: 'ABCDE1234F' }, { user_id: 'o2', display_name: 'Neha', phone: '9876543210' }, { user_id: 'o3', display_name: 'A Singh' }],
    [{ user_id: 'n1', display_name: 'Ravi K', pan_number: 'abcde1234f' }, { user_id: 'n2', display_name: 'Someone Else', phone: '9876543210' }, { user_id: 'n3', display_name: 'a singh' }]);
  assert.deepEqual(s.map((x) => [x.old_user_id, x.new_user_id, x.strong]), [['o1', 'n1', true], ['o3', 'n3', false]]);
});
t('the old record drops off month reports once empty; the new one counts from the first moved day', () => {
  const old = { user_id: 'o', status: 'resigned', exit_date: '2026-11-20', attendance_transferred_to: 'n' };
  assert.equal(rosterFor([old], '2026-11-01').length, 0); assert.equal(rosterFor([old], '2026-11-01', new Set(['o'])).length, 1);
  assert.equal(joinedFrom({ date_of_joining: '2026-11-21', attendance_from: '2026-04-01' }), '2026-04-01');
  assert.equal(joinedFrom({ date_of_joining: '2026-11-21' }), '2026-11-21');
});
console.log(`\n${n} passed`);
