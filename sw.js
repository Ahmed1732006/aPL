const CACHE_NAME = 'in-the-void-shell-v2';
const APP_SHELL = [
  './',
  './index.html',
  './2.html',
  './app/index.html',
  './offline.html',
  './1.png',
  './manifest.webmanifest',
  './app/theme-common.js',
  './app/theme-system.js',
  './midad-round5.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(APP_SHELL.map(url => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const isNavigation = req.mode === 'navigate';

  event.respondWith(
    fetch(req)
      .then(res => {
        try {
          const url = new URL(req.url);
          if (url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => null);
          }
        } catch (_) {}
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (isNavigation) {
          return (await caches.match('./app/index.html')) ||
                 (await caches.match('./index.html')) ||
                 (await caches.match('./offline.html'));
        }
        return caches.match('./offline.html');
      })
  );
});

// Native push notifications on Android are handled by the Capacitor Push
// Notifications plugin (see app/index.html). This listener only covers the
// web/PWA case where a browser push subscription is used directly.
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = payload.title || 'IN THE VOID';
  const options = {
    body: payload.body || '',
    icon: './1.png',
    badge: './1.png',
    data: { url: payload.url || './app/index.html?openNotifCenter=1' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || './app/index.html?openNotifCenter=1';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) { client.navigate(target); return client.focus(); }
      }
      return self.clients.openWindow(target);
    })
  );
});
