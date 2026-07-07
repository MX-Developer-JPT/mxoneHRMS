// PWA + Web Push helpers

const TOKEN_KEY = 'base44_access_token';
const getToken = () => localStorage.getItem(TOKEN_KEY);

let swRegistration = null;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // A previously-controlling SW means this is a return visit, not a
    // brand-new install — only in that case do we want a future SW handover
    // to force a reload (on first-ever install, reloading right after the
    // page just finished loading would be a jarring, pointless flash).
    const hadController = !!navigator.serviceWorker.controller;

    swRegistration = await navigator.serviceWorker.register('/sw.js');

    if (hadController) {
      let refreshed = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshed) return;
        refreshed = true;
        window.location.reload();
      });
    }

    // The user previously had to manually refresh to see new features —
    // this was because the app never actively checked for a newer
    // service-worker version. Force a check every time the app is opened
    // or brought back to the foreground; if the server has a newer sw.js,
    // it installs, self-activates (see sw.js skipWaiting/clients.claim),
    // fires 'controllerchange' above, and the page reloads automatically.
    swRegistration.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') swRegistration?.update().catch(() => {});
    });

    return swRegistration;
  } catch (e) {
    console.warn('[pwa] SW registration failed:', e.message);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = swRegistration || await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'default';
  } catch { return 'default'; }
}

// Ask permission, subscribe, and register the subscription with the backend.
export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications are not supported on this device/browser.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const keyRes = await fetch('/api/push/vapid-public-key');
  if (!keyRes.ok) throw new Error('Push is not configured on the server.');
  const { publicKey } = await keyRes.json();

  const reg = swRegistration || await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: JSON.stringify({ subscription: sub }),
  });
  if (!res.ok) throw new Error('Could not save subscription on the server.');
  return true;
}

export async function disablePush() {
  if (!pushSupported()) return;
  try {
    const reg = swRegistration || await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
  } catch (e) { console.warn('[pwa] disablePush failed:', e.message); }
}
