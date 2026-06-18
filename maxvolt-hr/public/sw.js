// Maxvolt HR — Service Worker
// Strategy: cache-first for static assets, network-first for API

const CACHE   = 'maxvolt-hr-v1';
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
