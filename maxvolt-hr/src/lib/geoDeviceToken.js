// A short-lived, geofence/trip-only token for the phone's NATIVE background code (see backend issueGeofenceDeviceToken).
// It lasts 30 days and is renewed every time the app starts (and at least weekly while the app stays open), so a phone that is used
// keeps working and a phone that is lost or abandoned stops by itself. It can be cancelled early: signing out revokes this phone's
// token; a password change, or HR pressing "Sign out phones", revokes every phone of that person.
import { base44 } from '@/api/base44Client';

const KEY = 'geo_device_token_v1';
const FRESH_MS = 7 * 86400000;

function uidFromJwt(t) {
  try { return JSON.parse(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).id || null; } catch { return null; }
}
function didFromJwt(t) {
  try { return JSON.parse(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).did || null; } catch { return null; }
}

// refresh: true = always ask the server for a new token (used once per app start, which also replaces a token HR has just revoked)
export async function getGeoDeviceToken({ refresh = false } = {}) {
  const login = localStorage.getItem('base44_access_token') || '';
  const uid = uidFromJwt(login);
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!refresh && cached?.token && cached.uid === uid && Date.now() - cached.at < FRESH_MS) return cached.token;
    const r = await base44.functions.invoke('issueGeofenceDeviceToken', {}); const d = r?.data || r;
    if (d?.success && d.token) { localStorage.setItem(KEY, JSON.stringify({ token: d.token, uid, at: Date.now() })); return d.token; }
  } catch { /* fall back to the login token / the previous one */ }
  try { const cached = JSON.parse(localStorage.getItem(KEY) || 'null'); if (cached?.token && cached.uid === uid) return cached.token; } catch { /* none */ }
  return login;
}

// Sign-out: cancel this phone's token on the server, then forget it.
export async function revokeGeoDeviceToken() {
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) || 'null');
    const did = cached?.token ? didFromJwt(cached.token) : null;
    if (did) await base44.functions.invoke('revokeDeviceTokens', { device_id: did });
  } catch { /* offline: the 30-day limit still applies */ }
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
