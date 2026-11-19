'use strict';
// INACTIVE / INCOMPLETE proposal: these offline synthetic-data tests target the
// patched app.js and extras.js, NOT this branch as-is. They are expected to fail
// until app-privacy-INACTIVE.patch is reviewed and applied in an isolated checkout.
// They do not verify backend permissions, E2E behavior, or live security.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.js', 'utf8');
const extras = fs.readFileSync('extras.js', 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing function boundary: ${start}`);
  return source.slice(a, b);
}
function context(source, globals) { const c = vm.createContext(globals); vm.runInContext(source, c); return c; }
const markSrc = between(app, 'async function markRead(', "document.addEventListener('visibilitychange'");
const loadSrc = between(app, 'async function loadMessages()', 'async function loadStatuses()');
const onMsgSrc = between(app, 'function onMessage(', 'function desktopNotify(');
const subSrc = between(app, 'function subscribe()', '\nfunction onMessage(');
const tickSrc = between(extras, 'function tickHtml(', '/* ---------------- small UI helpers');
const verifySrc = between(extras, 'function openVerify()', '/* ============================================================\n   SETTINGS');
function readCtx(receipts) {
  let writes = [];
  const chain = { update(v) { writes.push(['update', v]); return this; }, eq(k, v) { writes.push([k, v]); return this; } };
  const c = context(markSrc, { me: { id: 'me' }, profiles: { me: {} }, messages: [{ id: 1, sender_id: 'peer', receiver_id: 'me', read: false }, { id: 2, sender_id: 'other', receiver_id: 'me', read: false }], S: () => ({ privacy: { receipts } }), sb: { from(t) { writes.push(['table', t]); return chain; } }, renderList() {}, updateTitle() {} });
  return { c, writes };
}
test('disabled receipts: no server write, indicators clear in this tab only', async () => {
  const { c, writes } = readCtx(false); await c.markRead('peer');
  assert.equal(writes.length, 0); assert.equal(c.messages[0].read, true); assert.equal(c.messages[1].read, false);
});
test('enabled receipts write only incoming unread messages for this peer', async () => {
  const { c, writes } = readCtx(true); await c.markRead('peer');
  assert.deepEqual(writes.map(x => x[0]), ['table', 'update', 'sender_id', 'receiver_id', 'read']);
  assert.equal(writes[2][1], 'peer'); assert.equal(writes[3][1], 'me'); assert.equal(writes[4][1], false); assert.equal(writes[1][1].read, true);
});
test('empty unread list does not write', async () => { const { c, writes } = readCtx(true); await c.markRead('absent'); assert.equal(writes.length, 0); });
test('missing own profile fails closed for receipt writes', async () => { const { c, writes } = readCtx(true); c.profiles = {}; await c.markRead('peer'); assert.equal(writes.length, 0); });
test('read ticks hide both count and color if either participant opted out', () => {
  const profiles = { peer: { settings: { privacy: { receipts: true } } } };
  let own = true;
  const c = context(tickSrc, { profiles, S: () => ({ privacy: { receipts: own } }) });
  const msg = { receiver_id: 'peer', read: true };
  assert.match(c.tickHtml(msg), /tick read.*✓✓/);
  own = false; assert.match(c.tickHtml(msg), /tick .*✓<\/span>/); assert.doesNotMatch(c.tickHtml(msg), /✓✓|tick read/);
  own = true; profiles.peer.settings.privacy.receipts = false;
  assert.doesNotMatch(c.tickHtml(msg), /✓✓|tick read/);
  msg.read = false; profiles.peer.settings.privacy.receipts = true; assert.doesNotMatch(c.tickHtml(msg), /✓✓|tick read/);
});
test('message loading scopes the query and rejects unrelated rows', async () => {
  let filter; const rows = [{ sender_id: 'me', receiver_id: 'p' }, { sender_id: 'q', receiver_id: 'me' }, { sender_id: 'q', receiver_id: 'p' }];
  const chain = { select() { return this; }, or(v) { filter = v; return this; }, order() { return this; }, limit() { return Promise.resolve({ data: rows, error: null }); } };
  const c = context(loadSrc, { me: { id: 'me' }, messages: [], sb: { from: () => chain }, console });
  await c.loadMessages(); assert.equal(filter, 'sender_id.eq.me,receiver_id.eq.me'); assert.equal(c.messages.length, 2);
});
test('message loading discards results after account changes', async () => {
  let finish; const chain = { select() { return this; }, or() { return this; }, order() { return this; }, limit() { return new Promise(r => { finish = r; }); } };
  const c = context(loadSrc, { me: { id: 'me' }, messages: [], sb: { from: () => chain }, console });
  const p = c.loadMessages(); c.me = { id: 'new' }; finish({ data: [{ sender_id: 'me' }], error: null }); await p; assert.equal(c.messages.length, 0);
});
test('live event handler ignores messages unrelated to the signed-in user', () => {
  const c = context(onMsgSrc, { me: { id: 'me' }, messages: [], activeId: null, renderList() {}, updateTitle() {}, renderMessages() {}, parseCall: () => false, document: { hidden: true }, S: () => ({ notif: { messages: false } }) });
  c.onMessage({ id: 1, sender_id: 'x', receiver_id: 'y' }); assert.equal(c.messages.length, 0);
  c.onMessage({ id: 2, sender_id: 'x', receiver_id: 'me' }); c.onMessage({ id: 2, sender_id: 'x', receiver_id: 'me' }); assert.equal(c.messages.length, 1);
});
test('realtime message subscriptions are participant-filtered and updates are checked', () => {
  const handlers = []; const channel = { on(kind, filter, fn) { handlers.push({kind, filter, fn}); return this; }, subscribe() { return this; } };
  const c = context(subSrc, { me: { id: 'me' }, messages: [{ id: 1, sender_id: 'me', receiver_id: 'peer' }], realtimeCh: null, presenceCh: null, sb: { channel: () => channel }, renderList() {}, renderMessages() {}, activeId: null });
  c.subscribe(); const ms = handlers.filter(h => h.filter.table === 'messages'); assert.equal(ms.length, 4);
  assert.deepEqual(ms.map(h => h.filter.filter).sort(), ['receiver_id=eq.me','receiver_id=eq.me','sender_id=eq.me','sender_id=eq.me']);
  ms.find(h => h.filter.event === 'UPDATE').fn({ new: { id: 1, sender_id: 'x', receiver_id: 'y' } }); assert.equal(c.messages[0].sender_id, 'me');
});
test('verification pause renders no file input or submit action', () => {
  const body = { innerHTML: '' }; let opened = false;
  const m = { querySelector: () => body, classList: { remove: () => { opened = true; } } };
  const c = context(verifySrc, { modal: () => m }); c.openVerify();
  assert.equal(opened, true); assert.match(body.innerHTML, /paused/); assert.doesNotMatch(body.innerHTML, /<input|<button|vf-doc/);
  assert.doesNotMatch(verifySrc, /upload|insert\(/);
});
test('privacy UI states important limitations and re-enable behavior', () => {
  assert.match(extras, /not a guarantee of privacy from other clients or direct access/);
  assert.match(extras, /Unread indicators may return after reload/);
  assert.match(extras, /Turning it on may send receipts/);
  assert.doesNotMatch(extras, /private, only admins see it/);
});
