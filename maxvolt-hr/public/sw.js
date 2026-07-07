// Maxvolt HR — Service Worker
// Strategy: cache-first for static assets, network-first for API
// Plus Web Push notification handling.

const CACHE   = 'maxvolt-hr-v4';
const API_PREFIX = '/api/';

const PRECACHE = [
  '/',
  '/manifest.json',
  '/icons/icon.svg',
];

// ── Install: precache shell ─────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch ───────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls — network first, no caching
  if (url.pathname.startsWith(API_PREFIX)) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline — no network connection' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503,
        })
      )
    );
    return;
  }

  // Navigation / HTML shell — ALWAYS network-first. Serving a stale cached
  // index.html after a deploy makes it reference JS chunk files that no
  // longer exist on the server (old dist assets are replaced on every
  // deploy), which is exactly what causes "Failed to fetch dynamically
  // imported module" errors on lazy-loaded routes. Only fall back to cache
  // when genuinely offline.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('/')))
    );
    return;
  }

  // Static assets — cache first, fallback to network
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // Cache successful static responses
        if (response.ok && (
          request.destination === 'script' ||
          request.destination === 'style'  ||
          request.destination === 'image'  ||
          request.destination === 'font'
        )) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() =>
        // Offline fallback — serve app shell
        caches.match('/') || new Response('Offline', { status: 503 })
      );
    })
  );
});

// ── Web Push ─────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Maxvolt HR';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { link: data.link || '/' },
    tag: data.type || 'maxvolt-hr',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      // Focus an existing tab if open, else open a new one
      for (const w of wins) {
        if ('focus' in w) { w.focus(); if ('navigate' in w) w.navigate(link); return; }
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
