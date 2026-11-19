import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from './http.mjs';
const ORIGIN='http://127.0.0.1:8000';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('bearer verification, owner scoping, origin, no-store, and strict input', async t => {
  const seen = [];
  const manager = {
    status: owner => ({ status: owner === A ? 'connected' : 'unlinked' }),
    chats: owner => owner === A ? [{ jid: 'test', messages: [] }] : [],
    pair: async (owner, phone) => { seen.push([owner,phone]); return 'ABCDEFGH'; },
    unlink: async owner => { seen.push([owner,'unlink']); return { localRemoved: true, remoteRemovalConfirmed: false }; }
  };
  const verify = async token => token === 'aaaaaaaaaaaa' ? A : token === 'bbbbbbbbbbbb' ? B : null;
  const server = makeServer({ origin: ORIGIN, verify, manager });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { token='aaaaaaaaaaaa', origin=ORIGIN, method='GET', body } = {}) {
    return fetch(url+path, { method, headers: { origin, authorization: 'Bearer ' + token, ...(body !== undefined ? { 'content-type':'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  let r=await request('/chats'); assert.equal(r.status,200); assert.match(r.headers.get('cache-control'),/no-store/); assert.equal((await r.json()).chats.length,1);
  r=await request('/chats',{token:'bbbbbbbbbbbb'}); assert.deepEqual((await r.json()).chats,[]);
  r=await request('/chats',{token:'forged-token'}); assert.equal(r.status,401);
  r=await request('/chats',{origin:'https://evil.example'}); assert.equal(r.status,403); assert.equal(r.headers.get('access-control-allow-origin'),null);
  r=await request('/pair',{method:'POST',body:{phone:'15551234567',owner:B}}); assert.equal(r.status,400); assert.deepEqual(seen,[]);
  r=await request('/pair?owner=abc',{method:'POST',body:{phone:'15551234567'}}); assert.equal(r.status,404);
  r=await request('/pair',{method:'POST',body:{phone:'+15551234567'}}); assert.equal(r.status,400);
  r=await request('/pair',{method:'POST',body:{phone:'15551234567'}}); assert.equal(r.status,200); assert.equal((await r.json()).code,'ABCDEFGH'); assert.deepEqual(seen[0],[A,'15551234567']);
  r=await request('/unlink',{method:'POST',token:'bbbbbbbbbbbb',body:{}}); assert.equal(r.status,200); assert.deepEqual(seen[1],[B,'unlink']);
});

test('authentication failures and oversize input fail closed', async t => {
  const server = makeServer({ origin: ORIGIN, verify: async token => token === 'aaaaaaaaaaaa' ? A : null, manager: { pair: async () => { throw Error('should not be called'); } } });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={origin:ORIGIN,authorization:'Bearer aaaaaaaaaaaa','content-type':'application/json'};
  let r=await fetch(base+'/pair',{method:'POST',headers,body:JSON.stringify({phone:'1'.repeat(1200)})}); assert.equal(r.status,413);
  r=await fetch(base+'/status',{headers:{origin:ORIGIN}}); assert.equal(r.status,401);
});
