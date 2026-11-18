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

// Only the app entry itself counts as an open app, not another page on the origin.
function isAppWindow(client) {
  try {
    const scope = new URL(self.registration.scope), url = new URL(client.url);
    return url.origin === scope.origin && (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html');
  } catch (e) { return false; }
}
function chatId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null; }

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data?.json() || {}; } catch (e) {}
  event.waitUntil((async () => {
    // A failed client lookup must not lose an incoming call or message.
    let wins = [];
    try { wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); } catch (e) {}
    if (wins.some((w) => isAppWindow(w) && w.visibilityState === 'visible')) return;
    const message = d.type === 'message', ring = d.type === 'invite';
    const id = message ? chatId(d.from) : null;
    await self.registration.showNotification('Rada', {
      body: message ? 'New message' : ring ? 'Incoming call' : d.type === 'missed' ? 'Missed call' : 'New notification',
      tag: message ? 'rada-message' : 'call',
      renotify: true,
      requireInteraction: ring,
      vibrate: ring ? [500, 250, 500, 250, 500, 250, 500] : [200],
      icon: 'icon-maskable-512.png', badge: 'icon-maskable-512.png',
      data: message && id ? { type: 'message', from: id } : { type: message ? 'message' : (ring ? 'invite' : 'other') }
    });
  })());
});

// Acknowledgement avoids assuming older open tabs understand the message.
async function queueInClient(client, id) {
  if (typeof MessageChannel === 'undefined') return false;
  const channel = new MessageChannel();
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(ok); };
    const timer = setTimeout(() => finish(false), 1200);
    channel.port1.onmessage = (event) => finish(event.data === 'queued');
    try { client.postMessage({ type: 'open-chat', id }, [channel.port2]); } catch (e) { finish(false); }
  });
}
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const id = d.type === 'message' ? chatId(d.from) : null;
  event.waitUntil((async () => {
    const target = new URL(self.registration.scope);
    if (id) target.searchParams.set('chat', id);
    let wins = [];
    try { wins = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(isAppWindow); } catch (e) {}
    for (const win of wins) {
      try {
        await win.focus();
        if (!id || await queueInClient(win, id)) return;
        // Older tabs do not handle open-chat. Navigate only as a fallback.
        if (typeof win.navigate === 'function' && await win.navigate(target.href)) return;
      } catch (e) { /* Try another app window or open a new one. */ }
    }
    try { await self.clients.openWindow(target.href); } catch (e) { /* platform may deny opening */ }
  })());
});
