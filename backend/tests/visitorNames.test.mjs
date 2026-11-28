// Blank names on visit records are filled from the ids they hold. Run: node backend/tests/visitorNames.test.mjs
import assert from 'node:assert/strict';
import { fillNames, missingIds } from '../utils/visitorNames.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const visit = { host_user_id: 'a', created_by: 'a', approved_by: 'b', approved_by_name: 'Kept', check_in_by: null, check_in_by_name: 'Kiosk — Lobby', events: [{ by_id: 'a' }, { by_name: 'System' }] };

t('only blanks with a known id are filled, and the original is untouched', () => {
  const [v] = fillNames([visit], new Map([['a', 'Neha'], ['b', 'Other']]));
  assert.deepEqual([v.host_name, v.created_by_name, v.approved_by_name, v.check_in_by_name, v.events[0].by_name, v.events[1].by_name], ['Neha', 'Neha', 'Kept', 'Kiosk — Lobby', 'Neha', 'System']);
  assert.equal(visit.host_name, undefined);
});
t('only the ids that are needed are looked up', () => {
  assert.deepEqual(missingIds([visit]), ['a']);
  assert.equal(fillNames([{ host_user_id: 'zz' }], new Map())[0].host_name, undefined);
});
console.log(`\n${n} passed`);
