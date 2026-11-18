const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.js', 'utf8');
const menu = fs.readFileSync('menu.js', 'utf8');
const extras = fs.readFileSync('extras.js', 'utf8');
function part(s, start, end) { const a=s.indexOf(start), b=s.indexOf(end,a); assert(a>=0 && b>a); return s.slice(a,b); }
async function main() {
  let shown=[], constructed=[], focus=0, notices=[], played=0, muted=false, reg={showNotification:async (...a)=>shown.push(a)};
  function Notification(title, opts) { this.title=title; this.opts=opts; this.close=()=>{}; constructed.push(this); }
  Notification.permission='granted';
  const settings={notif:{messages:true,desktop:true,vibrate:false,updates:true}};
  let ctx=vm.createContext({window:{Notification,focus:()=>focus++,isMuted:()=>muted}, Notification, document:{hidden:true}, me:{id:'me'}, S:()=>settings, getSw:async()=>reg, toast:m=>notices.push(m), messages:[], activeId:'a', profiles:{}, parseCall:()=>false, playReceive:()=>played++,markRead:()=>{},renderList:()=>{},renderMessages:()=>{},updateTitle:()=>{}});
  vm.runInContext(part(app,'function onMessage(m) {','function unreadCount(from)'),ctx);
  const msg={id:'1',sender_id:'a',receiver_id:'me',content:'secret'};
  await ctx.desktopNotify(msg); assert.equal(shown.length,1); assert.equal(shown[0][0],'Rada'); assert.equal(shown[0][1].body,'New message'); assert(!JSON.stringify(shown).includes('secret'));
  Notification.permission='denied'; await ctx.desktopNotify(msg); assert.equal(shown.length,1);
  Notification.permission='default'; await ctx.desktopNotify(msg); assert.equal(shown.length,1);
  Notification.permission='granted'; settings.notif.desktop=false; await ctx.desktopNotify(msg); assert.equal(shown.length,1); settings.notif.desktop=true;
  muted=true; ctx.onMessage({...msg,id:'2'}); assert.equal(played,0); muted=false; ctx.onMessage({...msg,id:'3'}); assert.equal(played,1); await new Promise(r=>setImmediate(r));
  reg=null; await ctx.desktopNotify(msg); assert.equal(constructed.at(-1).title,'Rada'); assert.equal(constructed.at(-1).opts.body,'New message'); constructed.at(-1).onclick(); assert.equal(focus,1); assert.equal(ctx.activeId,'a'); assert(notices.at(-1).includes('draft'));
  let resolve; ctx.getSw=()=>new Promise(r=>resolve=r); reg={showNotification:async (...a)=>shown.push(a)}; let pending=ctx.desktopNotify(msg), count=shown.length; muted=true; resolve(reg); await pending; assert.equal(shown.length,count); muted=false;
  pending=ctx.desktopNotify(msg); Notification.permission='denied'; resolve(reg); await pending; assert.equal(shown.length,count); Notification.permission='granted';
  pending=ctx.desktopNotify(msg); ctx.me={id:'other'}; resolve(reg); await pending; assert.equal(shown.length,count); ctx.me={id:'me'};
  ctx.getSw=async()=>reg;
  vm.runInContext(part(app,'async function notifyCall(c) {','async function closeCallNotif()'),ctx);
  await ctx.notifyCall({peerId:'a',kind:'video'}); assert.equal(shown.at(-1)[0],'Rada'); assert.equal(shown.at(-1)[1].body,'Incoming call'); assert.deepEqual(Array.from(shown.at(-1)[1].vibrate),[]); settings.notif.vibrate=true; await ctx.notifyCall({peerId:'a'}); assert.deepEqual(Array.from(shown.at(-1)[1].vibrate),[500,250,500,250,500]);
  // Execute actual menu tail with controlled timers and interactions.
  function route({search='',active=null,value='',user=true,hasProfile=true}={}) {
    const listeners={}, sw={}, timers=[], opened=[], notices=[], input={value};
    const doc={addEventListener:(k,f)=>listeners[k]=f,removeEventListener:(k)=>delete listeners[k],getElementById:()=>input};
    const c=vm.createContext({navigator:{serviceWorker:{addEventListener:(k,f)=>sw[k]=f}},document:doc,location:{search},URLSearchParams,me:user?{id:'me'}:null,profiles:hasProfile?{b:{}}:{},activeId:active,$:()=>input,toast:x=>notices.push(x),openChat:x=>{opened.push(x); c.activeId=x;},setInterval:f=>(timers.push(f),1),clearInterval:()=>{},setTimeout:()=>2,clearTimeout:()=>{}});
    const tail=part(menu,'  // Never change the recipient in an existing window:', '\n})();'); vm.runInContext(tail,c);
    return {c,sw,listeners,timers,opened,notices,input};
  }
  let r=route({active:'a',value:'draft'}), ack=[]; r.sw.message({data:{type:'open-chat',id:'b'},ports:[{postMessage:x=>ack.push(x)}]}); assert.equal(r.c.activeId,'a'); assert.equal(r.input.value,'draft'); assert.deepEqual(ack,['queued']); assert.equal(r.opened.length,0);
  r.sw.message({data:{type:'open-chat',id:''},ports:[{postMessage:x=>ack.push(x)}]}); assert.equal(ack.length,1);
  r=route({search:'?chat=b'}); r.timers[0](); assert.deepEqual(r.opened,['b']);
  r=route({search:'?chat=b',active:'a',value:'draft'}); r.timers[0](); assert.equal(r.opened.length,0); assert.equal(r.input.value,'draft'); assert.equal(r.c.activeId,'a');
  r=route({search:'?chat=b',value:'draft'}); r.timers[0](); assert.equal(r.opened.length,0);
  r=route({search:'?chat=b',user:false}); r.timers[0](); r.listeners.pointerdown(); r.c.me={id:'me'}; r.timers[0](); assert.equal(r.opened.length,0);
  r=route({search:'?chat=b',hasProfile:false}); r.timers[0](); assert.equal(r.opened.length,0);
  assert(extras.includes("body: 'New app notification'")); assert(extras.includes("showNotification('Rada', o)")); assert(!extras.includes("showNotification(n.title, o)"));
  console.log('PASS: client generic message/call/update alerts; denied/default permission; local mute; async setting/account races; vibration; fallback click; existing-window draft safety; guarded shortcut and readiness.');
  console.log('Limitations: mocked functions only; ordinary manual chat switching still shares drafts, closed-app mute/calls and backend not verified.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
