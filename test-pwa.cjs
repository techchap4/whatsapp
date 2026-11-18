// Run with: node test-pwa.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

(async () => {
  const listeners = {};
  const scope = 'https://example.test/nested/app/';
  let online = true, fetched = [];
  const self = {
    registration: { scope, showNotification: async () => {} },
    clients: { claim: async () => {}, matchAll: async () => [] },
    skipWaiting: async () => {},
    addEventListener: (name, cb) => { listeners[name] = cb; }
  };
  const network = async (request) => { fetched.push(request.url); if (!online) throw new TypeError('offline'); return new Response('network'); };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8'), { self, URL, Response, fetch: network });
  assert.ok(listeners.push && listeners.notificationclick, 'existing push listeners remain');
  const dispatch = (url, mode = 'navigate', method = 'GET') => {
    let response;
    listeners.fetch({ request: { url, mode, method }, respondWith: (p) => { response = p; } });
    return response;
  };
  assert.equal(await (await dispatch(scope)).text(), 'network');
  assert.equal(await (await dispatch(scope + 'index.html?source=pwa')).text(), 'network');
  for (const [url, mode, method] of [
    [scope + 'api/messages', 'cors', 'GET'], [scope + 'api/messages', 'navigate', 'GET'],
    [scope + 'auth/callback', 'navigate', 'GET'], [scope + 'index.html', 'navigate', 'POST'],
    [scope + 'app.js', 'no-cors', 'GET'], ['https://other.test/api', 'cors', 'GET'],
    ['https://example.test/nested/application/', 'navigate', 'GET']
  ]) assert.equal(dispatch(url, mode, method), undefined, `must not intercept ${method} ${url}`);
  online = false;
  const res = await dispatch(scope + '?chat=private');
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  assert.match(text, /Chats and calls are not available offline/);
  assert.ok(!text.includes('private'), 'offline notice must not echo chat data');
  assert.equal(dispatch(scope + 'api/messages', 'cors'), undefined);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json')));
  assert.equal(new URL(manifest.start_url, scope + 'manifest.json').pathname, '/nested/app/');
  assert.equal(new URL(manifest.scope, scope + 'manifest.json').pathname, '/nested/app/');
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(__dirname, icon.src)), icon.src);
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192'));
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png'));
  assert.ok(!/\bcaches\s*\./.test(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')), 'worker must not access Cache Storage');
  console.log('PWA checks passed: network, offline, sensitive routes, subpath, manifest, icons, notification handlers, no Cache Storage');
})().catch((err) => { console.error(err); process.exitCode = 1; });
