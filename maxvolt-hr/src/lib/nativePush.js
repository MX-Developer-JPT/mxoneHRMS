// Real native push notifications inside the Capacitor shell (Android/iOS).
// No-ops entirely in a regular browser tab — that path already gets Web Push
// (VAPID) via utils/pwa.js, which is unrelated and unaffected by this module.
//
// Android: Capacitor's push-notifications plugin registers with Firebase (via
// google-services.json, see MOBILE_BUILD.md) and hands back a real FCM token —
// sent straight to the backend, works end-to-end with utils/push.js today.
//
// iOS: Capacitor registers with APNs directly and hands back a raw APNs device
// token, tagged 'apns_ios' below. The backend's FCM sender (firebase-admin)
// cannot deliver to a raw APNs token as-is — that needs one more native step
// (either wrap Firebase's iOS SDK so it exchanges the APNs token for an FCM
// token, or send iOS pushes directly via Apple's APNs API). See MOBILE_BUILD.md
// "iOS push — one step short" for the two options. The token is still
// registered here either way so nothing needs to change on this side later.
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

  const { PushNotifications } = await import('@capacitor/push-notifications');
  const platform = Capacitor.getPlatform(); // 'android' | 'ios'

  const perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted') {
    const req = await PushNotifications.requestPermissions();
    if (req.receive !== 'granted') {
      console.warn('[nativePush] permission denied — push notifications will not be delivered');
      return;
    }
  }

  await PushNotifications.register();

  PushNotifications.addListener('registration', async (token) => {
    try {
      await base44.functions.invoke('registerDeviceToken', {
        token: token.value,
        platform: platform === 'ios' ? 'apns_ios' : 'fcm_android',
      });
    } catch (e) {
      console.warn('[nativePush] token registration failed:', e.message);
    }
  });

  PushNotifications.addListener('registrationError', (err) => {
    console.warn('[nativePush] registration error:', err.error);
  });

  // Foreground arrival: FCM/APNs don't auto-display a system notification while
  // the app is in the foreground, so surface it as an in-app toast instead.
  PushNotifications.addListener('pushNotificationReceived', async (notification) => {
    try {
      const { toast } = await import('sonner');
      const link = notification.data?.link || '/';
      toast(notification.title || 'Maxvolt HR', {
        description: notification.body || '',
        action: { label: 'Open', onClick: () => window.dispatchEvent(new CustomEvent('push-notification-tap', { detail: { link } })) },
      });
    } catch { /* toast is a nicety, never let it break push handling */ }
  });

  // Tapped from the system tray (background/killed) — deep-link into the app.
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const link = action.notification?.data?.link || '/';
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
    const { PushNotifications } = await import('@capacitor/push-notifications');
    // Capacitor doesn't expose the last token directly; the backend keeps tokens
    // per-user, so simply letting the next login re-register is sufficient —
    // stale tokens are also self-cleaned server-side on first failed send.
    await PushNotifications.removeAllListeners();
  } catch { /* best-effort on logout */ }
}
