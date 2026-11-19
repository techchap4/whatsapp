import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLinkManager, memoryAuth } from './link.mjs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function sockets() {
  const made = [];
  const factory = config => {
    const ev = new EventEmitter();
    const s = { config, ev, ended: false, loggedOut: false,
      requestPairingCode: async phone => { assert.equal(phone, '15551234567'); return 'ABCDEFGH'; },
      end() { this.ended = true; }, async logout() { this.loggedOut = true; } };
    made.push(s); queueMicrotask(() => { ev.emit('connection.update', { connection: 'connecting' }); ev.emit('connection.update', { qr: 'test-only-readiness-signal' }); }); return s;
  };
  return { made, factory };
}

test('volatile signal keys support set, get, delete and clear', async () => {
  const auth = memoryAuth();
  await auth.state.keys.set({ 'session': { a: Buffer.from('x'), b: Buffer.from('y') } });
  assert.equal((await auth.state.keys.get('session', ['a'])).a.toString(), 'x');
  await auth.state.keys.set({ 'session': { a: null } });
  assert.deepEqual(await auth.state.keys.get('session', ['a']), {});
  auth.clear(); assert.deepEqual(await auth.state.keys.get('session', ['b']), {});
});

test('separate authenticated owners, bounds, no code in state and unlink', async () => {
  const { made, factory } = sockets(); const m = createLinkManager({ socketFactory: factory });
  assert.equal(await m.pair(A, '15551234567'), 'ABCDEFGH');
  assert.deepEqual(m.status(A), { status: 'pairing' }); assert.deepEqual(m.status(B), { status: 'unlinked' });
  assert.deepEqual(m.chats(B), []); assert(!JSON.stringify(m.status(A)).includes('ABCDEFGH'));
  await assert.rejects(m.pair(A, '15551234567'), /already_linked/);
  assert.equal(await m.pair(B, '15551234567'), 'ABCDEFGH');
  made[0].ev.emit('connection.update', { connection: 'open' });
  made[1].ev.emit('connection.update', { connection: 'open' });
  const messages = Array.from({ length: 50 }, (_,i) => ({ key: { remoteJid: 'a@s.whatsapp.net', id: String(i) }, message: { conversation: 'a'.repeat(5000) } }));
  made[0].ev.emit('messages.upsert', { messages });
  assert.equal(m.chats(A)[0].messages.length, 40); assert.equal(m.chats(A)[0].messages[0].text.length, 4000);
  assert.deepEqual(m.chats(B), []);
  made[1].ev.emit('messages.upsert', { messages: [{ key: { remoteJid: 'b@s.whatsapp.net', id: 'b' }, message: { conversation: 'B only' } }] });
  assert.equal(m.chats(B)[0].messages[0].text, 'B only');
  const out = m.chats(A); out[0].messages[0].text = 'changed'; assert.notEqual(m.chats(A)[0].messages[0].text, 'changed');
  assert.deepEqual(await m.unlink(A), { localRemoved: true, remoteRemovalConfirmed: false });
  assert(made[0].loggedOut); assert(made[0].ended); assert.deepEqual(m.chats(A), []); assert.equal(m.status(B).status, 'connected');
  made[0].ev.emit('messages.upsert', { messages }); assert.deepEqual(m.chats(A), []);
  await m.unlink(B);
});

test('capacity, invalid inputs, disconnect, and remote logout failure', async () => {
  const { made, factory } = sockets(); const m = createLinkManager({ socketFactory: factory, capacity: 1 });
  await assert.rejects(m.pair(A, '+15551234567'), /invalid_phone/);
  await assert.rejects(m.pair('invalid', '15551234567'), /invalid_owner/);
  await m.pair(A, '15551234567'); await assert.rejects(m.pair(B, '15551234567'), /capacity/);
  made[0].logout = async () => { throw Error('offline'); };
  assert.deepEqual(await m.unlink(A), { localRemoved: true, remoteRemovalConfirmed: false }); assert.equal(m.status(A).status, 'unlinked');
  await m.pair(B, '15551234567'); made[1].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  assert.equal(m.status(B).status, 'unlinked');
});

test('a failed socket operation removes the pending session', async () => {
  const { factory, made } = sockets();
  const failing = config => { const s = factory(config); s.requestPairingCode = async () => { throw Error('offline'); }; return s; };
  const m = createLinkManager({ socketFactory: failing });
  await assert.rejects(m.pair(A, '15551234567')); assert.equal(m.status(A).status, 'unlinked'); assert(made[0].ended);
});
