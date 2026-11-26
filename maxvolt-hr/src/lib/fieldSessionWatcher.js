// Keeps the phone's GPS recorder in step with the server's field-duty session.
//
// The server can open a session at any moment (OD check-in, HR, the OD sync) and close it at OD check-out. The app used to look for an
// open session only once, when it started — so a session opened AFTER the app was already running was never recorded until the
// app was restarted. This checks every 45 seconds, when the app comes back to the foreground, and when the network returns:
//   a session is open on the server and not being recorded here  -> start recording
//   nothing is open on the server but a recording is running      -> stop it
import { base44 } from '@/api/base44Client';
import { startTracking, stopTracking, getState } from '@/lib/fieldTripTracker';

let timer = null;
let busy = false;

async function poll() {
  if (busy || !localStorage.getItem('base44_access_token')) return;
  // only employees enabled for field duty tracking need this (the policy is fetched at start-up; until it is known, ask anyway)
  try { if (JSON.parse(localStorage.getItem('mv_location_policy_v1') || 'null')?.field_tracked === false && !getState().tripId) return; } catch { /* unknown: ask */ }
  busy = true;
  try {
    const r = await base44.functions.invoke('getMyFieldSession', {}); const d = r?.data || r;
    if (!d?.success) return;
    const st = getState();
    if (d.active) {
      if (st.tripId !== d.active.id || !st.isTracking) startTracking(d.active.id, d.active.distance_km || 0);
    } else if (st.tripId) {
      stopTracking();   // the session ended on the server (OD check-out, closed by HR, no longer allowed)
    }
  } catch { /* offline or not a field employee: try again next time */ }
  finally { busy = false; }
}

const onWake = () => { if (document.visibilityState !== 'hidden') poll(); };

export function startFieldSessionWatcher() {
  if (timer) return;
  poll();
  timer = setInterval(poll, 45000);
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('online', poll);
}

export function stopFieldSessionWatcher() {
  if (timer) { clearInterval(timer); timer = null; }
  document.removeEventListener('visibilitychange', onWake);
  window.removeEventListener('online', poll);
}
