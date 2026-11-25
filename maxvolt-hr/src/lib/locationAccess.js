// The phone's real location-access state (permission, GPS, background, battery) and the means to fix it.
// Used by the blocking LocationGate and for the audit report to the server. The rules themselves (who must comply, which states
// block) come from the server (getMyTrackingPolicy / backend utils/fieldTracking.js).
import { requestBackgroundLocationIfNeeded, requestBatteryOptimizationExemption, openLocationSettings } from '@/lib/geofenceBackground';

async function capacitor() { try { return (await import('@capacitor/core')).Capacitor; } catch { return null; } }

async function webGeolocationGranted() {
  try {
    if (navigator.permissions?.query) {
      const r = await navigator.permissions.query({ name: 'geolocation' });
      return r.state === 'granted';
    }
  } catch { /* fall through */ }
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(false);
    navigator.geolocation.getCurrentPosition(() => resolve(true), (e) => resolve(e.code !== 1), { timeout: 8000, maximumAge: 600000 });
  });
}

// { platform, fg, bg, gps, battery, notif, legacy? }
export async function readLocationState() {
  const Cap = await capacitor();
  const platform = Cap?.isNativePlatform() ? Cap.getPlatform() : 'web';
  if (platform === 'android') {
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const s = await registerPlugin('FieldDutyWake').locationState();
      return { platform, fg: !!s.fg, bg: !!s.bg, gps: s.gps !== false, battery: !!s.battery, notif: s.notif !== false };
    } catch { /* an app build older than this feature: only what the WebView can tell */ }
    const fg = await webGeolocationGranted();
    return { platform, fg, bg: true, gps: true, battery: true, notif: true, legacy: true };   // background / battery cannot be verified on an old build
  }
  const fg = await webGeolocationGranted();
  return { platform, fg, bg: true, gps: true, battery: true, notif: true, legacy: platform === 'ios' };   // iOS "Always" cannot be read from the WebView
}

// Which of the server's rules this state breaks. Mirrors devicePolicyProblems() in backend/utils/fieldTracking.js.
export function problemsFor(state, policy) {
  const out = [];
  if (!state.fg) out.push('location_denied');
  if (state.gps === false) out.push('gps_off');
  if ((state.platform === 'android' || state.platform === 'ios') && policy?.background && !state.bg) out.push('background_location_denied');
  if (state.platform === 'android' && policy?.battery && !state.battery) out.push('battery_restricted');
  return out;
}

export const PROBLEM_TEXT = {
  location_denied: 'Location permission is turned off for Maxvolt One.',
  gps_off: "Your phone's location (GPS) is switched off.",
  background_location_denied: 'Location must be set to "Allow all the time" so attendance and field duty work with the app closed.',
  battery_restricted: 'Battery optimisation must be switched off ("Unrestricted") for Maxvolt One, or the phone will stop tracking.',
};

// Ask for whatever is missing; anything the OS will not let us ask for again is sent to the settings page.
export async function requestLocationAccess(state) {
  const Cap = await capacitor();
  if (!state.fg) {
    await new Promise(res => (navigator.geolocation ? navigator.geolocation.getCurrentPosition(() => res(), () => res(), { timeout: 15000, maximumAge: 0 }) : res()));
  }
  if (Cap?.isNativePlatform() && Cap.getPlatform() === 'android') {
    if (!state.bg) await requestBackgroundLocationIfNeeded();
    if (!state.battery) await requestBatteryOptimizationExemption();
  }
}
export { openLocationSettings };
