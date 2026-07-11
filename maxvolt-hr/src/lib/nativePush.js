// Real native push notifications inside the Capacitor shell (Android/iOS), via
// @capacitor-firebase/messaging. No-ops entirely in a regular browser tab —
// that path already gets Web Push (VAPID) via utils/pwa.js, unrelated to this.
//
// Using Firebase's plugin (rather than the platform-native @capacitor/push-
// notifications) means BOTH Android and iOS end up with a genuine FCM
// registration token — Firebase's iOS SDK does the APNs-token-to-FCM-token
// exchange internally. The backend (utils/push.js) sends through
// firebase-admin's messaging().send({token}) either way, with no per-platform
// branching needed once this exchange happens on-device.
import { base44 } from '@/api/base44Client';

let listenersAttached = false; // guards duplicate listener registration only —
                                // separate from the retry logic below, so a
                                // retry never causes double-fired toasts/deep-links.
let autoInitDone = false;      // only latches on a terminal, non-retryable outcome

async function attachListenersOnce(FirebaseMessaging) {
  if (listenersAttached) return;
  listenersAttached = true;

  FirebaseMessaging.addListener('tokenReceived', (event) => {
    if (event.token) registerToken(event.token).catch(() => {});
  });

  // Foreground arrival: FCM doesn't auto-display a system notification while
  // the app is in the foreground, so surface it as an in-app toast instead.
  FirebaseMessaging.addListener('notificationReceived', async (event) => {
    try {
      const { toast } = await import('sonner');
      const n = event.notification;
      const link = n.data?.link || n.link || '/';
      toast(n.title || 'Maxvolt One', {
        description: n.body || '',
        action: { label: 'Open', onClick: () => window.dispatchEvent(new CustomEvent('push-notification-tap', { detail: { link } })) },
      });
    } catch { /* toast is a nicety, never let it break push handling */ }
  });

  // Tapped from the system tray (background/killed) — deep-link into the app.
  FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
    const n = event.notification;
    const link = n.data?.link || n.link || '/';
    window.dispatchEvent(new CustomEvent('push-notification-tap', { detail: { link } }));
  });
}

let cachedPlatform = null;
async function registerToken(tokenValue) {
  await base44.functions.invoke('registerDeviceToken', {
    token: tokenValue,
    platform: cachedPlatform === 'ios' ? 'fcm_ios' : 'fcm_android',
  });
}

// Full registration attempt, returning exactly which step it reached instead
// of swallowing failures into a console.warn nobody sees on a real device.
// Safe to call repeatedly (e.g. a manual "Register This Device" retry) —
// listeners only ever attach once, token registration is a harmless upsert.
export async function registerNativePush() {
  let Capacitor;
  try {
    ({ Capacitor } = await import('@capacitor/core'));
  } catch (e) {
    return { step: 'capacitor_core_missing', error: e.message };
  }
  if (!Capacitor.isNativePlatform()) return { step: 'not_native' }; // plain browser tab — Web Push handles this path

  let FirebaseMessaging;
  try {
    ({ FirebaseMessaging } = await import('@capacitor-firebase/messaging'));
  } catch (e) {
    return { step: 'plugin_missing', error: e.message };
  }

  cachedPlatform = Capacitor.getPlatform(); // 'android' | 'ios'

  let perm;
  try {
    perm = await FirebaseMessaging.checkPermissions();
  } catch (e) {
    return { step: 'permission_check_failed', error: e.message };
  }

  if (perm.receive !== 'granted') {
    let req;
    try {
      req = await FirebaseMessaging.requestPermissions();
    } catch (e) {
      return { step: 'permission_request_failed', error: e.message };
    }
    if (req.receive !== 'granted') {
      return { step: 'permission_denied', permission_state: req.receive };
    }
  }

  await attachListenersOnce(FirebaseMessaging);

  let token;
  try {
    const res = await FirebaseMessaging.getToken();
    token = res?.token;
  } catch (e) {
    return { step: 'token_fetch_failed', error: e.message };
  }
  if (!token) return { step: 'token_empty' };

  try {
    await registerToken(token);
  } catch (e) {
    return { step: 'backend_registration_failed', error: e.message, token_prefix: token.slice(0, 12) };
  }

  return { step: 'success', token_prefix: token.slice(0, 12) };
}

export async function initNativePush() {
  if (autoInitDone) return;
  const result = await registerNativePush();
  if (result.step !== 'success') {
    console.warn('[nativePush] registration did not complete:', result.step, result.error || '');
  }
  // Only latch permanently for outcomes that genuinely won't change within
  // this session (already succeeded, or this isn't a native shell at all).
  // Everything else (permission/token/network failures) stays retryable —
  // both automatically on next app open and via the manual "Register This
  // Device" action in App Settings.
  if (result.step === 'success' || result.step === 'not_native') autoInitDone = true;
}

export async function clearNativePushToken() {
  let Capacitor;
  try {
    ({ Capacitor } = await import('@capacitor/core'));
  } catch { return; }
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    // Tell the backend first, while we still know the token, so a device
    // handed to another employee doesn't keep receiving this user's pushes.
    const { token } = await FirebaseMessaging.getToken().catch(() => ({ token: null }));
    if (token) await base44.functions.invoke('unregisterDeviceToken', { token }).catch(() => {});
    await FirebaseMessaging.deleteToken();
    await FirebaseMessaging.removeAllListeners();
    listenersAttached = false;
    autoInitDone = false;
  } catch { /* best-effort on logout */ }
}
