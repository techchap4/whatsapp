/* ChatApp service worker: shows "incoming call" notifications when the app is closed or in the background */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
      icon: 'icon.svg',
      badge: 'icon.svg',
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