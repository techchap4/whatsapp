/* Rada service worker. No requests or responses are stored in Cache Storage.
   Only the app entry navigation gets a generic offline message; chat,
   authentication, APIs, media and all other requests always use the network. */
self.addEventListener('install', (e) => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

// Exact app entry paths only, including deployments under a subdirectory.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || (url.pathname !== scope.pathname && url.pathname !== scope.pathname + 'index.html')) return;
  e.respondWith(fetch(req).catch(() => new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rada is offline</title><body><main><h1>Rada is offline</h1><p>Connect to the internet and try again. Chats and calls are not available offline.</p><p><a href="./">Try again</a></p></main></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  )));
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data.json(); } catch (e) {}
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible')) return;   // app is open: it handles sound/alerts by itself

    /* ---- new chat message ---- */
    if (d.type === 'message') {
      await self.registration.showNotification(d.title || 'Rada', {
        body: d.body || 'New message',
        tag: 'msg-' + (d.from || 'x'),        // one stacked notification per sender
        renotify: true,
        vibrate: [200, 100, 200],
        icon: 'icon-maskable-512.png',
        badge: 'icon-maskable-512.png',
        data: d
      });
      return;
    }

    /* ---- calls (invite / missed) ---- */
    const ring = d.type === 'invite';
    await self.registration.showNotification(d.title || 'Rada', {
      body: d.body || '',
      tag: 'call',
      renotify: true,
      requireInteraction: ring,
      vibrate: ring ? [500, 250, 500, 250, 500, 250, 500] : [200],
      icon: 'icon-maskable-512.png',
      badge: 'icon-maskable-512.png',
      data: d
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const chatId = d.type === 'message' ? d.from : null;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      // app already open somewhere: bring it forward (calls re-send the invite every 2.5s, so the call screen appears)
      try { await wins[0].focus(); } catch (e) {}
      if (chatId) wins[0].postMessage({ type: 'open-chat', id: chatId });
      return;
    }
    // app was closed: open it straight into that chat
    return self.clients.openWindow(chatId ? './?chat=' + encodeURIComponent(chatId) : './');
  })());
});