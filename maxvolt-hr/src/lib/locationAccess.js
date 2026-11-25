// The phone's real location-access state (permission, GPS, background, battery) and the means to fix it.
// Used by the blocking LocationGate and for the audit report to the server. The rules themselves (who must comply, which states
// block) come from the server (getMyTrackingPolicy / backend utils/fieldTracking.js).
import { requestBackgroundLocationIfNeeded, requestBatteryOptimizationExemption, openLocationSettings } from '@/lib/geofenceBackground';

async function capacitor() { try { return (await import('@capacitor/core')).Capacitor; } catch { return null; } }

// Is location already allowed for this app? An actual position request is the only reliable answer inside the Android/iOS
// WebView (its permissions.query() reports "prompt" even when the phone setting is already "allowed", which used to lock out people who
// had done everything right). Only an explicit "permission denied" counts as not granted; "no fix yet" / timeout means access is fine.
let probe = { at: 0, ok: false };
async function webGeolocationGranted(native) {
  if (!native) {
    try {
      if (navigator.permissions?.query) {
        const r = await navigator.permissions.query({ name: 'geolocation' });
        if (r.state === 'granted') return true;
        if (r.state === 'denied') return false;
        // 'prompt' in a normal browser = not asked yet = not granted
        return false;
      }
    } catch { /* fall through to the probe */ }
  }
  if (probe.ok && Date.now() - probe.at < 60000) return true;     // a granted answer is reused for a minute (battery)
  const ok = await new Promise(resolve => {
    if (!navigator.geolocation) return resolve(false);
    navigator.geolocation.getCurrentPosition(() => resolve(true), (e) => resolve(e.code !== 1), { timeout: 6000, maximumAge: 600000 });
  });
  probe = { at: Date.now(), ok };
  return ok;
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
    const fg = await webGeolocationGranted(true);
    return { platform, fg, bg: true, gps: true, battery: true, notif: true, legacy: true };   // background / battery cannot be verified on an old build
  }
  const fg = await webGeolocationGranted(platform !== 'web');
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

// Plain-language steps for each problem, per platform (shown on the gate screen).
export const PROBLEM_STEPS = {
  android: {
    location_denied: ['Open your phone Settings → Apps → Maxvolt One → Permissions → Location', 'Choose "Allow all the time" (not "Only while using the app")', 'Turn on "Use precise location"'],
    background_location_denied: ['Open your phone Settings → Apps → Maxvolt One → Permissions → Location', 'Choose "Allow all the time"'],
    gps_off: ['Swipe down from the top of the screen', 'Turn on "Location"'],
    battery_restricted: ['Open your phone Settings → Apps → Maxvolt One → Battery', 'Choose "Unrestricted" (some phones call it "No restrictions" or "Don\'t optimise")'],
  },
  ios: {
    location_denied: ['Open Settings → Maxvolt One → Location', 'Choose "Always" and turn on "Precise Location"'],
    background_location_denied: ['Open Settings → Maxvolt One → Location → "Always"'],
    gps_off: ['Open Settings → Privacy & Security → Location Services and turn it on'],
  },
  web: {
    location_denied: ['Click the lock icon next to the address bar', 'Set Location to "Allow", then reload this page'],
    gps_off: ['Turn on location services for your device / browser'],
  },
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
