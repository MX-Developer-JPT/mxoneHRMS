// A long-lived, geofence/trip-only token for the phone's NATIVE background code (see backend issueGeofenceDeviceToken).
// The normal login token lasts 30 days; native tracking must keep working when the app is not opened for longer.
import { base44 } from '@/api/base44Client';

const KEY = 'geo_device_token_v1';

function uidFromJwt(t) {
  try { return JSON.parse(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).id || null; } catch { return null; }
}

export async function getGeoDeviceToken() {
  const login = localStorage.getItem('base44_access_token') || '';
  const uid = uidFromJwt(login);
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (cached?.token && cached.uid === uid && Date.now() - cached.at < 90 * 86400000) return cached.token;
    const r = await base44.functions.invoke('issueGeofenceDeviceToken', {}); const d = r?.data || r;
    if (d?.success && d.token) { localStorage.setItem(KEY, JSON.stringify({ token: d.token, uid, at: Date.now() })); return d.token; }
  } catch { /* fall back to the login token */ }
  return login;
}
