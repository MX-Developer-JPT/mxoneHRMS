// Revocation of the phone's long-lived "device token" (the one native background tracking uses when the app is not open).
//
// A device token is scoped to three tracking functions only and lasts 30 days (renewed every time the app starts). It can now be
// cancelled early:
//   * one phone  : on sign-out the app revokes that phone's token (its device id, "did")
//   * every phone of one person : a password change / reset, or HR pressing "Sign out phones" on the employee, sets a floor time;
//     every token issued before the floor stops working
// The list lives in one settings row (it is tiny: tokens expire on their own, old entries are dropped) and is cached for 20 s.
import { one, run } from '../db.js';
import { tokenRevoked } from './fieldTracking.js';

const KEY = 'geo_token_revocations';
const TTL_MS = 20000;
const KEEP_MS = 35 * 86400000;     // a token lives 30 days; entries older than that can no longer matter
let cache = null, cacheAt = 0;

async function load() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  let data = { floors: {}, dids: {} };
  try { const r = await one('SELECT value FROM settings WHERE key=$1', [KEY]); if (r) data = { floors: {}, dids: {}, ...JSON.parse(r.value) }; } catch { /* empty */ }
  cache = data; cacheAt = Date.now();
  return data;
}

async function save(data) {
  const now = Date.now();
  for (const [k, v] of Object.entries(data.floors)) if (now - v > KEEP_MS) delete data.floors[k];
  for (const [k, v] of Object.entries(data.dids)) if (now > v) delete data.dids[k];
  await run("INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW()::TEXT) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()::TEXT", [KEY, JSON.stringify(data)]);
  cache = data; cacheAt = Date.now();
}

// Every device token of this person issued before now stops working. (Whole-second floor: a token minted in the same second survives.)
export async function revokeAllDeviceTokens(userId) {
  if (!userId) return;
  const data = await load();
  data.floors[userId] = Math.floor(Date.now() / 1000) * 1000;
  await save(data);
}

// Just one phone's token.
export async function revokeDeviceToken(did) {
  if (!did) return;
  const data = await load();
  data.dids[String(did)] = Date.now() + KEEP_MS;
  await save(data);
}

// decoded = the verified token claims { id, did, iat }
export async function isDeviceTokenRevoked(decoded) {
  if (!decoded) return true;
  return tokenRevoked(await load(), decoded);
}
