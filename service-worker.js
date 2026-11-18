const CACHE = 'taxipro-dispatch-v32-safety';const ASSETS = [
  './',
  './index.html',
  './home.html',
  './dispatch.html',
  './driver.html',
  './traffic.html',
  './manifest.json',
  './manifest-driver.json',
  './series-system.css',
  './series-system.js',
  './traffic-module.css',
  './traffic-module.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(ASSETS.map((url) => cache.add(url))).then(() => self.skipWaiting())
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('taxipro-dispatch-') && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'notify') {
    const { title, body, tag } = e.data;
    self.registration.showNotification(title || 'TaxiPro', {
      body: body || '',
      tag: tag || 'taxipro-driver',
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [120, 60, 120],
      data: { url: './driver.html' }
    });
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || './index.html?mode=driver';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('mode=driver') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Never cache URLs containing legacy authentication tokens or patient links.
  // A cache key containing a PIN/token would preserve sensitive URL metadata.
  if (url.searchParams.has('t') || url.searchParams.has('token') ||
      url.searchParams.has('p') || url.searchParams.has('pin') ||
      url.searchParams.has('boot') || url.searchParams.has('gd') ||
      url.searchParams.has('sy') || url.searchParams.has('pu')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Der öffentliche Verkehrsfeed und die beiden Moduldaten dürfen nie
  // dauerhaft aus einem alten Precache beantwortet werden.
  const freshFirst = url.pathname.endsWith('.html') || url.pathname.endsWith('/') ||
    ['traffic-module.js', 'traffic-module.css', 'traffic-feed.json'].some((name) => url.pathname.endsWith('/' + name));
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then(async (res) => {
          if (res && res.ok && (freshFirst || url.pathname.endsWith('.html') || url.pathname.endsWith('/'))) {
            try {
              const cache = await caches.open(CACHE);
              await cache.put(e.request, res.clone());
            } catch (_) { /* Speicher kann voll sein; online bleibt funktionsfähig. */ }
          }
          return res;
        })
        .catch(() => null);
      return freshFirst
        ? network.then((fresh) => fresh || cached || Response.error())
        : cached || network.then((fresh) => fresh || Response.error());
    })
  );
});
