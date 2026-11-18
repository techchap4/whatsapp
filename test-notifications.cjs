const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('sw.js', 'utf8');
async function worker({ windows = [], failMatch = false } = {}) {
  const handlers = {}, shown = [], opened = [];
  class Channel {
    constructor() {
      this.port1 = { close() {} };
      this.port2 = { close() {}, postMessage: (data) => this.port1.onmessage({ data }) };
    }
  }
  const self = {
    registration: { scope: 'https://example.test/rada/', showNotification: async (...args) => shown.push(args) },
    clients: { matchAll: async () => { if (failMatch) throw Error('lookup'); return windows; }, openWindow: async (url) => opened.push(url) },
    addEventListener: (name, fn) => { handlers[name] = fn; },
  };
  vm.runInNewContext(source, { self, URL, Response, MessageChannel: Channel, setTimeout, clearTimeout });
  return {
    shown, opened,
    push: async (data) => { let promise; handlers.push({ data: { json: () => data }, waitUntil: (p) => { promise = p; } }); await promise; },
    badPush: async () => { let promise; handlers.push({ data: { json: () => { throw Error(); } }, waitUntil: (p) => { promise = p; } }); await promise; },
    click: async (data) => { let promise, closed = false; handlers.notificationclick({ notification: { data, close: () => { closed = true; } }, waitUntil: (p) => { promise = p; } }); await promise; assert(closed); },
  };
}
(async () => {
  let w = await worker();
  await w.push({ type: 'message', from: 'id/a', title: 'Private name', body: 'Secret text', avatar: 'private-url' });
  assert.equal(w.shown[0][0], 'Rada');
  assert.equal(w.shown[0][1].body, 'New message');
  assert.equal(w.shown[0][1].tag, 'rada-message');
  assert(!JSON.stringify(w.shown).includes('Private name'));
  assert(!JSON.stringify(w.shown).includes('Secret text'));
  assert(!JSON.stringify(w.shown).includes('private-url'));
  assert.deepEqual(JSON.parse(JSON.stringify(w.shown[0][1].data)), { type: 'message', from: 'id/a' });
  await w.push({ type: 'invite', title: 'Caller name', body: 'Private call' });
  assert.equal(w.shown[1][1].body, 'Incoming call'); assert.equal(w.shown[1][1].requireInteraction, true);
  await w.push({ type: 'missed', body: 'secret' }); assert.equal(w.shown[2][1].body, 'Missed call');
  await w.badPush(); assert.equal(w.shown[3][1].body, 'New notification');
  await w.click({ type: 'message', from: 'id/a' });
  assert.equal(w.opened[0], 'https://example.test/rada/?chat=id%2Fa');
  w = await worker({ failMatch: true }); await w.push({type: 'message', from:'x'}); assert.equal(w.shown.length, 1);
  await w.click({type: 'invite'}); assert.equal(w.opened[0], 'https://example.test/rada/');
  w = await worker({ windows: [{ url:'https://example.test/rada/admin.html', visibilityState:'visible' }] });
  await w.push({type:'message',from:'x'}); assert.equal(w.shown.length, 1);
  w = await worker({ windows: [{ url:'https://example.test/rada/', visibilityState:'visible' }] });
  await w.push({type:'message',from:'x'}); assert.equal(w.shown.length, 0);
  let posted;
  const app = { url:'https://example.test/rada/index.html', focus:async()=>{}, postMessage:(data, ports)=>{posted=data; ports[0].postMessage('queued');} };
  w = await worker({windows:[app]}); await w.click({type:'message',from:'someone'});
  assert.equal(posted.type,'open-chat'); assert.equal(posted.id,'someone'); assert.equal(w.opened.length,0);
  let navigated;
  const oldApp = { url:'https://example.test/rada/', focus:async()=>{}, postMessage:()=>{throw Error('old tab');}, navigate:async url=>{navigated=url; return true;} };
  w = await worker({windows:[oldApp]}); await w.click({type:'message',from:'someone'}); assert.equal(navigated,'https://example.test/rada/?chat=someone');
  const broken = { url:'https://example.test/rada/', focus:async()=>{throw Error('closed');} };
  w = await worker({windows:[broken]}); await w.click({type:'message',from:'someone'}); assert.equal(w.opened[0],'https://example.test/rada/?chat=someone');

  const backend=fs.readFileSync('index.TS','utf8');
  assert(backend.includes('notif?.messages === false || notif?.desktop === false'));
  assert(backend.includes('JSON.stringify({ type: "message", from: m.sender_id })'));
  assert(!backend.includes('previewOf('));
  console.log('Notification checks passed: worker previews, routing, failures and calls; backend payload checks');
})().catch(e=>{console.error(e); process.exitCode=1;});
