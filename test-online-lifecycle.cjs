/* Actual presence subscription/lifecycle code with mocked Realtime channels. */
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
const subscribe = app.slice(app.indexOf('function subscribe()'), app.indexOf('\nfunction onMessage('));
const lifecycle = app.slice(app.indexOf('function resetOnlineAfterInterrupt()'), app.lastIndexOf("\nsetMode('login');"));
const c = vm.createContext({ console, Set });
vm.runInContext(`
let me={id:'me'}, authEpoch=1, profiles={}, messages=[], activeId=null;
let online=new Set(), presenceReady=false, presenceCh=null, realtimeCh=null;
let redraws=0, heads=0, docHandlers={}, winHandlers={};
const document={hidden:false, addEventListener(n,f){docHandlers[n]=f}};
const navigator={onLine:true};
const window={invalidateOnlineUsers(){redraws++}, addEventListener(n,f){winHandlers[n]=f}};
function markLeft(){} function openHeader(){heads++} function saveSeenOnExit(){} function beatSeen(){}
const channels=[]; let removalResult='ok', pendingRemoval=null, removeCalls=0;
const sb={channel(name){
 const ch={name,state:'joined',ids:{},callbacks:{}, on(type,spec,cb){if(type==='presence')this.callbacks.sync=cb;else this.callbacks[spec.table]=cb;return this},
 subscribe(cb){this.callbacks.status=cb;return this}, presenceState(){return this.ids}, async track(){}, untrack(){}};
 channels.push(ch);return ch;
}, removeChannel(ch){removeCalls++; if(removalResult==='pending') return new Promise(resolve=>pendingRemoval=resolve); return Promise.resolve(removalResult)}};
${subscribe}
${lifecycle}
`,c);
const v=s=>vm.runInContext(s,c), flush=()=>new Promise(r=>setImmediate(r));
(async()=>{
 v('subscribe()');
 v("presenceCh.ids={me:[{}],a:[{}]}; presenceCh.callbacks.sync()");
 assert.equal(v('presenceReady'),true); assert.equal(v("online.has('a')"),true);
 v("presenceCh.state='errored'; presenceCh.callbacks.status('CHANNEL_ERROR')");
 assert.equal(v('presenceReady'),false); assert.equal(v('online.size'),0);
 v("presenceCh.state='joined'; presenceCh.callbacks.status('SUBSCRIBED'); presenceCh.ids={b:[{}]}; presenceCh.callbacks.sync()");
 assert.equal(v("online.has('b')"),true);
 v("const before=redraws; realtimeCh.callbacks.blocks({}); realtimeCh.callbacks.profiles({new:{}}); if(redraws!==before+2) throw Error('invalidation')");
 // Foreground forces a new channel: a track ack on the old channel is insufficient.
 v("document.hidden=true; docHandlers.visibilitychange(); const old=presenceCh; document.hidden=false; docHandlers.visibilitychange(); winHandlers.pageshow()");
 assert.equal(v('presenceReady'),false); assert.equal(v('presenceCh'),null);
 await flush(); assert.equal(v('removeCalls'),1); assert.equal(v('presenceCh !== old'),true);
 v("old.callbacks.sync(); old.callbacks.status('CLOSED')"); assert.equal(v('presenceReady'),false);
 v("presenceCh.ids={c:[{}]}; presenceCh.callbacks.sync()"); assert.equal(v("online.has('c')"),true);
 // No sync: stays hidden. Failed unsubscribe cannot reactivate stale channel.
 v("removalResult='timed out'; winHandlers.offline(); winHandlers.online()"); await flush();
 assert.equal(v('presenceCh'),null); assert.equal(v('presenceReady'),false);
 v("old.callbacks.sync()"); assert.equal(v('presenceReady'),false);
 v("removalResult='ok'; winHandlers.online()"); await flush();
 assert.equal(v('presenceReady'),false); v("presenceCh.ids={d:[{}]}; presenceCh.callbacks.sync()"); assert.equal(v("online.has('d')"),true);
 // Delayed old removal must not create a channel in a new (even same-user) session.
 v("removalResult='pending'; winHandlers.online()"); await flush();
 v("authEpoch++; me={id:'me'}; subscribe(); const fresh=presenceCh; pendingRemoval('ok')"); await flush();
 assert.equal(v('presenceCh===fresh'),true);
 console.log('PASS: presence sync, foreground rejoin, coalesced recovery, failed removal, stale callbacks and session switch');
})().catch(e=>{console.error(e); process.exitCode=1});
