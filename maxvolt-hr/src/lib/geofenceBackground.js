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
let fences = []; // ALL active configured locations — attendance triggers at any of them, not just the employee's assigned one
let currentFenceId = null; // which fence we're currently checked into, if any
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

// Cheap pre-check so the caller can show a prominent in-app disclosure
// BEFORE the OS background-location permission dialog appears — required by
// Google Play's background location policy, separate from the Privacy Policy
// text. Safe to call even when not eligible/not native; just returns false.
export async function checkGeofenceEligibility() {
  const Capacitor = await getCapacitor();
  if (!Capacitor?.isNativePlatform()) return { eligible: false, reason: 'not_native' };
  try {
    const fenceRes = await base44.functions.invoke('getMyGeofence', {});
    const d = fenceRes.data || fenceRes;
    if (!d?.success) return { eligible: false, reason: 'fetch_failed' };
    if (!d.geofence_eligible) return { eligible: false, reason: 'not_eligible' };
    if (!Array.isArray(d.all_fences) || d.all_fences.length === 0) return { eligible: false, reason: 'no_fence_assigned' };
    return { eligible: true };
  } catch (e) {
    return { eligible: false, reason: 'fetch_failed', error: e.message };
  }
}

// Android-only. OEM battery managers (Xiaomi/Oppo/Vivo/Samsung) and stock
// Android's own Doze/App Standby kill the background location service even
// with every runtime permission correctly granted, unless the app is
// exempted from battery optimization — this is the single most common
// real-world reason "always on" tracking silently stops. Best-effort: safe
// to call repeatedly, no-ops on iOS/web, and never throws.
export async function requestBatteryOptimizationExemption() {
  const Capacitor = await getCapacitor();
  if (!Capacitor?.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
    const { ignoring } = await BackgroundGeolocation.isIgnoringBatteryOptimizations();
    if (!ignoring) await BackgroundGeolocation.requestIgnoreBatteryOptimizations();
  } catch { /* best-effort — plugin method availability depends on the patched native build */ }
}

// Android-only, "Allow all the time" escalation — deliberately its own call
// rather than something addWatcher() triggers internally, so it can't ever
// collide with addWatcher()'s own foreground-permission request or with
// Android's single outstanding requestPermissions() slot per Activity. Call
// this AFTER startBackgroundGeofence() has resolved, once foreground
// permission is confirmed, not concurrently with it.
export async function requestBackgroundLocationIfNeeded() {
  const Capacitor = await getCapacitor();
  if (!Capacitor?.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
    await BackgroundGeolocation.requestBackgroundLocationIfNeeded();
  } catch { /* best-effort — plugin method availability depends on the patched native build */ }
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
  if (!d?.success) return { started: false, reason: 'fetch_failed' };
  // HR decides eligibility (Employee.geofence_eligible) — there is no
  // employee-facing on/off control, but tracking still only ever runs for
  // employees HR has actually marked eligible. Checked here too (not just by
  // the caller) so this can't be started via a stale/cached client path.
  if (!d.geofence_eligible) return { started: false, reason: 'not_eligible' };
  if (!Array.isArray(d.all_fences) || d.all_fences.length === 0) return { started: false, reason: 'no_fence_assigned' };
  fences = d.all_fences;
  // Seed from server-known state instead of blanking to null — if the
  // employee is already checked in when this watcher (re)starts (app
  // reopened, native headless mode handing back to JS, etc.) and we don't
  // know which fence that was, a later exit could never be detected once
  // they're no longer inside ANY fence (see handleLocation's nearestFence
  // fallback for the case this still can't resolve, e.g. a non-geofence
  // check-in).
  lastKnownInProgress = d.attendance_today?.is_in_progress ? true : (d.attendance_today?.checked_out ? false : null);
  currentFenceId = null;
  if (lastKnownInProgress && d.attendance_today?.geofence_location) {
    const seeded = fences.find(f => (f.name || '').toLowerCase() === d.attendance_today.geofence_location.toLowerCase());
    if (seeded) currentFenceId = seeded.id;
  }

  // This plugin ships no JS wrapper (native source + type defs only) — the
  // documented usage is to register it directly via Capacitor's registerPlugin.
  const { registerPlugin } = await import('@capacitor/core');
  const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
  const platformTag = Capacitor.getPlatform() === 'ios' ? 'native_ios' : 'native_android';

  try {
    watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'Maxvolt One — Attendance tracking active',
        backgroundMessage: fences.length === 1
          ? `Watching your location to mark attendance at ${fences[0].name}`
          : `Watching your location to mark attendance at ${fences.length} configured locations`,
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

    // Android only (no-op elsewhere) — lets the native service resume
    // tracking with zero JS involvement after a reboot or if the app is
    // swiped from recents while tracking was active. Best-effort: if this
    // fails, JS-driven tracking above still works fine on its own, this
    // only affects the reboot/task-removed fallback path.
    if (Capacitor.getPlatform() === 'android') {
      BackgroundGeolocation.persistHeadlessState({
        token: localStorage.getItem('base44_access_token') || '',
        fencesJson: JSON.stringify(fences),
        apiBase: window.location.origin,
      }).catch(() => {});
    }

    return { started: true, fences };
  } catch (e) {
    console.warn('[geofenceBackground] failed to start:', e.message);
    watcherId = null;
    return { started: false, reason: 'start_failed', error: e.message };
  }
}

// Only ever called on logout (and internally on a failed start) — there is no
// employee-facing control that calls this while still logged in. Eligible
// employees are re-started automatically on next login via startBackgroundGeofence().
export async function stopBackgroundGeofence() {
  const Capacitor = await getCapacitor();

  // Clear the persisted headless state unconditionally (even if `watcherId`
  // is already null in this JS instance's memory, e.g. after headless mode
  // took over post-task-removal) so a later reboot never resumes tracking
  // for a session that has since logged out.
  if (Capacitor?.getPlatform() === 'android') {
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
      await BackgroundGeolocation.clearHeadlessState();
    } catch { /* best-effort */ }
  }

  if (!watcherId) return;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
    await BackgroundGeolocation.removeWatcher({ id: watcherId });
  } catch { /* best-effort */ }
  watcherId = null;
  fences = [];
  currentFenceId = null;
  lastKnownInProgress = null;
}

// Nearest configured location the current position falls inside, if any —
// this is what makes attendance trigger at ANY configured location, not just
// the one tied to the employee's assigned shift/work_location.
function findFence(location) {
  let best = null, bestDist = Infinity;
  for (const f of fences) {
    const d = distMetres(location.latitude, location.longitude, Number(f.latitude), Number(f.longitude));
    if (d <= Number(f.radius_m) && d < bestDist) { best = f; bestDist = d; }
  }
  return best;
}

// Nearest configured fence regardless of whether the position is inside its
// radius — used as a fallback for exit distance/hysteresis checks when
// currentFenceId is unknown (e.g. checked in via biometric/selfie rather
// than geofence, or the server-state seed on start didn't resolve one).
function nearestFence(location) {
  let best = null, bestDist = Infinity;
  for (const f of fences) {
    const d = distMetres(location.latitude, location.longitude, Number(f.latitude), Number(f.longitude));
    if (d < bestDist) { best = f; bestDist = d; }
  }
  return best;
}

async function handleLocation(location, platformTag) {
  if (!fences.length) return;
  if (location.accuracy > 100) return; // background fixes are noisier than foreground; still bounded

  const insideFence = findFence(location);

  if (insideFence) {
    if (currentFenceId !== insideFence.id || lastKnownInProgress !== true) {
      currentFenceId = insideFence.id;
      await sendEvent('enter', location, platformTag, insideFence);
    }
    return;
  }

  // Not inside any fence. Only relevant if we actually know we're checked
  // in — otherwise there's nothing to exit from (or we simply don't know
  // yet, e.g. the server-state fetch on start hasn't resolved).
  if (lastKnownInProgress !== true) return;
  const cur = (currentFenceId && fences.find(f => f.id === currentFenceId)) || nearestFence(location);
  if (!cur) return;
  const d = distMetres(location.latitude, location.longitude, Number(cur.latitude), Number(cur.longitude));
  const wellOutside = d > Number(cur.radius_m) + 100; // spatial hysteresis against boundary jitter, not a time delay
  if (wellOutside) {
    await sendEvent('exit', location, platformTag, cur);
    currentFenceId = null;
  }
}

async function sendEvent(event, location, platformTag, targetFence) {
  try {
    const res = await base44.functions.invoke('nativeGeofenceEvent', {
      event,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      occurred_at: new Date(location.time || Date.now()).toISOString(),
      location_name: targetFence.name,
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
