// Web Push notifications via VAPID.
// Keys come from env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) when set, otherwise
// they are generated once and persisted in the settings table so they survive
// restarts without manual configuration.

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

// Fire-and-forget push to every device a user has registered.
export async function sendPushToUser(userId, payload) {
  try {
    const v = await loadVapid();
    if (!v) return;
    const subs = await all("SELECT endpoint,keys FROM push_subscriptions WHERE user_id=$1", [userId]);
    if (!subs.length) return;

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
        // 404/410 → subscription expired; clean it up
        if (err.statusCode === 404 || err.statusCode === 410) {
          await removeSubscription(s.endpoint).catch(() => {});
        }
      }
    }));
  } catch (e) {
    console.warn('[push] sendPushToUser error:', e.message);
  }
}
