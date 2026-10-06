// Geofence attendance engine.
//
// One engine, two location sources:
//   • Native app (Capacitor): @capacitor-community/background-geolocation — an
//     OS foreground service on Android / "Always" location on iOS, so fixes
//     keep arriving with the app minimized or the screen locked.
//   • Browser / PWA: navigator.geolocation.watchPosition — foreground only
//     (the web platform offers nothing better).
//
// Design rules (see also backend `nativeGeofenceEvent`, the source of truth):
//   • EDGE-triggered, not level-triggered. A transition is only emitted after
//     it is CONFIRMED (several fixes and/or a dwell time), using separate
//     enter/exit thresholds (hysteresis) that account for GPS accuracy.
//   • Weak fixes (accuracy above the cap), missing fixes, GPS errors and
//     network failures are NEVER evidence of leaving or arriving — they are
//     ignored. Only a confirmed exit produces a check-out.
//   • Events go through a persisted outbox with an idempotency id and the
//     ORIGINAL crossing time, so offline / killed-app / retried deliveries
//     can't create duplicate or mis-timed sessions.
//   • Permission/authorisation and engine state persist in localStorage, so
//     the employee is not asked to "enable location" again once set up.
import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { registerPlugin } from '@capacitor/core';
import { base44 } from '@/api/base44Client';

const PERSIST_KEY = 'geo_engine_v2';
const DEFAULT_CFG = {
  max_accuracy_m: 100,         // fixes less accurate than this never drive a transition
  enter_confirmations: 1,      // immediate: the first reliable inside fix checks in
  enter_min_seconds: 0,
  enter_timer_seconds: 2,
  exit_confirmations: 1,       // immediate: the first reliable outside fix checks out
  exit_dwell_seconds: 0,
  exit_buffer_m: 15,           // small hysteresis vs. enter at radius
  strong_exit_m: 60,          // clearly gone (radius + this): no dwell needed, still 2 fixes
  stale_fix_seconds: 180,      // no fix this long => display "Location Unavailable"
};
const OUTBOX_MAX_AGE_MS = 48 * 3600 * 1000;
const OUTBOX_MAX_ATTEMPTS = 25;

// ── tiny external store so any component can render live state ──
let snapshot = {
  status: 'idle',            // idle | starting | active | permission_required | location_disabled | unavailable | not_eligible
  mode: null,                // 'background' (native) | 'foreground' (browser)
  fences: [],
  liveState: 'idle',         // inside | outside | unavailable | permission_required | location_disabled | idle
  distance: null,            // metres to nearest fence centre
  radius: null,              // that fence's radius (m)
  fenceName: null,
  accuracy: null,
  lastFixAt: null,
  believedIn: null,          // engine's view of "checked in via geofence"
  pending: 0,                // events waiting to sync
  lastSyncAt: null,
  diag: [],                  // last few engine steps/errors, shown on Mark Attendance for troubleshooting
};
const listeners = new Set();
const emit = (patch) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(l => l()); };
function diag(msg) {
  const line = `${new Date().toLocaleTimeString()} ${msg}`;
  console.log('[geofence]', msg);
  emit({ diag: [...(snapshot.diag || []), line].slice(-14) });
}
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getSnapshot = () => snapshot;
export function useGeofenceState() { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }
export const getGeofenceState = () => snapshot;

// ── persisted state ──
function loadP() { try { return JSON.parse(localStorage.getItem(PERSIST_KEY) || 'null') || {}; } catch { return {}; } }
function saveP(patch) {
  try { localStorage.setItem(PERSIST_KEY, JSON.stringify({ ...loadP(), ...patch })); } catch { /* storage unavailable */ }
}

// ── engine internals ──
let userId = null;
let cfg = { ...DEFAULT_CFG };
let fences = [];
let believedIn = null;        // true/false once known; engine only auto-exits sessions IT (or the server's geofence) started
let geofenceOwned = false;    // open session started by a geofence enter
let currentFenceId = null;
let watcher = null;           // { kind:'native', id } | { kind:'web', id }
let lastFix = null;
let enterTrack = null;        // { n, firstAt, fenceId }
let exitTrack = null;         // { n, firstAt, strongN }
let confirmTimer = null;
let intervals = [];
let starting = null;
let flushing = false;
let flushRetry = null;
let retryDelay = 15000;
let listenersBound = false;

const dist = (lat1, lng1, lat2, lng2) => {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

async function getCapacitor() {
  try { return (await import('@capacitor/core')).Capacitor; } catch { return null; }
}
// NOTE: must stay synchronous. A Capacitor plugin object is a Proxy that answers
// every property (including `then`), so returning it from an async function or
// awaiting it makes the promise wait on a fake "then" forever — which is exactly
// what left the engine stuck on "Starting…".
function nativePlugin() {
  return registerPlugin('BackgroundGeolocation');
}

export async function isBackgroundGeofenceAvailable() {
  const Capacitor = await getCapacitor();
  return !!Capacitor?.isNativePlatform();
}

// ── server sync of config + state ──
async function fetchServerState() {
  const res = await base44.functions.invoke('getMyGeofence', {});
  const d = res?.data || res;
  if (!d?.success) throw new Error('getMyGeofence failed');
  return d;
}

function applyServerConfig(d) {
  fences = Array.isArray(d.all_fences) ? d.all_fences : [];
  cfg = { ...DEFAULT_CFG, ...(d.config || {}) };
  emit({ fences });
}

// Server is the source of truth: unless local events are still waiting to
// sync (they're newer than the server's view), adopt its in-progress state.
function reconcile(d) {
  const p = loadP();
  if ((p.outbox || []).length) return;
  const at = d.attendance_today || {};
  believedIn = !!at.is_in_progress;
  geofenceOwned = believedIn && !!at.open_session_by_geofence;
  const named = at.geofence_location && fences.find(f => (f.name || '').toLowerCase() === String(at.geofence_location).toLowerCase());
  currentFenceId = believedIn && named ? named.id : (believedIn ? currentFenceId : null);
  saveP({ believedIn, geofenceOwned, currentFenceId });
  emit({ believedIn });
}

// ── public: eligibility pre-check (used before showing the disclosure) ──
export async function checkGeofenceEligibility() {
  try {
    const d = await fetchServerState();
    if (!d.geofence_eligible) return { eligible: false, reason: 'not_eligible' };
    if (!Array.isArray(d.all_fences) || d.all_fences.length === 0) return { eligible: false, reason: 'no_fence_assigned' };
    return { eligible: true };
  } catch (e) {
    return { eligible: false, reason: 'fetch_failed', error: e.message };
  }
}

// Android-only helpers (best-effort, no-ops elsewhere).
export async function requestBatteryOptimizationExemption() {
  const Capacitor = await getCapacitor();
  if (!Capacitor?.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  try {
    const BG = nativePlugin();
    const { ignoring } = await BG.isIgnoringBatteryOptimizations();
    if (!ignoring) await BG.requestIgnoreBatteryOptimizations();
  } catch { /* depends on patched native build */ }
}
export async function requestBackgroundLocationIfNeeded() {
  const Capacitor = await getCapacitor();
  if (!Capacitor?.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  try { await nativePlugin().requestBackgroundLocationIfNeeded(); } catch { /* depends on patched native build */ }
}
// Deep-link to the app's OS settings page (where "Allow all the time" lives).
export async function openLocationSettings() {
  const Capacitor = await getCapacitor();
  if (!Capacitor?.isNativePlatform()) return false;
  try { await nativePlugin().openSettings(); return true; } catch { return false; }
}

// ── start / stop ──
export async function startBackgroundGeofence({ interactive = false, userId: uid } = {}) {
  if (starting) return starting;
  starting = (async () => {
    try { return await doStart({ interactive, uid }); }
    finally { starting = null; }
  })();
  return starting;
}

async function doStart({ interactive, uid }) {
  const Capacitor = await getCapacitor();
  const native = !!Capacitor?.isNativePlatform();

  if (!uid) { try { uid = (await base44.auth.me())?.id; } catch { /* offline — fall through */ } }
  const persisted = loadP();
  if (uid && persisted.userId && persisted.userId !== uid) {
    // Different employee on this device — never carry over another user's queue.
    try { localStorage.removeItem(PERSIST_KEY); } catch { /* */ }
  }
  userId = uid || persisted.userId || null;
  if (userId) saveP({ userId });

  diag(`start (native=${native}, interactive=${!!interactive})`);
  let d;
  try {
    d = await fetchServerState();
  } catch (e) {
    // Offline at launch: if we already know the config from last time we could
    // still track, but fences come from the server — retry shortly instead.
    diag('server config failed: ' + e.message);
    emit({ status: 'unavailable' });
    scheduleStartRetry();
    return { started: false, reason: 'fetch_failed', error: e.message };
  }
  diag(`server: eligible=${!!d.geofence_eligible}, fences=${d.all_fences?.length || 0}`);
  if (!d.geofence_eligible) { await stopEngineInternals(); emit({ status: 'not_eligible', liveState: 'idle' }); return { started: false, reason: 'not_eligible' }; }
  if (!d.all_fences?.length) { emit({ status: 'not_eligible', liveState: 'idle' }); return { started: false, reason: 'no_fence_assigned' }; }
  applyServerConfig(d);
  reconcile(d);

  if (watcher) { // already running — config refreshed above
    flushOutbox();
    return { started: true, reason: 'already_running', fences };
  }

  emit({ status: 'starting', mode: native ? 'background' : 'foreground', pending: (loadP().outbox || []).length });
  bindGlobalListeners();
  let ok = native ? await startNativeWatcher(Capacitor, interactive) : await startWebWatcher(interactive);
  if (native && !ok.started && ok.reason === 'start_failed') {
    // The native background plugin could not start — fall back to the WebView's
    // own location so tracking at least works while the app is open.
    diag('native failed (' + (ok.error || '?') + ') — falling back to foreground location');
    ok = await startWebWatcher(true);
    if (ok.started) emit({ mode: 'foreground' });
  }
  diag(ok.started ? 'watcher started' : `not started: ${ok.reason}`);
  if (!ok.started) return ok;

  intervals.forEach(clearInterval);
  intervals = [
    setInterval(() => { refreshConfig().catch(() => {}); }, 5 * 60 * 1000),
    setInterval(tick, 15 * 1000),
  ];
  flushOutbox();
  return { started: true, fences };
}

let startRetryTimer = null;
function scheduleStartRetry() {
  if (startRetryTimer) return;
  startRetryTimer = setTimeout(() => { startRetryTimer = null; startBackgroundGeofence().catch(() => {}); }, 30000);
}

// The native plugin binds its location service asynchronously when it loads, so
// an addWatcher() call made right at app launch can be rejected with "Service
// not running." even though nothing is wrong. Retry for a few seconds before
// treating it as a real failure.
async function addWatcherWithRetry(BG, options, callback) {
  let lastErr;
  for (let i = 0; i < 12; i++) {
    try { return await BG.addWatcher(options, callback); }
    catch (e) {
      lastErr = e;
      if (!/service not running/i.test(e?.message || '')) throw e;
      await new Promise(r => setTimeout(r, 600));
    }
  }
  throw lastErr;
}

// One-shot position request through the WebView's own geolocation. The native
// watcher only reports once the device has moved (distance filter) or the OS
// has a fresh fix, which can leave the screen on "Waiting for the first GPS
// fix" for a long time — this asks the OS for a position right now and feeds it
// into the same engine, and is repeated whenever fixes go quiet.
let instantBusy = false;
function requestInstantFix(reason) {
  if (instantBusy || !navigator.geolocation) return;
  instantBusy = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      instantBusy = false;
      if (!snapshot.lastFixAt) diag(`instant fix via ${reason} (±${Math.round(pos.coords.accuracy)}m)`);
      if (snapshot.status !== 'active') emit({ status: 'active' });
      saveP({ authorized: true });
      onFix({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, time: pos.timestamp || Date.now(), simulated: false });
    },
    (err) => { instantBusy = false; diag(`instant fix failed (${reason}): ${err.code} ${err.message}`); },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );
}

let lastRestartAt = 0;

async function startNativeWatcher(Capacitor, interactive) {
  const p = loadP();
  const BG = nativePlugin();
  // Silent after first-time setup: only ask the OS for permission when this is
  // an explicit, user-initiated setup (interactive) — otherwise just probe.
  const requestPermissions = !!interactive;
  let permissionDenied = false;
  try {
    diag('native addWatcher…');
    requestInstantFix('start'); // don't wait for the native watcher's first report
    // If the plugin never answers (stuck bridge / missing native support) don't
    // sit on "Starting…" forever — give up after 9s so the foreground fallback runs.
    const id = await Promise.race([
      addWatcherWithRetry(
      BG,
      {
        backgroundTitle: 'Maxvolt One — Attendance tracking active',
        backgroundMessage: fences.length === 1
          ? `Watching your location to mark attendance at ${fences[0].name}`
          : `Watching your location to mark attendance at ${fences.length} configured locations`,
        requestPermissions,
        stale: true,            // deliver the last known position immediately
        distanceFilter: 5,
      },
      (location, error) => {
        if (error) {
          diag(`native error: ${error.code || ''} ${error.message || ''}`);
          if (error.code === 'NOT_AUTHORIZED') {
            permissionDenied = true;
            onPermissionLost('permission_required');
          } else {
            emit({ liveState: 'unavailable' });
          }
          return;
        }
        if (location && !snapshot.lastFixAt) diag(`first native fix (±${Math.round(location.accuracy || 0)}m)`);
        if (location) onFix({ latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy, time: location.time || Date.now(), simulated: !!location.simulated });
      }
    ),
      new Promise((_, rej) => setTimeout(() => rej(new Error('native addWatcher timed out')), 9000)),
    ]);
    watcher = { kind: 'native', id };
    // Android: let the native service resume after reboot / swipe-away with
    // zero JS involvement. Re-persist on every start AND config refresh.
    persistHeadless(Capacitor).catch(() => {});
    // Give a probe-only start a moment to report NOT_AUTHORIZED.
    await new Promise(r => setTimeout(r, 800));
    if (permissionDenied) return { started: false, reason: 'permission_required' };
    emit({ status: 'active', liveState: snapshot.lastFixAt ? snapshot.liveState : 'unavailable' });
    saveP({ authorized: true });
    if (Capacitor.getPlatform() === 'android' && !p.bgAsked && interactive) {
      saveP({ bgAsked: true });
      requestBackgroundLocationIfNeeded();
    }
    return { started: true };
  } catch (e) {
    watcher = null;
    // A plugin/service failure is NOT a permission problem — don't tell the
    // employee to re-enable location; just retry shortly.
    diag(`addWatcher threw: ${e?.code || ''} ${e?.message || e}`);
    console.warn('[geofence] native watcher failed to start:', e?.message);
    emit({ status: 'unavailable', liveState: 'unavailable' });
    scheduleStartRetry();
    return { started: false, reason: 'start_failed', error: e?.message };
  }
}

async function persistHeadless(Capacitor) {
  if (Capacitor.getPlatform() !== 'android') return;
  const BG = nativePlugin();
  await BG.persistHeadlessState({
    token: localStorage.getItem('base44_access_token') || '',
    fencesJson: JSON.stringify(fences),
    apiBase: window.location.origin,
  });
}

async function startWebWatcher(interactive) {
  if (!navigator.geolocation) { emit({ status: 'unavailable', liveState: 'unavailable' }); return { started: false, reason: 'unsupported' }; }
  const p = loadP();
  // Skip the permission re-prompt flow when it was granted before; a browser
  // that remembers the grant just starts delivering fixes. Without a prior
  // grant, only start from an explicit user gesture (iOS standalone PWAs
  // silently swallow unprompted requests).
  let state = 'prompt';
  try { state = (await navigator.permissions?.query({ name: 'geolocation' }))?.state || 'prompt'; } catch { /* unsupported */ }
  if (state === 'denied') { onPermissionLost('permission_required'); return { started: false, reason: 'permission_required' }; }
  if (state !== 'granted' && !p.authorized && !interactive) { emit({ status: 'permission_required', liveState: 'permission_required' }); return { started: false, reason: 'permission_required' }; }

  const id = navigator.geolocation.watchPosition(
    (pos) => {
      saveP({ authorized: true });
      if (snapshot.status !== 'active') emit({ status: 'active' });
      onFix({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, time: pos.timestamp || Date.now(), simulated: false });
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) onPermissionLost('permission_required');
      else emit({ liveState: 'unavailable' }); // POSITION_UNAVAILABLE / TIMEOUT: transient, never an exit
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
  );
  watcher = { kind: 'web', id };
  emit({ status: 'active', liveState: 'unavailable' });
  return { started: true };
}

function onPermissionLost(status) {
  saveP({ authorized: false });
  stopWatcher().catch(() => {});
  emit({ status, liveState: status });
}

async function stopWatcher() {
  const w = watcher; watcher = null;
  if (!w) return;
  if (w.kind === 'web') { try { navigator.geolocation.clearWatch(w.id); } catch { /* */ } return; }
  try { await nativePlugin().removeWatcher({ id: w.id }); } catch { /* */ }
}

async function stopEngineInternals() {
  intervals.forEach(clearInterval); intervals = [];
  if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
  await stopWatcher();
  enterTrack = exitTrack = null;
}

// Logout: stop tracking and drop everything stored for this employee.
export async function stopBackgroundGeofence() {
  const Capacitor = await getCapacitor();
  if (Capacitor?.getPlatform() === 'android') {
    try { await nativePlugin().clearHeadlessState(); } catch { /* best-effort */ }
  }
  await stopEngineInternals();
  if (flushRetry) { clearTimeout(flushRetry); flushRetry = null; }
  try { localStorage.removeItem(PERSIST_KEY); } catch { /* */ }
  fences = []; believedIn = null; geofenceOwned = false; currentFenceId = null; lastFix = null; userId = null;
  emit({ status: 'idle', liveState: 'idle', distance: null, radius: null, fenceName: null, accuracy: null, lastFixAt: null, believedIn: null, pending: 0, fences: [] });
}

// App came back to the foreground / network returned: re-verify against the
// server, make sure the watcher is alive, and push any queued events.
export async function resumeGeofence() {
  if (snapshot.status === 'idle' || snapshot.status === 'not_eligible') return;
  if (!watcher && ['active', 'starting', 'unavailable'].includes(snapshot.status)) { await startBackgroundGeofence().catch(() => {}); return; }
  if (watcher) requestInstantFix('resume');
  await refreshConfig().catch(() => {});
  flushOutbox();
}

async function refreshConfig() {
  const d = await fetchServerState();
  if (!d.geofence_eligible) { await stopEngineInternals(); emit({ status: 'not_eligible', liveState: 'idle' }); return; }
  applyServerConfig(d);
  reconcile(d);
  const Capacitor = await getCapacitor();
  if (Capacitor?.isNativePlatform()) persistHeadless(Capacitor).catch(() => {});
  if (lastFix) onFix(lastFix, { replay: true });
}

function bindGlobalListeners() {
  if (listenersBound) return;
  listenersBound = true;
  window.addEventListener('online', () => { retryDelay = 15000; flushOutbox(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { resumeGeofence().catch(() => {}); return; }
    // Going to the background: refresh the state native code uses to keep tracking without JS.
    getCapacitor().then(C => { if (C?.isNativePlatform()) persistHeadless(C).catch(() => {}); }).catch(() => {});
  });
}

// Periodic housekeeping: mark a stale position as "unavailable" (display
// only — never a check-out), retry the outbox, and finalise dwell timers.
function tick() {
  if (watcher && snapshot.status !== 'permission_required') {
    const age = snapshot.lastFixAt ? Date.now() - snapshot.lastFixAt : Infinity;
    if (age > 20000) requestInstantFix('watchdog');
    // Native watcher silent for 2.5 minutes: re-register it (never stay dark).
    if (watcher.kind === 'native' && age > 150000 && Date.now() - lastRestartAt > 120000) {
      lastRestartAt = Date.now();
      diag('no fixes for 150s — restarting native watcher');
      stopWatcher().then(async () => { const C = await getCapacitor(); if (C) await startNativeWatcher(C, false); }).catch(() => {});
    }
  }
  if (lastFix && Date.now() - snapshot.lastFixAt > cfg.stale_fix_seconds * 1000 && snapshot.liveState !== 'permission_required') {
    emit({ liveState: 'unavailable' });
  }
  if ((loadP().outbox || []).length) flushOutbox();
}

// ── fix handling ──
function nearestFence(fix) {
  let best = null, bd = Infinity;
  for (const f of fences) {
    const d = dist(fix.latitude, fix.longitude, Number(f.latitude), Number(f.longitude));
    if (d < bd) { best = f; bd = d; }
  }
  return best ? { fence: best, d: bd } : null;
}

function onFix(fix, { replay = false } = {}) {
  if (!fences.length) return;
  if (!replay) lastFix = fix;
  const near = nearestFence(fix);
  if (!near) return;
  const weak = !(fix.accuracy <= cfg.max_accuracy_m);
  const inside = near.d <= Number(near.fence.radius_m);
  emit({
    distance: Math.round(near.d), radius: Number(near.fence.radius_m), fenceName: near.fence.name,
    accuracy: Math.round(fix.accuracy || 0), lastFixAt: replay ? snapshot.lastFixAt : Date.now(),
    liveState: inside ? 'inside' : 'outside',
  });
  if (fix.simulated || weak) return; // shown, but never drives a transition
  evaluate(fix);
}

function evaluate(fix, { fromTimer = false } = {}) {
  const acc = Number(fix.accuracy) || 0;

  if (believedIn !== true) {
    exitTrack = null;
    // Best fence the fix is confidently inside (half the accuracy margin as guard).
    let enterFence = null, ed = Infinity;
    for (const f of fences) {
      const d = dist(fix.latitude, fix.longitude, Number(f.latitude), Number(f.longitude));
      if (d + acc * 0.25 <= Number(f.radius_m) && d < ed) { enterFence = f; ed = d; }
    }
    if (!enterFence) { enterTrack = null; clearConfirm(); return; }
    if (!enterTrack || enterTrack.fenceId !== enterFence.id) enterTrack = { n: 0, firstAt: fix.time, fenceId: enterFence.id, fix };
    if (!fromTimer) enterTrack.n++;
    enterTrack.last = fix;
    const elapsed = (fromTimer ? Date.now() : fix.time) - enterTrack.firstAt;
    const byFixes = enterTrack.n >= cfg.enter_confirmations && elapsed >= cfg.enter_min_seconds * 1000;
    const byTimer = fromTimer && enterTrack.n >= 1 && elapsed >= cfg.enter_timer_seconds * 1000;
    if (byFixes || byTimer) {
      const crossing = enterTrack.fix; // first confirmed-inside fix = the real crossing time
      enterTrack = null; clearConfirm();
      emitEvent('enter', crossing, enterFence);
    } else {
      armConfirm(cfg.enter_timer_seconds * 1000);
    }
    return;
  }

  // believedIn === true
  enterTrack = null;
  if (!geofenceOwned) { exitTrack = null; clearConfirm(); return; } // never auto-close a manual/biometric/WFH session
  const cur = (currentFenceId && fences.find(f => f.id === currentFenceId)) || (nearestFence(fix)?.fence);
  if (!cur) return;
  const d = dist(fix.latitude, fix.longitude, Number(cur.latitude), Number(cur.longitude));
  const radius = Number(cur.radius_m);
  const outside = d - acc * 0.25 > radius + cfg.exit_buffer_m;
  if (!outside) { exitTrack = null; clearConfirm(); return; }
  const strong = d - acc > radius + cfg.strong_exit_m;
  if (!exitTrack) exitTrack = { n: 0, strongN: 0, firstAt: fix.time, fix };
  if (!fromTimer) { exitTrack.n++; if (strong) exitTrack.strongN++; }
  exitTrack.last = fix;
  const elapsed = (fromTimer ? Date.now() : fix.time) - exitTrack.firstAt;
  const confirmed = (exitTrack.strongN >= 2) || (exitTrack.n >= cfg.exit_confirmations && elapsed >= cfg.exit_dwell_seconds * 1000);
  if (confirmed) {
    const crossing = exitTrack.fix; // first confirmed-outside fix = the real crossing time
    exitTrack = null; clearConfirm();
    emitEvent('exit', crossing, cur);
  } else {
    armConfirm(cfg.exit_dwell_seconds * 1000);
  }
}

// A stationary phone emits no fixes, so dwell must also be able to complete on
// a timer — re-evaluating against the latest fix (which must still agree).
function armConfirm(ms) {
  if (confirmTimer) return;
  confirmTimer = setTimeout(() => {
    confirmTimer = null;
    if (lastFix && !(lastFix.simulated) && lastFix.accuracy <= cfg.max_accuracy_m) evaluate(lastFix, { fromTimer: true });
  }, ms + 500);
}
function clearConfirm() { if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; } }

// ── outbox ──
const newId = () => `${(userId || 'u').slice(0, 8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function emitEvent(event, fix, fence) {
  const p = loadP();
  const outbox = p.outbox || [];
  // Never queue two identical consecutive transitions.
  const lastQueued = outbox[outbox.length - 1];
  if (lastQueued && lastQueued.event === event) return;
  const platformTag = snapshot.mode === 'background' ? 'native_android' : 'in_app';
  outbox.push({
    event_id: newId(), event,
    latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy,
    occurred_at: new Date(fix.time).toISOString(), // ORIGINAL crossing time, preserved through any retry delay
    location_name: fence.name, is_mock: false,
    device_id: snapshot.mode === 'background' ? 'capacitor-background-geolocation' : 'web',
    source: platformTag, attempts: 0, queued_at: Date.now(),
  });
  // Optimistic local belief so the same transition isn't re-emitted while the
  // network round-trip (or an offline wait) is in progress.
  believedIn = event === 'enter';
  geofenceOwned = believedIn;
  currentFenceId = believedIn ? fence.id : null;
  saveP({ outbox, believedIn, geofenceOwned, currentFenceId });
  emit({ believedIn, pending: outbox.length });
  flushOutbox();
}

async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const p = loadP();
      const outbox = p.outbox || [];
      if (!outbox.length) break;
      const ev = outbox[0];
      if (Date.now() - ev.queued_at > OUTBOX_MAX_AGE_MS || ev.attempts >= OUTBOX_MAX_ATTEMPTS) {
        saveP({ outbox: outbox.slice(1) }); emit({ pending: outbox.length - 1 }); continue;
      }
      let d;
      try {
        const { attempts, queued_at, ...payload } = ev;
        const res = await base44.functions.invoke('nativeGeofenceEvent', payload);
        d = res?.data || res;
      } catch (e) {
        // Network / server unavailable: keep the event, retry with backoff.
        outbox[0] = { ...ev, attempts: ev.attempts + 1 };
        saveP({ outbox });
        scheduleFlushRetry();
        break;
      }
      retryDelay = 15000;
      const rest = (loadP().outbox || []).slice(1);
      saveP({ outbox: rest });
      emit({ pending: rest.length, lastSyncAt: Date.now() });
      if (d?.success) {
        if (d.action === 'checked_in' || d.action === 'location_transfer') {
          toast.success(d.session_number > 1 ? `Auto checked-in at ${d.location} — session ${d.session_number} 📍` : `Auto checked-in at ${d.location} 📍`);
        } else if (d.action === 'checked_out') {
          toast.success(`Auto checked-out — ${Number(d.working_hours || 0).toFixed(1)}h so far`);
        }
        window.dispatchEvent(new CustomEvent('geofence:synced', { detail: d }));
      }
      // Anything the server declined or found already-applied: re-adopt its state.
      if (!d?.success || d.action === 'none') { refreshConfig().catch(() => {}); }
    }
  } finally { flushing = false; }
}

function scheduleFlushRetry() {
  if (flushRetry) return;
  flushRetry = setTimeout(() => { flushRetry = null; flushOutbox(); }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 5 * 60 * 1000);
}
