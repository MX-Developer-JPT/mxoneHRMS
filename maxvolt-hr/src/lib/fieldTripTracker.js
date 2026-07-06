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
import { base44 } from '@/api/base44Client';

let watchId = null;
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
  return { tripId: currentTripId, km: liveKm, accuracy: liveAccuracy, isTracking: watchId != null };
}

export function startTracking(tripId, initialKm = 0) {
  if (!tripId) return;
  if (currentTripId === tripId && watchId != null) return; // already tracking this trip
  stopTracking();
  currentTripId = tripId;
  liveKm = initialKm || 0;
  liveAccuracy = null;
  if (!navigator.geolocation) return;
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(wl => { wakeLock = wl; }).catch(() => {});

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      liveAccuracy = Math.round(pos.coords.accuracy);
      notify();
      if (pos.coords.accuracy > 60) return; // poor fix — never contributes distance
      const q = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: new Date().toISOString() };
      const prev = buffer[buffer.length - 1];
      if (prev) {
        const R = 6371000, la1 = prev.lat * Math.PI / 180, la2 = q.lat * Math.PI / 180;
        const dLa = la2 - la1, dLo = (q.lng - prev.lng) * Math.PI / 180;
        const dM = 2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2));
        if (dM < Math.max(15, Math.min(50, (prev.acc + q.acc) / 2))) return; // below GPS noise floor
      }
      buffer.push(q);
    },
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

export function stopTracking() {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  buffer = [];
  currentTripId = null;
  liveKm = 0;
  liveAccuracy = null;
  notify();
}
