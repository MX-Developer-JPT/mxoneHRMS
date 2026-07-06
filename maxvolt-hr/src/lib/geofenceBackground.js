// True background geofencing inside the Capacitor shell — attendance is marked
// even while the app is closed/backgrounded, unlike the foreground-only JS
// watcher in MarkAttendance.jsx (which only runs while that page is open and
// the app is in the foreground; it remains the fallback for plain browser/PWA
// use, where no native background plugin is available at all).
//
// Implementation note: this uses @capacitor-community/background-geolocation,
// which runs a genuine Android foreground service (visible notification,
// required by Android policy — this is intentional, not a bug, and is the
// same trade-off delivery/ride-share apps make) / iOS "Always" background
// location, rather than OS-level geofence regions. The enter/exit distance
// check runs here in JS on every location update and calls the same
// idempotent nativeGeofenceEvent endpoint the native Android spec describes
// (docs/NATIVE_GEOFENCING_SPEC.md) — the endpoint doesn't care which native
// mechanism triggered it.
import { base44 } from '@/api/base44Client';

let watcherId = null;
let fence = null;
let lastKnownInProgress = null; // null = unknown yet; avoids resending 'enter' every location tick once we know we're in

const distMetres = (lat1, lng1, lat2, lng2) => {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

async function getCapacitor() {
  try { return (await import('@capacitor/core')).Capacitor; } catch { return null; }
}

export async function isBackgroundGeofenceAvailable() {
  const Capacitor = await getCapacitor();
  return !!Capacitor?.isNativePlatform();
}

export async function startBackgroundGeofence() {
  const Capacitor = await getCapacitor();
  if (!Capacitor?.isNativePlatform()) return { started: false, reason: 'not_native' };
  if (watcherId) return { started: true, reason: 'already_running' };

  let fenceRes;
  try {
    fenceRes = await base44.functions.invoke('getMyGeofence', {});
  } catch (e) {
    return { started: false, reason: 'fetch_failed', error: e.message };
  }
  const d = fenceRes.data || fenceRes;
  if (!d?.success || !d.fence) return { started: false, reason: 'no_fence_assigned' };
  fence = d.fence;
  lastKnownInProgress = d.attendance_today?.checked_in && !d.attendance_today?.checked_out ? true : null;

  // This plugin ships no JS wrapper (native source + type defs only) — the
  // documented usage is to register it directly via Capacitor's registerPlugin.
  const { registerPlugin } = await import('@capacitor/core');
  const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
  const platformTag = Capacitor.getPlatform() === 'ios' ? 'native_ios' : 'native_android';

  try {
    watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'Maxvolt HR — Attendance tracking active',
        backgroundMessage: `Watching your location to mark attendance at ${fence.name}`,
        requestPermissions: true,
        stale: false,
        distanceFilter: 15, // matches the GPS noise-floor threshold used elsewhere in the app
      },
      (location, error) => {
        if (error) {
          console.warn('[geofenceBackground] watcher error:', error.code, error.message);
          return;
        }
        if (location) handleLocation(location, platformTag).catch(() => {});
      }
    );
    localStorage.setItem('background_geofence', '1');
    return { started: true, fence };
  } catch (e) {
    console.warn('[geofenceBackground] failed to start:', e.message);
    watcherId = null;
    return { started: false, reason: 'start_failed', error: e.message };
  }
}

export async function stopBackgroundGeofence() {
  localStorage.setItem('background_geofence', '0');
  if (!watcherId) return;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
    await BackgroundGeolocation.removeWatcher({ id: watcherId });
  } catch { /* best-effort */ }
  watcherId = null;
  fence = null;
  lastKnownInProgress = null;
}

// Resumes tracking on app open if the employee previously turned this on —
// mirrors the Field Duty active-trip resume-on-load already in Layout.jsx.
export async function resumeBackgroundGeofenceIfEnabled() {
  if (localStorage.getItem('background_geofence') !== '1') return;
  await startBackgroundGeofence();
}

async function handleLocation(location, platformTag) {
  if (!fence) return;
  if (location.accuracy > 100) return; // background fixes are noisier than foreground; still bounded
  const d = distMetres(location.latitude, location.longitude, Number(fence.latitude), Number(fence.longitude));
  const inside = d <= Number(fence.radius_m);
  const wellOutside = d > Number(fence.radius_m) + 100; // spatial hysteresis against boundary jitter, not a time delay

  if (inside && lastKnownInProgress !== true) {
    await sendEvent('enter', location, platformTag);
  } else if (wellOutside && lastKnownInProgress !== false) {
    await sendEvent('exit', location, platformTag);
  }
}

async function sendEvent(event, location, platformTag) {
  try {
    const res = await base44.functions.invoke('nativeGeofenceEvent', {
      event,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      occurred_at: new Date(location.time || Date.now()).toISOString(),
      location_name: fence.name,
      is_mock: !!location.simulated,
      device_id: 'capacitor-background-geolocation',
      source: platformTag,
    });
    const d = res.data || res;
    if (d?.success) {
      if (d.action === 'checked_in') lastKnownInProgress = true;
      else if (d.action === 'checked_out') lastKnownInProgress = false;
      else if (d.reason === 'already_checked_in') lastKnownInProgress = true;
      else if (d.reason === 'already_checked_out' || d.reason === 'not_checked_in') lastKnownInProgress = false;
    }
  } catch { /* next location update will retry */ }
}
