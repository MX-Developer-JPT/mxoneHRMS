// Singleton GPS tracker for the active Field Duty trip.
//
// A field trip can be started from more than one page (Field Duty itself, or
// automatically from a Gate Pass request), and the employee may navigate to
// any other screen while travelling. Keeping the watchPosition/flush logic in
// a single module — rather than inside whichever page component happened to
// start the trip — means tracking survives navigation for the rest of the
// session: whoever starts it calls startTracking(), Layout.jsx resumes it on
// load if a trip is already active, and any page can subscribe() to show
// live distance without owning the watcher itself.
//
// Native app: uses @capacitor-community/background-geolocation (the SAME
// plugin geofenceBackground.js already uses for attendance) instead of the
// plain web navigator.geolocation API. This is the fix for distance being
// under-reported on real trips — navigator.geolocation.watchPosition only
// fires while this tab/page is in the foreground; the moment the phone
// screen locks or the app is backgrounded (put in a pocket, switched to a
// maps app for turn-by-turn navigation while driving — the single most
// common way someone actually uses this feature), the web watcher goes
// completely silent and however many minutes/kilometres pass during that
// time are simply never recorded. wakeLock only keeps the SCREEN on; it does
// nothing once the OS backgrounds the app/tab itself. The native plugin runs
// a real Android foreground service / iOS background location session that
// keeps delivering fixes regardless of foreground state, so it's used
// whenever running inside the Capacitor shell — the web watcher remains the
// fallback for plain browser/PWA use, where no native background plugin is
// available at all.
import { base44 } from '@/api/base44Client';

let watchId = null;          // web navigator.geolocation watch id
let nativeWatcherId = null;  // BackgroundGeolocation watcher id (native app only)
let usingNative = false;
let flushTimer = null;
let buffer = [];
let currentTripId = null;
let liveKm = 0;
let liveAccuracy = null;
let wakeLock = null;
const listeners = new Set();

function notify() {
  listeners.forEach(fn => { try { fn({ tripId: currentTripId, km: liveKm, accuracy: liveAccuracy }); } catch {} });
}

export function subscribe(fn) {
  listeners.add(fn);
  fn({ tripId: currentTripId, km: liveKm, accuracy: liveAccuracy }); // immediate current state
  return () => listeners.delete(fn);
}

export function getState() {
  return { tripId: currentTripId, km: liveKm, accuracy: liveAccuracy, isTracking: watchId != null || nativeWatcherId != null };
}

async function getCapacitor() {
  try { return (await import('@capacitor/core')).Capacitor; } catch { return null; }
}

// Shared by both the native and web location sources — noise/jump filtering
// only affects which points get BUFFERED for the next flush; the server
// (logFieldPoints) re-derives distance from scratch against the trip's real
// last-stored point, so this is a pre-filter for upload volume, not the
// authoritative distance calculation.
function handleFix(lat, lng, accuracy, timeMs) {
  liveAccuracy = accuracy != null ? Math.round(accuracy) : null;
  notify();
  if (accuracy != null && accuracy > 60) return; // poor fix — never contributes distance
  const q = { lat, lng, acc: accuracy || 0, t: new Date(timeMs || Date.now()).toISOString() };
  const prev = buffer[buffer.length - 1];
  if (prev) {
    const R = 6371000, la1 = prev.lat * Math.PI / 180, la2 = q.lat * Math.PI / 180;
    const dLa = la2 - la1, dLo = (q.lng - prev.lng) * Math.PI / 180;
    const dM = 2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2));
    if (dM < Math.max(15, Math.min(50, (prev.acc + q.acc) / 2))) return; // below GPS noise floor
  }
  buffer.push(q);
}

export async function startTracking(tripId, initialKm = 0) {
  if (!tripId) return;
  if (currentTripId === tripId && (watchId != null || nativeWatcherId != null)) return; // already tracking this trip
  await stopTracking();
  currentTripId = tripId;
  liveKm = initialKm || 0;
  liveAccuracy = null;

  const Capacitor = await getCapacitor();
  if (Capacitor?.isNativePlatform()) {
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
      usingNative = true;
      nativeWatcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: 'Maxvolt One — Field Duty tracking active',
          backgroundMessage: 'Recording your travel distance for this field trip.',
          requestPermissions: true,
          stale: false,
          distanceFilter: 15, // matches the GPS noise-floor threshold above
        },
        (location, error) => {
          if (error) { console.warn('[fieldTripTracker] native watcher error:', error.code, error.message); return; }
          if (!location) return;
          handleFix(location.latitude, location.longitude, location.accuracy, location.time);
        }
      );
      flushTimer = setInterval(flushNow, 20000);
      return;
    } catch (e) {
      console.warn('[fieldTripTracker] native tracking failed to start, falling back to web geolocation:', e.message);
      usingNative = false;
      nativeWatcherId = null;
      // fall through to the web watcher below
    }
  }

  usingNative = false;
  if (!navigator.geolocation) return;
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(wl => { wakeLock = wl; }).catch(() => {});

  watchId = navigator.geolocation.watchPosition(
    (pos) => handleFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.timestamp),
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );

  flushTimer = setInterval(flushNow, 20000);
}

export async function flushNow() {
  if (!buffer.length || !currentTripId) return null;
  const points = buffer.splice(0, buffer.length);
  try {
    const res = await base44.functions.invoke('logFieldPoints', { trip_id: currentTripId, points });
    const d = res.data || res;
    if (d.success) { liveKm = d.distance_km || liveKm; notify(); return liveKm; }
  } catch { /* points stay lost for this flush; watcher keeps collecting new ones */ }
  return null;
}

export async function stopTracking() {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (nativeWatcherId != null) {
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
      await BackgroundGeolocation.removeWatcher({ id: nativeWatcherId });
    } catch { /* best-effort */ }
    nativeWatcherId = null;
  }
  usingNative = false;
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  buffer = [];
  currentTripId = null;
  liveKm = 0;
  liveAccuracy = null;
  notify();
}
