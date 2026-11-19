import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');

function setup({ enabled=true, host='127.0.0.1' } = {}) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.textContent = ''; this.parentElement = null; }
    append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
    prepend(n) { n.parentElement = this; this.children.unshift(n); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); }
    replaceChildren() { this.children = []; }
    setAttribute() {}
  }
  const menu = new Element('menu'), logout = new Element('button'), body = new Element('body'); menu.append(logout);
  let callback; const calls = [];
  const auth = { onAuthStateChange: cb => { callback = cb; }, getSession: async () => ({ data: { session: { access_token: 'test-token-only' } } }) };
  const document = { getElementById: () => logout, createElement: t => new Element(t), body };
  const fetch = async (url, options) => { calls.push({url,options}); return { ok: true, json: async () => url.endsWith('/pair') ? {code:'ABCDEFGH'} : url.endsWith('/status') ? {status:'connected'} : {chats:[{jid:'test-jid',messages:[{text:'<img onerror=bad>',fromMe:false}]}]} }; };
  const context = { window:{RADA_WA_LAB:enabled}, location:{ protocol:'http:',hostname:host }, sb:{auth}, document, fetch, AbortSignal, setTimeout, clearTimeout };
  vm.runInNewContext(source,context);
  return { menu, body, calls, signout: () => callback('SIGNED_OUT') };
}

test('UI remains disabled by default or outside loopback', () => {
  assert.equal(setup({enabled:false}).menu.children.length, 1);
  assert.equal(setup({host:'example.com'}).menu.children.length, 1);
});

test('UI uses bearer POST, renders text without markup, and clears on sign-out', async () => {
  const env = setup(); const trigger = env.menu.children[0]; trigger.onclick();
  const panel = env.body.children[0]; const input = panel.children[2], pair = panel.children[3], refresh = panel.children[4], message = panel.children[7], output = panel.children[8];
  input.value='15551234567'; await pair.onclick();
  assert.equal(input.value,''); assert.match(message.textContent,/ABCDEFGH/);
  assert.equal(env.calls[0].options.method,'POST'); assert.equal(env.calls[0].options.headers.authorization,'Bearer test-token-only');
  assert.equal(env.calls[0].options.cache,'no-store'); assert(!env.calls[0].url.includes('15551234567'));
  await refresh.onclick(); assert.equal(output.children[1].textContent,'<img onerror=bad>');
  env.signout(); assert.equal(env.body.children.length,0);
});
