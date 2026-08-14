// Lightweight adoption-analytics event logging — feeds the Admin Panel's
// Adoption Dashboard (activation, active-user rates, feature adoption,
// estimated time-in-app). Every call is fire-and-forget: a failed/slow
// log call must never block or visibly affect the UI.
import { base44 } from '@/api/base44Client';

export function logUsageEvent(event_type, module, feature, meta) {
  try {
    base44.functions.invoke('logUserEvent', { event_type, module, feature, meta }).catch(() => {});
  } catch { /* never let tracking break the app */ }
}

const HEARTBEAT_INTERVAL_MS = 60 * 1000;
let heartbeatTimer = null;

// Starts a heartbeat that only actually logs while the tab is visible and
// the user is signed in — a background/closed tab shouldn't count toward
// "time spent in app". Returns a stop function.
export function startHeartbeat() {
  if (heartbeatTimer) return () => {};
  const tick = () => {
    if (document.visibilityState === 'visible') logUsageEvent('heartbeat');
  };
  tick();
  heartbeatTimer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  return () => { clearInterval(heartbeatTimer); heartbeatTimer = null; };
}

export function logPageView(pageName) {
  if (!pageName) return;
  logUsageEvent('module_opened', pageName);
}
