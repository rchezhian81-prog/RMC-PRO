// ─────────────────────────────────────────────────────────────────────────────
//  RMC Pro — Service Worker
//  Enables offline support, caching & background sync
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME    = 'rmc-pro-v1.0.0';
const OFFLINE_PAGE  = '/index.html';

// Files to cache on install (app shell)
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Google Fonts (cached after first load)
  'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;600&display=swap'
];

// ── INSTALL: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing RMC Pro v1.0.0…');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching app shell');
        return cache.addAll(APP_SHELL.filter(url => !url.startsWith('https://fonts')));
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating…');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: cache-first for shell, network-first for data ─────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and browser-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Strategy: Cache First for app shell assets
  if (
    url.origin === self.location.origin ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Strategy: Network First for API/data calls
  event.respondWith(networkFirst(request));
});

// ── CACHE FIRST strategy ──────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline fallback
    const offlinePage = await caches.match(OFFLINE_PAGE);
    return offlinePage || new Response(
      '<h1>RMC Pro — You are offline</h1><p>Please reconnect to continue.</p>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

// ── NETWORK FIRST strategy ────────────────────────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match(OFFLINE_PAGE);
  }
}

// ── BACKGROUND SYNC: queue batch entries when offline ────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-batches') {
    console.log('[SW] Syncing offline batch entries…');
    event.waitUntil(syncOfflineBatches());
  }
  if (event.tag === 'sync-trips') {
    console.log('[SW] Syncing offline trip logs…');
    event.waitUntil(syncOfflineTrips());
  }
});

async function syncOfflineBatches() {
  // In production: read from IndexedDB and POST to your API
  console.log('[SW] Batch sync complete');
}

async function syncOfflineTrips() {
  console.log('[SW] Trip sync complete');
}

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title   = data.title   || 'RMC Pro Alert';
  const options = {
    body:    data.body    || 'You have a new notification',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-72.png',
    vibrate: [200, 100, 200],
    data:    { url: data.url || '/' },
    actions: [
      { action: 'view',    title: '👁 View',   icon: '/icons/icon-72.png' },
      { action: 'dismiss', title: '✕ Dismiss', icon: '/icons/icon-72.png' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'view' || !event.action) {
    const url = event.notification.data.url || '/';
    event.waitUntil(clients.openWindow(url));
  }
});
