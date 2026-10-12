/* ChatApp service worker:
   1) makes the app installable + opens instantly / offline shell
   2) shows "incoming call" notifications when the app is closed or in the background */
const CACHE = 'chatapp-shell-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'pwa.js', 'manifest.json',
  'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first for our own files (so updates show up), cache as fallback when offline.
// Supabase API / realtime / storage and everything else is never touched.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !cdn) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const shell = await cache.match('index.html'); if (shell) return shell; }
      throw err;
    }
  })());
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data.json(); } catch (e) {}
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible')) return;   // app is open: it rings by itself
    const ring = d.type === 'invite';
    await self.registration.showNotification(d.title || 'ChatApp', {
      body: d.body || '',
      tag: 'call',
      renotify: true,
      requireInteraction: ring,
      vibrate: ring ? [500, 250, 500, 250, 500, 250, 500] : [200],
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: d
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) return wins[0].focus();   // the app re-sends the invite every 2.5s, so the call screen appears
    return self.clients.openWindow('./');
  })());
});