'use strict';
// Synthetic client-only tests. These cannot verify RLS or real realtime delivery.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.js', 'utf8');
const extras = fs.readFileSync('extras.js', 'utf8');
function part(start, end) { const a = app.indexOf(start), b = app.indexOf(end, a); assert.ok(a >= 0 && b > a); return app.slice(a, b); }
function ctx(src, values) { const c = vm.createContext(values); vm.runInContext(src, c); return c; }
const load = part('async function loadMessages()', 'async function loadStatuses()');
const sub = part('function subscribe()', '\nfunction onMessage(');
const onMsg = part('function onMessage(', 'function desktopNotify(');
test('query scopes both participants and rejects unrelated returned rows', async () => {
  let filter; const rows = [{ sender_id:'me', receiver_id:'p' }, { sender_id:'q', receiver_id:'me' }, { sender_id:'q', receiver_id:'p' }];
  const chain = { select() { return this; }, or(v) { filter=v; return this; }, order() { return this; }, limit() { return Promise.resolve({data:rows}); } };
  const c=ctx(load, {me:{id:'me'}, messages:[], sb:{from:()=>chain}, console}); await c.loadMessages();
  assert.equal(filter,'sender_id.eq.me,receiver_id.eq.me'); assert.equal(c.messages.length,2);
});
test('late query cannot overwrite a different session', async () => {
  let finish; const chain={select(){return this},or(){return this},order(){return this},limit(){return new Promise(r=>finish=r)}};
  const c=ctx(load,{me:{id:'me'},messages:[],sb:{from:()=>chain},console}); const pending=c.loadMessages(); c.me={id:'new'}; finish({data:[{sender_id:'me'}]}); await pending; assert.equal(c.messages.length,0);
});
test('inserts ignore unrelated events and deduplicate', () => {
  const c=ctx(onMsg,{me:{id:'me'},messages:[],activeId:null,renderList(){},updateTitle(){},renderMessages(){},parseCall:()=>false,document:{hidden:true},S:()=>({notif:{messages:false}})});
  c.onMessage({id:1,sender_id:'x',receiver_id:'y'}); c.onMessage({id:2,sender_id:'x',receiver_id:'me'}); c.onMessage({id:2,sender_id:'x',receiver_id:'me'}); assert.equal(c.messages.length,1);
});
test('subscriptions scope both directions and reject unrelated and stale updates', () => {
  const handlers=[]; const channel={on(kind,filter,fn){handlers.push({filter,fn});return this},subscribe(){return this}};
  const calls=[]; const c=ctx(sub,{me:{id:'me'},messages:[{id:1,sender_id:'me',receiver_id:'peer'}],realtimeCh:null,presenceCh:null,sb:{channel:()=>channel},renderList(){},renderMessages(){},activeId:null,onMessage(m){calls.push(m)}});
  c.subscribe(); const ms=handlers.filter(h=>h.filter.table==='messages'); assert.equal(ms.length,4);
  assert.deepEqual(ms.map(h=>h.filter.filter).sort(),['receiver_id=eq.me','receiver_id=eq.me','sender_id=eq.me','sender_id=eq.me']);
  const update=ms.find(h=>h.filter.event==='UPDATE').fn, insert=ms.find(h=>h.filter.event==='INSERT').fn;
  update({new:{id:1,sender_id:'x',receiver_id:'y'}}); assert.equal(c.messages[0].sender_id,'me');
  update({new:{id:1,sender_id:'me',receiver_id:'peer',read:true}}); assert.equal(c.messages[0].read,true);
  c.me={id:'new'}; update({new:{id:1,sender_id:'me',receiver_id:'peer',read:false}}); insert({new:{id:3}}); assert.equal(c.messages[0].read,true); assert.equal(calls.length,0);
});
test('settings describe limitations without false receipt promise', () => {
  assert.match(extras,/Chat file links may be public/); assert.match(extras,/does not stop the app sending read updates/);
  assert.doesNotMatch(extras,/If off, you will not send or see blue ticks/);
});
