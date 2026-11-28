// The signed-in user's name is added to a request. Run: node backend/tests/actorName.test.mjs
import assert from 'node:assert/strict';
import { withName, clearActorNames } from '../utils/actorName.js';
let n = 0; const t = async (name, fn) => { clearActorNames(); await fn(); n++; console.log('ok  ', name); };

await t('adds the name once per user and keeps the rest of the token', async () => {
  let reads = 0; const look = async () => { reads++; return 'Neha Verma'; };
  const u = await withName({ id: '1', email: 'n@x.com', role: 'hr' }, look);
  assert.deepEqual(u, { id: '1', email: 'n@x.com', role: 'hr', full_name: 'Neha Verma', display_name: 'Neha Verma' });
  await withName({ id: '1' }, look); assert.equal(reads, 1);
});
await t('nobody, an unknown name or a failed read leaves the user as it was', async () => {
  assert.equal(await withName(null), null);
  const a = { id: '2' }; assert.equal(await withName(a, async () => ''), a);
  const b = { id: '3' }; assert.equal(await withName(b, async () => { throw new Error('down'); }), b);
  const c = { id: '4', full_name: 'Kept' }; assert.equal(await withName(c, async () => 'Other'), c);
});
console.log(`\n${n} passed`);
