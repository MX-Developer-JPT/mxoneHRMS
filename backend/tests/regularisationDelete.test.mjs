// Undoing a regularisation, and the last-open-session rule. Run: node backend/tests/regularisationDelete.test.mjs
import assert from 'node:assert/strict';
import { absentForNoCheckout } from '../utils/odRules.js';
import { snapshotBefore, ownsDay, dayWithoutRegularisation } from '../utils/regularisationRestore.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

t('a day left open is absent only when no earlier session exists (older days unchanged)', () => {
  assert.equal(absentForNoCheckout('2026-11-28', 1), true);
  assert.equal(absentForNoCheckout('2026-11-28', 2), false);
  assert.equal(absentForNoCheckout('2026-11-27', 2), true);
});
t('the first copy of a day is kept through later requests', () => {
  const first = snapshotBefore({ id: 'a', status: 'absent' });
  assert.deepEqual(first, { id: 'a', status: 'absent' });
  assert.equal(snapshotBefore({ regularised: true, pre_regularisation: first }), first);
  assert.equal(snapshotBefore({ regularised: true }), undefined);
});
t('only the request that set the day owns it', () => {
  assert.ok(ownsDay({ regularised: true, regularisation_id: 'r1' }, { id: 'r1' }));
  assert.ok(!ownsDay({ regularised: true, regularisation_id: 'r2' }, { id: 'r1', status: 'completed' }));
  assert.ok(!ownsDay({ status: 'absent' }, { id: 'r1', status: 'pending' }));
});
t('an admin edit or leave made later is left alone', () => {
  for (const att of [{ regularised: true, admin_marked: true, status: 'present' }, { regularised: true, status: 'leave' }]) {
    const r = dayWithoutRegularisation(att, {}, [], { past: true, engine: {} });
    assert.deepEqual([r.action, r.day.status, r.day.regularised], ['kept', att.status, undefined]);
  }
});
t('a record made by the request with nothing recorded is removed', () => {
  const r = dayWithoutRegularisation({ regularised: true, created_by_regularisation: true, check_in_time: 'x' }, { requested_check_in: '09:00' }, [], { past: true, engine: {} });
  assert.deepEqual([r.action, r.day], ['removed', null]);
});
console.log(`\n${n} passed`);
