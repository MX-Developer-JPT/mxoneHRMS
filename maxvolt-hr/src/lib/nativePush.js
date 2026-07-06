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

let initialized = false;

export async function initNativePush() {
  if (initialized) return;
  initialized = true;

  let Capacitor;
  try {
    ({ Capacitor } = await import('@capacitor/core'));
  } catch {
    return; // @capacitor/core not bundled (shouldn't happen, but never break the web app over this)
  }
  if (!Capacitor.isNativePlatform()) return; // plain browser tab — Web Push handles this path

  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
  const platform = Capacitor.getPlatform(); // 'android' | 'ios'

  const perm = await FirebaseMessaging.checkPermissions();
  if (perm.receive !== 'granted') {
    const req = await FirebaseMessaging.requestPermissions();
    if (req.receive !== 'granted') {
      console.warn('[nativePush] permission denied — push notifications will not be delivered');
      return;
    }
  }

  const registerToken = async (tokenValue) => {
    try {
      await base44.functions.invoke('registerDeviceToken', {
        token: tokenValue,
        platform: platform === 'ios' ? 'fcm_ios' : 'fcm_android',
      });
    } catch (e) {
      console.warn('[nativePush] token registration failed:', e.message);
    }
  };

  try {
    const { token } = await FirebaseMessaging.getToken();
    if (token) await registerToken(token);
  } catch (e) {
    console.warn('[nativePush] getToken failed:', e.message);
  }

  FirebaseMessaging.addListener('tokenReceived', (event) => {
    if (event.token) registerToken(event.token);
  });

  // Foreground arrival: FCM doesn't auto-display a system notification while
  // the app is in the foreground, so surface it as an in-app toast instead.
  FirebaseMessaging.addListener('notificationReceived', async (event) => {
    try {
      const { toast } = await import('sonner');
      const n = event.notification;
      const link = n.data?.link || n.link || '/';
      toast(n.title || 'Maxvolt HR', {
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
  } catch { /* best-effort on logout */ }
}
