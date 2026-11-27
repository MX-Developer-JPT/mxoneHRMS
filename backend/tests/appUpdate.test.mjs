// Run: node --test backend/tests/appUpdate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolicy, updateAnswer, DEFAULT_POLICY } from '../utils/appUpdate.js';
import { checkAppUpdate, installedBuild } from '../../maxvolt-hr/src/lib/appUpdate.js';

const on = { enabled: true, min_build: 16, min_version: '1.2.2' };
const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };
const server = (policy) => async (body) => ({ success: true, ...updateAnswer(policy, body) });
const info = (build) => async () => ({ build: String(build) });
const offline = async () => { throw new Error('offline'); };

test('off by default, and can never be switched on without a build number', () => {
  assert.equal(updateAnswer(DEFAULT_POLICY, { platform: 'android', build: 1 }).required, false);
  assert.equal(normalizePolicy({ enabled: true }).enabled, false);
  assert.equal(normalizePolicy({ enabled: 'yes', min_build: 16 }).enabled, false);
  assert.equal(normalizePolicy({ enabled: true, min_build: '-3' }).enabled, false);
});

test('only older Android apps are blocked', () => {
  const q = (platform, build) => updateAnswer(on, { platform, build }).required;
  assert.deepEqual([q('android', 14), q('android', 15), q('android', 16), q('android', 17), q('android', 0)], [true, true, false, false, true]);
  assert.deepEqual([q('ios', 1), q('web', 1), q('android', null), q('android', undefined), q('android', 'x')], [false, false, false, false, false]);
});

test('the app: blocked when old, released after updating', async () => {
  const storage = store();
  assert.equal((await checkAppUpdate({ platform: 'android', getInfo: info(14), fetchPolicy: server(on), storage })).required, true);
  assert.equal(await checkAppUpdate({ platform: 'android', getInfo: info(16), fetchPolicy: server(on), storage }), null);
  assert.equal(await checkAppUpdate({ platform: 'ios', getInfo: info(1), fetchPolicy: server(on), storage }), null);
});

test('offline: a required update stays required for that build only; switching the rule off releases', async () => {
  const storage = store();
  await checkAppUpdate({ platform: 'android', getInfo: info(14), fetchPolicy: server(on), storage });
  assert.equal((await checkAppUpdate({ platform: 'android', getInfo: info(14), fetchPolicy: offline, storage })).required, true);
  assert.equal(await checkAppUpdate({ platform: 'android', getInfo: info(16), fetchPolicy: offline, storage }), null);
  assert.equal(await checkAppUpdate({ platform: 'android', getInfo: info(14), fetchPolicy: server({ ...on, enabled: false }), storage }), null);
  assert.equal(await checkAppUpdate({ platform: 'android', getInfo: info(14), fetchPolicy: offline, storage }), null);
});

test('an app too old to report its build counts as old; any other read failure never blocks', async () => {
  assert.equal(await installedBuild(async () => { throw Object.assign(new Error('"App" plugin is not implemented on android'), { code: 'UNIMPLEMENTED' }); }), 0);
  assert.equal(await installedBuild(async () => { throw new Error('bridge busy'); }), null);
  assert.equal(await installedBuild(async () => ({})), null);
});
