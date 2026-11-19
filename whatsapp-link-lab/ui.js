/* Optional local-only staging UI. Intentionally disabled unless configured in a local copy. */
(() => {
  if (window.RADA_WA_LAB !== true || location.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(location.hostname)) return;
  const api = 'http://127.0.0.1:8787';
  const menu = document.getElementById('btn-logout')?.parentElement;
  if (!menu || typeof sb === 'undefined') return;
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.textContent = 'WhatsApp lab (test only)'; menu.prepend(trigger);
  let generation = 0, timer = null, panel = null;
  const clear = () => { generation++; clearTimeout(timer); panel?.remove(); panel = null; };
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_DELETED') clear(); });
  trigger.onclick = () => {
    clear();
    const n = generation;
    panel = document.createElement('section'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'WhatsApp test lab');
    panel.style.cssText = 'position:fixed;inset:8%;z-index:9999;overflow:auto;background:white;color:#111;padding:1rem;border:2px solid #333';
    const title = document.createElement('h2'); title.textContent = 'WhatsApp lab — test accounts only'; panel.append(title);
    const warning = document.createElement('p'); warning.textContent = 'Unofficial linking can restrict an account. No persistence or production protection. Only text received while running is shown. Use a separate staging account.'; panel.append(warning);
    const phone = document.createElement('input'); phone.type = 'tel'; phone.placeholder = 'Country code and digits only'; phone.autocomplete = 'off'; phone.maxLength = 15; panel.append(phone);
    const pair = document.createElement('button'); pair.textContent = 'Request pairing code'; panel.append(pair);
    const refresh = document.createElement('button'); refresh.textContent = 'Refresh chats'; panel.append(refresh);
    const unlink = document.createElement('button'); unlink.textContent = 'Unlink'; panel.append(unlink);
    const close = document.createElement('button'); close.textContent = 'Close'; panel.append(close);
    const message = document.createElement('p'); message.setAttribute('role','status'); panel.append(message);
    const output = document.createElement('div'); panel.append(output); document.body.append(panel);
    async function call(path, body) {
      const { data } = await sb.auth.getSession();
      if (!data.session?.access_token || n !== generation) throw Error('Sign in first');
      const response = await fetch(api + path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + data.session.access_token, ...(body ? { 'content-type':'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error('Lab request failed'); return response.json();
    }
    close.onclick = clear;
    pair.onclick = async () => {
      const digits = phone.value.trim(); phone.value = ''; message.textContent = ''; output.replaceChildren(); pair.disabled = true;
      try {
        if (!/^[1-9][0-9]{7,14}$/.test(digits)) throw Error('Enter country code and digits only.');
        const data = await call('/pair', { phone: digits });
        if (n !== generation) return;
        message.textContent = 'Enter this code in WhatsApp Linked devices: ' + data.code;
        timer = setTimeout(() => { if (n === generation) message.textContent = 'Code cleared. Refresh to check connection.'; }, 120000);
      } catch { if (n === generation) message.textContent = 'Pairing failed. Check the lab setup and number.'; }
      finally { pair.disabled = false; }
    };
    refresh.onclick = async () => {
      message.textContent = ''; output.replaceChildren();
      try {
        const status = await call('/status'); const data = await call('/chats'); if (n !== generation) return;
        message.textContent = 'Status: ' + status.status;
        for (const chat of data.chats) {
          const heading = document.createElement('h3'); heading.textContent = chat.jid; output.append(heading);
          for (const msg of chat.messages) { const p = document.createElement('p'); p.textContent = (msg.fromMe ? 'You: ' : '') + msg.text; output.append(p); }
        }
      } catch { if (n === generation) message.textContent = 'Could not load chats.'; }
    };
    unlink.onclick = async () => {
      message.textContent = ''; output.replaceChildren();
      try { await call('/unlink', {}); if (n === generation) message.textContent = 'Local data cleared; verify and remove this device in WhatsApp Linked devices.'; }
      catch { if (n === generation) message.textContent = 'Unlink failed. Remove this device in WhatsApp.'; }
    };
  };
})();
