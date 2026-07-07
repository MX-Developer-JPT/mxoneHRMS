// Push notifications, two channels:
//  1. Web Push (VAPID) — browser tabs / installed PWA, existing behaviour unchanged.
//  2. FCM (Firebase Cloud Messaging) — the native Capacitor shell on both Android and
//     iOS (via @capacitor-firebase/messaging, which does the APNs<->FCM token exchange
//     on-device), so notifications land in the real system tray/notification shade even
//     when the app is fully closed, the same way WhatsApp/any native app does. Silently
//     no-ops if Firebase isn't configured (FIREBASE_SERVICE_ACCOUNT_JSON not set) so
//     this never blocks web push.
import webpush from 'web-push';
import { one, all, run } from '../db.js';

const CONTACT = process.env.VAPID_SUBJECT || 'mailto:hr@maxvoltenergy.com';

let vapid = null; // { publicKey, privateKey }

async function loadVapid() {
  if (vapid) return vapid;

  // 1. Environment variables take precedence
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    // 2. Persisted in settings?
    try {
      const pub = await one("SELECT value FROM settings WHERE key='vapid_public_key'");
      const prv = await one("SELECT value FROM settings WHERE key='vapid_private_key'");
      if (pub?.value && prv?.value) {
        vapid = { publicKey: pub.value, privateKey: prv.value };
      } else {
        // 3. Generate + persist
        const gen = webpush.generateVAPIDKeys();
        vapid = { publicKey: gen.publicKey, privateKey: gen.privateKey };
        await run("INSERT INTO settings(key,value,updated_at) VALUES('vapid_public_key',$1,NOW()::TEXT) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [gen.publicKey]);
        await run("INSERT INTO settings(key,value,updated_at) VALUES('vapid_private_key',$1,NOW()::TEXT) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [gen.privateKey]);
        console.log('✓ Generated and persisted new VAPID keys for web push');
      }
    } catch (e) {
      console.warn('[push] VAPID init failed:', e.message);
      return null;
    }
  }

  webpush.setVapidDetails(CONTACT, vapid.publicKey, vapid.privateKey);
  return vapid;
}

export async function getPublicKey() {
  const v = await loadVapid();
  return v?.publicKey || null;
}

export async function saveSubscription(userId, subscription) {
  if (!subscription?.endpoint || !subscription?.keys) return false;
  await run(
    `INSERT INTO push_subscriptions(endpoint,user_id,keys) VALUES($1,$2,$3)
     ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, keys=EXCLUDED.keys`,
    [subscription.endpoint, userId, JSON.stringify(subscription.keys)]
  );
  return true;
}

export async function removeSubscription(endpoint) {
  if (!endpoint) return;
  await run("DELETE FROM push_subscriptions WHERE endpoint=$1", [endpoint]);
}

/* ── FCM (native Android push) ──────────────────────────────── */

let fcmApp = null;   // firebase-admin app instance, or false if unavailable/misconfigured
let fcmInitTried = false;

async function loadFcm() {
  if (fcmInitTried) return fcmApp || null;
  fcmInitTried = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null; // not configured — native push simply stays off, web push unaffected
  try {
    const admin = (await import('firebase-admin')).default;
    const serviceAccount = JSON.parse(raw);
    fcmApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'maxvoltPush');
    console.log('✓ Firebase Admin initialized for native push (FCM)');
    return fcmApp;
  } catch (e) {
    console.warn('[push] FCM init failed — check FIREBASE_SERVICE_ACCOUNT_JSON:', e.message);
    fcmApp = false;
    return null;
  }
}

export async function saveDeviceToken(userId, token, platform = 'fcm_android') {
  if (!token) return false;
  await run(
    `INSERT INTO device_tokens(token,user_id,platform,updated_at) VALUES($1,$2,$3,NOW()::TEXT)
     ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform, updated_at=NOW()::TEXT`,
    [token, userId, platform]
  );
  return true;
}

export async function removeDeviceToken(token) {
  if (!token) return;
  await run("DELETE FROM device_tokens WHERE token=$1", [token]);
}

// Severity → Android notification channel. Kept to the 4 values already used across
// the app (info/success/warning/error) so no other backend code needs to change.
const CHANNEL_BY_TYPE = {
  error:   'alerts',
  warning: 'alerts',
  success: 'updates',
  info:    'general',
};

// Returns a diagnostic result so callers (e.g. the sendTestPush function-route)
// can tell a user exactly where delivery failed instead of guessing blind —
// "server has no Firebase credentials" vs "no device registered" vs a specific
// per-token FCM rejection reason are three very different fixes.
async function sendFcmToUser(userId, payload) {
  const app = await loadFcm();
  if (!app) return { attempted: false, reason: 'fcm_not_configured_on_server' };
  const tokens = (await all("SELECT token, platform FROM device_tokens WHERE user_id=$1", [userId])).map(r => r.token);
  if (!tokens.length) return { attempted: false, reason: 'no_device_token_registered' };

  const admin = (await import('firebase-admin')).default;
  const messaging = admin.messaging(app);
  const channelId = CHANNEL_BY_TYPE[payload.type] || 'general';

  const message = {
    notification: {
      title: payload.title || 'Maxvolt HR',
      body: payload.message || payload.body || '',
    },
    data: {
      link: payload.link || '/',
      type: payload.type || 'info',
    },
    android: {
      priority: (payload.type === 'error' || payload.type === 'warning') ? 'high' : 'normal',
      notification: {
        channelId,
        // No custom "icon" here on purpose: it must reference a small white-silhouette
        // drawable resource shipped in the app; referencing one that doesn't exist yet
        // can silently drop the notification on some Android versions. Falls back to
        // the launcher icon until a proper monochrome icon is added (see MOBILE_BUILD.md).
        color: '#F97316',
        tag: payload.type || 'maxvolt-hr', // same-type notifications replace/group, like WhatsApp threads
      },
    },
    // iOS ignores the "android" block above (separate Firebase config namespace) —
    // without this, iOS deliveries would arrive with no sound/badge/grouping at all.
    apns: {
      headers: {
        'apns-priority': (payload.type === 'error' || payload.type === 'warning') ? '10' : '5',
      },
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          'thread-id': payload.type || 'maxvolt-hr', // same-type notifications stack together, like WhatsApp threads
        },
      },
    },
  };

  const results = await Promise.allSettled(tokens.map(token => messaging.send({ ...message, token })));
  const stale = [];
  const perToken = results.map((r, i) => {
    if (r.status === 'fulfilled') return { token: tokens[i].slice(0, 12) + '…', ok: true };
    const code = r.reason?.errorInfo?.code || r.reason?.code || '';
    const message = r.reason?.errorInfo?.message || r.reason?.message || String(r.reason);
    if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) stale.push(tokens[i]);
    return { token: tokens[i].slice(0, 12) + '…', ok: false, code, message };
  });
  if (stale.length) await Promise.all(stale.map(t => removeDeviceToken(t).catch(() => {})));
  return { attempted: true, token_count: tokens.length, sent_ok: perToken.filter(r => r.ok).length, results: perToken };
}

// Fire-and-forget push to every device a user has registered — both web push
// subscriptions AND native Android (FCM) tokens get the same notification.
export async function sendPushToUser(userId, payload) {
  try {
    const v = await loadVapid();
    if (v) {
      const subs = await all("SELECT endpoint,keys FROM push_subscriptions WHERE user_id=$1", [userId]);
      if (subs.length) {
        const body = JSON.stringify({
          title: payload.title || 'Maxvolt HR',
          body: payload.message || payload.body || '',
          link: payload.link || '/',
          type: payload.type || 'info',
        });
        await Promise.all(subs.map(async (s) => {
          const subscription = { endpoint: s.endpoint, keys: JSON.parse(s.keys) };
          try {
            await webpush.sendNotification(subscription, body);
          } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) {
              await removeSubscription(s.endpoint).catch(() => {});
            }
          }
        }));
      }
    }
  } catch (e) {
    console.warn('[push] sendPushToUser (web push) error:', e.message);
  }

  try {
    await sendFcmToUser(userId, payload);
  } catch (e) {
    console.warn('[push] sendPushToUser (FCM) error:', e.message);
  }
}

// Self-diagnostic variant — returns exactly where delivery stands instead of
// swallowing everything, so a user/HR can tell in one tap whether the problem
// is "server has no Firebase credentials", "this device never registered a
// token", or a specific FCM rejection reason per token.
export async function sendTestPushToUser(userId) {
  const fcmResult = await sendFcmToUser(userId, {
    title: 'Maxvolt HR — Test Notification',
    message: 'If you can see this, native push notifications are working correctly.',
    type: 'info',
    link: '/',
  }).catch(e => ({ attempted: false, reason: 'error', error: e.message }));
  return { fcm: fcmResult };
}
