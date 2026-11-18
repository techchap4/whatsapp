/* ============================================================
   Rada features.js  (load AFTER menu.js, BEFORE pwa.js)
   1. Forgot password (email code, or email link)
   2. Live "typing…" indicator (1:1 chats and groups)
   3. Private groups (create, chat, add/remove members, leave, delete)
   4. Block + Report wired into the ⋮ menu
   5. Document sharing (pdf, word, excel, powerpoint, txt, zip ...)
   Needs features.sql and document-sharing.sql to have been run in Supabase.
   ============================================================ */
(() => {
  const $ = (id) => document.getElementById(id);
  const myId = () => (typeof me !== 'undefined' && me ? me.id : null);
  const pname = (id) => (profiles[id] ? nameOf(profiles[id]) : 'Member');
  const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  /* ---------------- documents ---------------- */
  const DOC_EXT = ['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','txt','csv','rtf','json','zip','rar','7z','epub','md'];
  const DOC_ACCEPT = 'image/*,video/*,audio/*,' + DOC_EXT.map((e) => '.' + e).join(',');
  const extOf = (n) => (String(n).split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isMedia = (f) => /^(image|video|audio)\//.test(f.type);
  const isDoc = (f) => !isMedia(f) && DOC_EXT.includes(extOf(f.name));
  const fmtSize = (b) => !b ? '' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  const docIcon = (n) => ({ pdf:'📕', doc:'📘', docx:'📘', odt:'📘', xls:'📗', xlsx:'📗', csv:'📗', ods:'📗', ppt:'📙', pptx:'📙', odp:'📙', zip:'🗜', rar:'🗜', '7z':'🗜', txt:'📄', md:'📄', json:'📄', rtf:'📄', epub:'📚' }[extOf(n)] || '📎');
  const DOC_BUCKET = 'chat-files', DOC_MAX = 25 * 1024 * 1024;

  const docCss = document.createElement('style');
  docCss.textContent = `
  .gm-doc{display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:4px;border-radius:8px;background:rgba(0,0,0,.06);color:inherit;text-decoration:none;min-width:200px;max-width:100%}
  .gm-doc-ic{font-size:30px;line-height:1}
  .gm-doc-t{flex:1;min-width:0}.gm-doc-t b{display:block;font-size:14px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:inherit!important}
  .gm-doc-t small{display:block;text-align:left;font-size:11.5px;opacity:.7;margin:0}
  .gm-doc-dl{font-size:18px;opacity:.7}
  .doc-row{display:flex;align-items:center;gap:10px;padding:8px 16px;text-decoration:none;color:inherit}`;
  document.head.appendChild(docCss);

  async function uploadDoc(file) {
    if (file.size > DOC_MAX) throw new Error(file.name + ' is bigger than 25 MB.');
    const path = `${myId()}/docs/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extOf(file.name) || 'bin'}`;
    const up = await sb.storage.from(DOC_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (up.error) throw up.error;
    return sb.storage.from(DOC_BUCKET).getPublicUrl(path).data.publicUrl;
  }
  const docCard = (url, name, size) => `<a class="gm-doc" href="${esc(url)}" target="_blank" rel="noopener" download="${esc(name || 'file')}">
    <span class="gm-doc-ic">${docIcon(name)}</span><span class="gm-doc-t"><b>${esc(name || 'Document')}</b><small>${esc(extOf(name).toUpperCase())}${size ? ' · ' + fmtSize(size) : ''}</small></span><span class="gm-doc-dl">⬇</span></a>`;
  window.radaDocCard = (m) => docCard(m.media_url, m.media_name, m.media_size);   // for app.js (1:1 chats)

  /* ---------------- styles ---------------- */
  const css = document.createElement('style');
  css.textContent = `
  .g-link{background:none;border:0;color:#e66ca5;font:inherit;font-weight:600;cursor:pointer;margin:10px auto 0;display:block;padding:6px}
  #recovery{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
  #recovery .auth-card{max-width:380px;width:100%}
  #toast{z-index:400}
  #modal-ginfo,#modal-gpick,#modal-report{z-index:150}
  .g-av{background:#e66ca5!important;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;border-radius:50%}
  .g-av.big{width:84px;height:84px;font-size:40px;margin:0 auto 8px}
  .g-typing{color:#1da851!important;font-style:italic}
  #gv{position:fixed;inset:0;z-index:45;display:flex;flex-direction:column;background:#efeae2;color:#111}
  #gv.hidden{display:none}
  #gv>header{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 8px) 8px 8px;background:#e66ca5;color:#fff}
  #gv>header button{background:none;border:0;color:#fff;font-size:22px;padding:6px 10px;cursor:pointer}
  #gv .gv-info{flex:1;min-width:0;cursor:pointer}
  #gv .gv-info .name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #gv .gv-info .sub{font-size:12.5px;opacity:.92;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #gv-msgs{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:4px}
  .gm{max-width:80%;padding:6px 9px 4px;border-radius:10px;background:#fff;align-self:flex-start;box-shadow:0 1px 1px rgba(0,0,0,.12);font-size:var(--msg-fs,15px)}
  .gm.me{align-self:flex-end;background:#ffe3f0}
  .gm b{display:block;font-size:12.5px;margin-bottom:1px}
  .gm .gm-t{white-space:pre-wrap;word-break:break-word}
  .gm small{display:block;text-align:right;font-size:10.5px;opacity:.6;margin-top:2px}
  .gm-day{align-self:center;background:rgba(0,0,0,.08);border-radius:8px;padding:2px 10px;font-size:12px;margin:8px 0}
  #gv-form{display:flex;align-items:flex-end;gap:8px;padding:8px 8px calc(env(safe-area-inset-bottom,0px) + 8px);background:rgba(255,255,255,.6)}
  #gv-input{flex:1;resize:none;border:0;border-radius:22px;padding:11px 15px;font:inherit;max-height:120px;background:#fff;color:#111;outline:none}
  #gv-send{width:46px;height:46px;border:0;border-radius:50%;background:#e66ca5;color:#fff;font-size:18px;cursor:pointer}
  .gi-head{text-align:center;padding:14px 16px}
  .gi-head h2{margin:4px 0 0}
  .gi-act{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px 70px}
  .g-adm{color:#1da851;font-size:11px;margin-left:6px}
  .gp-list{max-height:45vh;overflow-y:auto}
  .gp-row{display:flex;align-items:center;gap:12px;padding:8px 16px;cursor:pointer}
  .gp-row input{width:20px;height:20px}
  @media (prefers-color-scheme:dark){
    #gv{background:#0b141a;color:#e9edef}
    .gm{background:#202c33;color:#e9edef}.gm.me{background:#6b2a4a}
    #gv-form{background:rgba(17,27,33,.8)}#gv-input{background:#2a3942;color:#e9edef}
  }`;
  document.head.appendChild(css);

  /* ============================================================
     1. FORGOT PASSWORD
     ============================================================ */
  let inCodeReset = false;

  function initReset() {
    if (!$('auth-form')) return;
    if (!$('reset-form')) {   // fallback only: index.html already contains this markup
    const link = document.createElement('button');
    link.id = 'forgot-link'; link.type = 'button'; link.className = 'g-link'; link.textContent = 'Forgot password?';
    $('auth-form').after(link);

    const f = document.createElement('form');
    f.id = 'reset-form'; f.style.display = 'none'; f.autocomplete = 'off';
    f.innerHTML = `
      <p class="otp-help" id="rs-help">Enter your account email and we will send you a code to reset your password.</p>
      <label>Email<input id="rs-email" type="email" required placeholder="you@example.com" autocomplete="email"></label>
      <div id="rs-step2" style="display:none">
        <label>Code from the email<input id="rs-code" type="text" inputmode="numeric" maxlength="10" autocomplete="one-time-code" placeholder="00000000"></label>
        <label>New password<input id="rs-pw" type="password" minlength="6" placeholder="At least 6 characters" autocomplete="new-password"></label>
        <label>Confirm new password<input id="rs-pw2" type="password" placeholder="Type it again" autocomplete="new-password"></label>
      </div>
      <p id="rs-msg" class="auth-msg"></p>
      <button id="rs-go" class="primary" type="submit">Send code</button>
      <div class="otp-links"><button id="rs-resend" type="button" style="display:none">Resend code</button><button id="rs-back" type="button">Back to log in</button></div>`;
    link.after(f);
    }
    const link = $('forgot-link'), f = $('reset-form');

    const hideOnReset = ['auth-form', 'auth-tabs', 'install-auth', 'forgot-link'];
    const msg = (t, ok) => { const m = $('rs-msg'); m.textContent = t || ''; m.classList.toggle('ok', !!ok); };
    let step = 1;

    const syncLink = () => {
      const login = $('signup-fields').classList.contains('hidden');
      const otp = $('otp-form') && !$('otp-form').classList.contains('hidden');
      link.style.display = login && !otp && f.style.display === 'none' ? '' : 'none';
    };
    new MutationObserver(syncLink).observe($('signup-fields'), { attributes: true, attributeFilter: ['class'] });
    if ($('otp-form')) new MutationObserver(syncLink).observe($('otp-form'), { attributes: true, attributeFilter: ['class'] });
    syncLink();

    function open() {
      step = 1; msg('');
      $('rs-email').value = ($('f-email') && $('f-email').value) || '';
      $('rs-step2').style.display = 'none'; $('rs-resend').style.display = 'none';
      $('rs-go').textContent = 'Send code'; $('rs-email').readOnly = false;
      $('rs-help').textContent = 'Enter your account email and we will send you a code to reset your password.';
      hideOnReset.forEach((id) => { const e = $(id); if (e) e.style.display = 'none'; });
      f.style.display = '';
    }
    function close() {
      f.style.display = 'none';
      hideOnReset.forEach((id) => { const e = $(id); if (e) e.style.display = ''; });
      syncLink();
    }
    link.onclick = open;
    $('rs-back').onclick = close;

    async function sendCode() {
      const email = $('rs-email').value.trim();
      if (!email) return msg('Enter your email.');
      const btn = $('rs-go'); btn.disabled = true; msg('Sending…');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      btn.disabled = false;
      if (error) return msg(error.message);
      step = 2;
      $('rs-step2').style.display = ''; $('rs-resend').style.display = ''; $('rs-email').readOnly = true;
      $('rs-help').innerHTML = 'If an account exists for <b></b>, we sent a code. Enter it below with your new password.';
      $('rs-help').querySelector('b').textContent = email;
      btn.textContent = 'Reset password'; msg('Code sent. Check your inbox (and spam).', true);
      $('rs-code').focus();
    }
    $('rs-resend').onclick = sendCode;

    f.onsubmit = async (e) => {
      e.preventDefault();
      if (step === 1) return sendCode();
      const email = $('rs-email').value.trim(), code = $('rs-code').value.trim(), pw = $('rs-pw').value, pw2 = $('rs-pw2').value;
      if (!code) return msg('Enter the code from the email.');
      if (pw.length < 6) return msg('Password must be at least 6 characters.');
      if (pw !== pw2) return msg('Passwords do not match.');
      const btn = $('rs-go'); btn.disabled = true; msg('Checking code…');
      inCodeReset = true;
      try {
        const v = await sb.auth.verifyOtp({ email, token: code, type: 'recovery' });
        if (v.error) throw v.error;
        const u = await sb.auth.updateUser({ password: pw });
        if (u.error) throw u.error;
        msg('Password changed. Signing you in…', true);
        if (typeof toast === 'function') toast('Password changed');
      } catch (err) {
        msg(/expired|invalid/i.test(err.message) ? 'That code is wrong or has expired. Request a new one.' : err.message);
      } finally { btn.disabled = false; setTimeout(() => { inCodeReset = false; }, 3000); }
    };
  }

  /* if the person opens the reset LINK instead, show a "new password" box */
  function showRecovery() {
    if ($('recovery')) return;
    const o = document.createElement('div'); o.id = 'recovery';
    o.innerHTML = `<form class="auth-card" autocomplete="off"><h1>New password</h1>
      <label>New password<input id="rc-pw" type="password" minlength="6" required autocomplete="new-password"></label>
      <label>Confirm password<input id="rc-pw2" type="password" required autocomplete="new-password"></label>
      <p id="rc-msg" class="auth-msg"></p><button class="primary" type="submit">Save password</button></form>`;
    document.body.appendChild(o);
    o.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const a = $('rc-pw').value, b = $('rc-pw2').value, m = $('rc-msg');
      if (a.length < 6) { m.textContent = 'At least 6 characters.'; return; }
      if (a !== b) { m.textContent = 'Passwords do not match.'; return; }
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) { m.textContent = error.message; return; }
      o.remove(); history.replaceState(null, '', location.pathname); toast('Password changed');
    };
  }
  sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY' && !inCodeReset) showRecovery(); });
  initReset();

  /* ============================================================
     2. LIVE TYPING
     ============================================================ */
  const tCh = {};                 // topic -> realtime channel
  const typingUntil = {};         // key -> expiry ms   (key = userId  or  g:groupId:userId)
  let lastSig = '', lastSent = 0;

  function chan(topic, listen) {
    if (tCh[topic]) return tCh[topic];
    const ch = sb.channel(topic, { config: { broadcast: { self: false } } });
    if (listen) ch.on('broadcast', { event: 'typing' }, ({ payload }) => onTyping(payload));
    ch.subscribe(); tCh[topic] = ch; return ch;
  }
  function dropChan(topic) { if (tCh[topic]) { try { sb.removeChannel(tCh[topic]); } catch (e) {} delete tCh[topic]; } }
  function onTyping(p) {
    if (!p || !p.from || p.from === myId() || isBlocked(p.from)) return;
    const key = p.group ? `g:${p.group}:${p.from}` : p.from;
    if (p.stop) delete typingUntil[key]; else typingUntil[key] = Date.now() + 4500;
    typingTick();
  }
  function sendTyping(stopFlag) {
    const id = myId(); if (!id) return;
    const now = Date.now();
    if (!stopFlag && now - lastSent < 2500) return;
    lastSent = stopFlag ? 0 : now;
    if (openG) {
      chan('grp:' + openG, true).send({ type: 'broadcast', event: 'typing', payload: { from: id, group: openG, stop: !!stopFlag } });
    } else if (activeId && !isBlocked(activeId) && !$('conv').classList.contains('hidden')) {
      chan('typing-in:' + activeId, false).send({ type: 'broadcast', event: 'typing', payload: { from: id, stop: !!stopFlag } });
    }
  }
  const isTyping = (id) => (typingUntil[id] || 0) > Date.now();
  const groupTypers = (gid) => Object.keys(typingUntil).filter((k) => k.startsWith(`g:${gid}:`) && typingUntil[k] > Date.now()).map((k) => k.split(':')[2]);

  function typingTick() {
    const now = Date.now();
    Object.keys(typingUntil).forEach((k) => { if (typingUntil[k] <= now) delete typingUntil[k]; });
    // a new incoming message means they stopped typing
    const lm = messages && messages[messages.length - 1];
    if (lm && lm.id !== typingTick.lm) { typingTick.lm = lm.id; if (lm.sender_id !== myId()) delete typingUntil[lm.sender_id]; }
    const sig = Object.keys(typingUntil).sort().join('|');
    if (sig !== lastSig) {
      lastSig = sig;
      try { renderList(); } catch (e) {}
      try { if (activeId) openHeader(); } catch (e) {}
      updateGvSub();
    } else applyTypingHeader();
  }
  function applyTypingHeader() {
    const sub = $('conv-sub'); if (!sub || !activeId) return;
    const t = isTyping(activeId) && !isBlocked(activeId);
    sub.classList.toggle('g-typing', t);
    if (t && sub.textContent !== 'typing…') sub.textContent = 'typing…';
  }
  function applyTypingList() {
    document.querySelectorAll('#chat-list .item[data-id]').forEach((it) => {
      if (!isTyping(it.dataset.id) || isBlocked(it.dataset.id)) return;
      const pv = it.querySelector('.preview'); if (pv) { pv.textContent = 'typing…'; pv.classList.add('g-typing'); }
    });
  }
  const _openHeader = window.openHeader;
  window.openHeader = function () { _openHeader.apply(this, arguments); try { applyTypingHeader(); } catch (e) {} };

  const mi = $('msg-input');
  if (mi) {
    mi.addEventListener('input', () => { if (mi.value.trim()) sendTyping(false); else sendTyping(true); });
    mi.addEventListener('blur', () => sendTyping(true));
  }
  if ($('composer')) $('composer').addEventListener('submit', () => sendTyping(true), true);

  /* ============================================================
     3. PRIVATE GROUPS  (info, media, invite link, permissions, admins, picture)
     ============================================================ */
  let groups = [], gmsgs = {}, gCh = null, openG = null, cur = null, reloadT = null, giView = 'main', giMedia = null;
  const GF = 'group-files';
  const readKey = () => 'rada-gread:' + myId();
  const lastRead = () => lsGet(readKey(), {});
  const markRead = (gid) => { const r = lastRead(); r[gid] = Date.now(); lsSet(readKey(), r); };
  const getG = (id) => groups.find((g) => g.id === id);
  const isAdmin = (g) => !!g && g.members.some((m) => m.user_id === myId() && m.role === 'admin');
  const canSend = (g) => !!g && (g.send_messages !== 'admins' || isAdmin(g));
  const canAdd = (g) => !!g && (g.add_members !== 'admins' || isAdmin(g));
  const canInvite = (g) => !!g && (g.invite_by !== 'admins' || isAdmin(g));
  const canEdit = (g) => !!g && (g.edit_info !== 'admins' || isAdmin(g));
  const colorFor = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 55% 38%)`; };
  const gAv = (g, cls = '') => `<div class="avatar g-av ${cls}">${g && g.avatar_url ? `<img src="${esc(g.avatar_url)}" alt="">` : '👥'}</div>`;
  const msgPreview = (m) => (m.media_url
    ? (m.media_type === 'file' ? '📄 ' + (m.media_name || 'Document') : { image: '📷 Photo', video: '🎥 Video', audio: '🎵 Audio' }[m.media_type] || '📎 File')
    : m.content);

  const gcss = document.createElement('style');
  gcss.textContent = `
  .g-av{overflow:hidden}.g-av img{width:100%;height:100%;object-fit:cover}
  .gm-img{display:block;max-width:100%;max-height:280px;border-radius:8px;margin-bottom:4px}
  .gm audio{max-width:100%}
  #gv-lock{padding:14px;text-align:center;font-size:13.5px;opacity:.75;background:rgba(255,255,255,.6)}
  #gv-attach{width:40px;height:46px;display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer}
  .gi-av{cursor:pointer}.gi-av small{display:block;font-size:12px;opacity:.7}
  .gi-desc{margin:6px 16px;font-size:14px;opacity:.85;white-space:pre-wrap}
  .gi-quick{display:flex;gap:8px;justify-content:center;padding:6px 12px 12px}
  .gi-q{flex:1;max-width:120px;border:1px solid rgba(128,128,128,.35);background:none;color:inherit;border-radius:12px;padding:10px 4px;font:inherit;font-size:13px;cursor:pointer}
  .gi-q span{display:block;font-size:20px;margin-bottom:2px}
  .gi-note{margin:4px 16px 10px;font-size:12.5px;opacity:.7}
  .gi-req{display:flex;align-items:center;gap:8px;padding:6px 16px}.gi-req .who{flex:1}
  @media (prefers-color-scheme:dark){#gv-lock{background:rgba(17,27,33,.8)}}`;
  document.head.appendChild(gcss);

  async function fetchProfiles(ids) {
    const miss = ids.filter((i) => i && !profiles[i]);
    if (!miss.length) return;
    const { data } = await sb.from('profiles').select('*').in('id', miss);
    (data || []).forEach((p) => { profiles[p.id] = p; });
  }
  function addMsg(m) {
    const arr = gmsgs[m.group_id] || (gmsgs[m.group_id] = []);
    if (arr.some((x) => x.id === m.id)) return false;
    arr.push(m); arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return true;
  }
  const lastMsg = (g) => { const a = gmsgs[g.id]; return a && a[a.length - 1]; };
  const unreadOf = (g) => {
    const t = lastRead()[g.id] || 0;
    return (gmsgs[g.id] || []).filter((m) => m.sender_id !== myId() && !isBlocked(m.sender_id) && new Date(m.created_at).getTime() > t).length;
  };
  function shrink(file, max, q = 0.85) {
    return new Promise((res) => {
      if (!file.type.startsWith('image/') || file.type === 'image/gif') return res(file);
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        c.toBlob((b) => res(b || file), 'image/jpeg', q);
      };
      img.onerror = () => { URL.revokeObjectURL(u); res(file); };
      img.src = u;
    });
  }
  async function uploadTo(path, blob) {
    const up = await sb.storage.from(GF).upload(path, blob, { contentType: blob.type || 'application/octet-stream' });
    if (up.error) throw up.error;
    return sb.storage.from(GF).getPublicUrl(path).data.publicUrl;
  }
  function pickFile(accept, cb) {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = () => { if (i.files[0]) cb(i.files[0]); }; i.click();
  }

  async function loadGroups() {
    if (!cur) return;
    const { data: mine, error } = await sb.from('rada_group_members').select('group_id, role, rada_groups(*)').eq('user_id', myId());
    if (error) { console.warn('groups:', error.message); return; }
    const rows = (mine || []).filter((r) => r.rada_groups);
    const ids = rows.map((r) => r.group_id), adminIds = rows.filter((r) => r.role === 'admin').map((r) => r.group_id);
    let members = [], last = [], reqs = [];
    if (ids.length) {
      const [a, b, c] = await Promise.all([
        sb.from('rada_group_members').select('group_id,user_id,role').in('group_id', ids),
        sb.from('rada_group_messages').select('*').in('group_id', ids).order('created_at', { ascending: false }).limit(300),
        adminIds.length ? sb.from('rada_group_requests').select('*').in('group_id', adminIds) : Promise.resolve({ data: [] }),
      ]);
      members = a.data || []; last = b.data || []; reqs = c.data || [];
    }
    await fetchProfiles([...new Set(members.map((x) => x.user_id).concat(last.map((x) => x.sender_id), reqs.map((x) => x.user_id)))]);
    last.forEach(addMsg);
    groups = rows.map((r) => ({ ...r.rada_groups, members: members.filter((x) => x.group_id === r.group_id), requests: reqs.filter((x) => x.group_id === r.group_id) }));
    groups.sort((a, b) => new Date((lastMsg(b) || b).created_at) - new Date((lastMsg(a) || a).created_at));
    if (openG && !getG(openG)) { closeGroup(true); const m = $('modal-ginfo'); if (m) m.classList.add('hidden'); }
    renderList();
    if (openG) { refreshGvHeader(); const m = $('modal-ginfo'); if (m && !m.classList.contains('hidden')) renderInfo(); }
  }
  const reloadSoon = () => { clearTimeout(reloadT); reloadT = setTimeout(loadGroups, 300); };

  function onGroupMsg(m) {
    if (!getG(m.group_id)) return reloadSoon();
    fetchProfiles([m.sender_id]).then(() => {
      if (!addMsg(m)) return;
      delete typingUntil[`g:${m.group_id}:${m.sender_id}`];
      if (openG === m.group_id) { renderGV(m.sender_id === myId()); markRead(openG); }
      else if (m.sender_id !== myId() && !isBlocked(m.sender_id) && typeof playReceive === 'function') { try { playReceive(); } catch (e) {} }
      renderList();
    });
  }

  /* ---- chat list rows ---- */
  function injectGroups() {
    const list = $('chat-list'); if (!list) return;
    list.querySelectorAll('.item[data-gid]').forEach((e) => e.remove());
    const chipEl = document.querySelector('#chips .active'), chip = chipEl ? chipEl.dataset.chip : 'all';
    if (!['all', 'groups', 'unread'].includes(chip)) return;
    const q = (($('search') && $('search').value) || '').trim().toLowerCase();
    let gs = groups.filter((g) => !q || g.name.toLowerCase().includes(q));
    if (chip === 'unread') gs = gs.filter((g) => unreadOf(g) > 0);
    if (!gs.length) return;
    const note = $('chip-note'); if (note) note.remove();
    const frag = document.createDocumentFragment();
    gs.forEach((g) => {
      const l = lastMsg(g), n = unreadOf(g), typers = groupTypers(g.id);
      const pv = typers.length ? `${esc(pname(typers[0]))} is typing…` : l ? `${l.sender_id === myId() ? 'You' : esc(pname(l.sender_id))}: ${esc(msgPreview(l).slice(0, 60))}` : 'Tap to chat';
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'item'; b.dataset.gid = g.id;
      b.innerHTML = `${gAv(g)}<div class="body"><div class="top"><span class="name">${esc(g.name)}</span><span class="time">${l ? listTime(l.created_at) : ''}</span></div>
        <div class="bottom"><span class="preview ${typers.length ? 'g-typing' : ''}">${pv}</span>${n ? `<span class="badge">${n}</span>` : ''}</div></div>`;
      frag.appendChild(b);
    });
    list.prepend(frag);
  }
  const _renderList = window.renderList;
  window.renderList = function () {
    _renderList.apply(this, arguments);
    try { if (cur) { injectGroups(); applyTypingList(); } } catch (e) { console.warn(e); }
  };
  if ($('chat-list')) $('chat-list').addEventListener('click', (e) => {
    const it = e.target.closest('[data-gid]'); if (!it) return;
    stop(e); openGroup(it.dataset.gid);
  }, true);

  /* ---- group chat screen ---- */
  function buildGV() {
    if ($('gv')) return;
    const d = document.createElement('div'); d.id = 'gv'; d.className = 'hidden';
    d.innerHTML = `<header><button id="gv-back" type="button" aria-label="Back">←</button><span id="gv-av"></span>
      <div class="gv-info" id="gv-info"><div class="name" id="gv-name"></div><div class="sub" id="gv-sub"></div></div>
      <button id="gv-menu" type="button" aria-label="Group info">⋮</button></header>
      <div id="gv-msgs"></div>
      <div id="gv-lock" class="hidden">Only admins can send messages in this group.</div>
      <form id="gv-form"><label id="gv-attach" title="Photo, video, audio or document">📎<input id="gv-file" type="file" accept="${DOC_ACCEPT}" multiple hidden></label>
        <textarea id="gv-input" rows="1" maxlength="2000" placeholder="Message"></textarea><button id="gv-send" type="submit" aria-label="Send">➤</button></form>`;
    document.body.appendChild(d);
    $('gv-back').onclick = () => closeGroup();
    $('gv-info').onclick = $('gv-menu').onclick = () => { giView = 'main'; openGroupInfo(); };
    const inp = $('gv-input');
    inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 120) + 'px'; inp.value.trim() ? sendTyping(false) : sendTyping(true); });
    inp.addEventListener('keydown', (e) => {
      let es = true; try { es = S().chats.enterSend; } catch (x) {}
      if (e.key === 'Enter' && !e.shiftKey && es && matchMedia('(pointer:fine)').matches) { e.preventDefault(); $('gv-form').requestSubmit(); }
    });
    const send = async (row) => {
      const { data, error } = await sb.from('rada_group_messages').insert({ group_id: openG, sender_id: myId(), ...row }).select().single();
      if (error) { toast(/row-level|policy/i.test(error.message) ? 'Only admins can send messages in this group.' : error.message); return false; }
      addMsg(data); renderGV(true); markRead(openG); renderList(); return true;
    };
    $('gv-form').onsubmit = async (e) => {
      e.preventDefault();
      const t = inp.value.trim(); if (!t || !openG) return;
      inp.value = ''; inp.style.height = 'auto'; sendTyping(true);
      if (!(await send({ content: t }))) inp.value = t;
    };
    $('gv-file').onchange = async (e) => {
      const files = [...e.target.files]; e.target.value = ''; const gid = openG;
      for (const f of files) {
        const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : isDoc(f) ? 'file' : null;
        if (!kind) { toast(f.name + ': this file type is not supported.'); continue; }
        if (f.size > DOC_MAX) { toast(f.name + ' is bigger than 25 MB.'); continue; }
        toast('Sending ' + (kind === 'file' ? 'document' : kind) + '…');
        try {
          let url, blob = f;
          if (kind === 'file') url = await uploadDoc(f);
          else {
            blob = kind === 'image' ? await shrink(f, 1600) : f;
            const ext = (blob.type === 'image/jpeg' ? 'jpg' : extOf(f.name) || 'bin');
            url = await uploadTo(`${gid}/media/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`, blob);
          }
          if (openG === gid) await send({ content: '', media_url: url, media_type: kind, media_name: f.name.slice(0, 120), media_size: f.size, media_mime: f.type || null });
        } catch (err) { toast(err.message); }
      }
    };
  }
  function renderGV(stick) {
    const box = $('gv-msgs'); if (!box || !openG) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    const list = (gmsgs[openG] || []).filter((m) => m.sender_id === myId() || !isBlocked(m.sender_id));
    let day = '', h = '';
    list.forEach((m) => {
      const d = fmtDate(m.created_at); if (d !== day) { day = d; h += `<div class="gm-day">${esc(d)}</div>`; }
      const mine = m.sender_id === myId(), u = esc(m.media_url || '');
      const media = !m.media_url ? '' : m.media_type === 'file' ? docCard(m.media_url, m.media_name, m.media_size)
        : m.media_type === 'image' ? `<a href="${u}" target="_blank" rel="noopener"><img class="gm-img" src="${u}" loading="lazy" alt=""></a>`
        : m.media_type === 'video' ? `<video class="gm-img" src="${u}" controls preload="metadata"></video>` : `<audio src="${u}" controls preload="none"></audio>`;
      h += `<div class="gm ${mine ? 'me' : 'in'}">${mine ? '' : `<b style="color:${colorFor(m.sender_id)}">${esc(pname(m.sender_id))}</b>`}${media}${m.content ? `<span class="gm-t">${esc(m.content)}</span>` : ''}<small>${timeStr(m.created_at)}</small></div>`;
    });
    box.innerHTML = h || '<div class="empty-note">No messages yet. Say hi 👋</div>';
    if (stick || near) box.scrollTop = box.scrollHeight;
  }
  function updateGvSub() {
    const g = getG(openG), sub = $('gv-sub'); if (!g || !sub) return;
    const t = groupTypers(g.id);
    sub.classList.toggle('g-typing', !!t.length);
    sub.textContent = t.length ? (t.length === 1 ? `${pname(t[0])} is typing…` : `${t.slice(0, 2).map(pname).join(', ')} are typing…`)
      : g.members.map((m) => (m.user_id === myId() ? 'You' : pname(m.user_id))).join(', ');
  }
  function refreshGvHeader() {
    const g = getG(openG); if (!g || !$('gv')) return;
    $('gv-name').textContent = g.name; $('gv-av').innerHTML = gAv(g);
    const ok = canSend(g);
    $('gv-form').style.display = ok ? '' : 'none'; $('gv-lock').classList.toggle('hidden', ok);
    updateGvSub();
  }
  async function openGroup(id) {
    const g = getG(id); if (!g) return;
    buildGV(); openG = id;
    refreshGvHeader();
    $('gv').classList.remove('hidden');
    chan('grp:' + id, true);
    try { history.pushState({ gv: 1 }, ''); } catch (e) {}
    const { data } = await sb.from('rada_group_messages').select('*').eq('group_id', id).order('created_at', { ascending: false }).limit(300);
    await fetchProfiles([...new Set((data || []).map((m) => m.sender_id))]);
    (data || []).forEach(addMsg);
    if (openG !== id) return;
    markRead(id); renderGV(true); renderList();
  }
  function closeGroup(silent) {
    if (!openG) return;
    dropChan('grp:' + openG); openG = null; giMedia = null;
    const v = $('gv'); if (v) v.classList.add('hidden');
    if (!silent && history.state && history.state.gv) { try { history.back(); } catch (e) {} }
    renderList();
  }
  window.addEventListener('popstate', () => { if (openG) closeGroup(true); });

  /* ---- people picker (create group / add members) ---- */
  function openPicker({ title, exclude = new Set(), withName, cta, onDone }) {
    const m = modal('modal-gpick', title); m.querySelector('h3').textContent = title;
    const body = m.querySelector('.mbody'), sel = new Set();
    const people = Object.values(profiles).filter((p) => p && p.id !== myId() && !p.banned && !exclude.has(p.id) && !isBlocked(p.id))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    body.innerHTML = `<div class="set-form">${withName ? '<label>Group name<input id="gp-name" maxlength="60" placeholder="e.g. Family"></label>' : ''}
      <input id="gp-q" type="search" placeholder="Search people"></div><div id="gp-list" class="gp-list"></div>
      <div class="set-form"><p id="gp-msg" class="auth-msg"></p><button id="gp-go" class="primary" type="button">${cta}</button></div>`;
    const draw = () => {
      const q = $('gp-q').value.trim().toLowerCase();
      const rows = people.filter((p) => !q || nameOf(p).toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q));
      $('gp-list').innerHTML = rows.length ? rows.map((p) => `<label class="gp-row"><input type="checkbox" value="${p.id}" ${sel.has(p.id) ? 'checked' : ''}>${avatar(p, 'sm')}<span>${esc(nameOf(p))}${vb(p)}</span></label>`).join('') : '<div class="empty-note">No people found.</div>';
    };
    draw();
    $('gp-q').oninput = draw;
    $('gp-list').onchange = (e) => { const c = e.target; if (c.type === 'checkbox') c.checked ? sel.add(c.value) : sel.delete(c.value); $('gp-go').textContent = sel.size ? `${cta} (${sel.size})` : cta; };
    $('gp-go').onclick = async () => {
      const say = (t) => { $('gp-msg').textContent = t; };
      const btn = $('gp-go'); btn.disabled = true; say('');
      try { const ok = await onDone([...sel], withName ? $('gp-name').value.trim() : '', say); if (ok) m.classList.add('hidden'); }
      finally { btn.disabled = false; }
    };
    m.classList.remove('hidden');
  }
  function openCreateGroup() {
    openPicker({
      title: 'New group', withName: true, cta: 'Create group',
      onDone: async (ids, name, say) => {
        if (!name) { say('Give the group a name.'); return false; }
        if (!ids.length) { say('Pick at least one person.'); return false; }
        const { data, error } = await sb.rpc('rada_create_group', { p_name: name, p_members: ids });
        if (error) { say(error.message); return false; }
        await loadGroups(); markRead(data); renderList();
        const t = document.querySelector('.tabs [data-tab="chats"]'); if (t) t.click();
        openGroup(data); return true;
      },
    });
  }
  window.openCreateGroup = openCreateGroup;

  /* ---- share invite link ---- */
  async function inviteUrl(g) {
    const { data, error } = await sb.from('rada_group_invites').select('code').eq('group_id', g.id).maybeSingle();
    if (error || !data) return null;
    return location.origin + location.pathname.replace(/[^/]*$/, '') + '?join=' + data.code;
  }
  async function shareGroup(g) {
    const url = await inviteUrl(g);
    if (!url) return toast('You are not allowed to share this group link.');
    const d = { title: g.name, text: `Join my group "${g.name}" on Rada`, url };
    if (navigator.share) { try { await navigator.share(d); } catch (e) {} return; }
    try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch (e) { prompt('Copy this invite link:', url); }
  }
  async function copyLink(g) {
    const url = await inviteUrl(g); if (!url) return toast('You are not allowed to share this group link.');
    try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch (e) { prompt('Copy this invite link:', url); }
  }

  /* ---- group info (several screens inside one modal) ---- */
  const TITLES_G = { main: 'Group info', perms: 'Group permissions', admins: 'Group admins', media: 'Media, docs and links' };
  const WHO_G = [['everyone', 'Everyone'], ['admins', 'Only admins']];
  const gSel = (k, t, val, sub) => `<label class="set-sel"><b>${t}</b>${sub ? `<small style="display:block;opacity:.7;font-weight:400">${sub}</small>` : ''}<select data-p="${k}">${WHO_G.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;

  function openGroupInfo() {
    const g = getG(openG); if (!g) return;
    const m = modal('modal-ginfo', 'Group info');
    m.classList.remove('hidden'); renderInfo();
  }
  async function loadGiMedia(gid) {
    const [a, b] = await Promise.all([
      sb.from('rada_group_messages').select('*').eq('group_id', gid).not('media_url', 'is', null).order('created_at', { ascending: false }).limit(200),
      sb.from('rada_group_messages').select('content,created_at').eq('group_id', gid).ilike('content', '%http%').order('created_at', { ascending: false }).limit(100),
    ]);
    giMedia = { gid, media: a.data || [], links: (b.data || []).flatMap((x) => (x.content.match(/https?:\/\/[^\s]+/g) || [])) };
    if (giView === 'media' && openG === gid) renderInfo();
  }
  function renderInfo() {
    const g = getG(openG), m = $('modal-ginfo'); if (!g || !m) return;
    const body = m.querySelector('.mbody'), admin = isAdmin(g), me2 = myId();
    m.querySelector('h3').textContent = TITLES_G[giView];
    let h = giView === 'main' ? '' : '<div class="set-head"><button data-gi="back" type="button" aria-label="Back">←</button><h3>' + TITLES_G[giView] + '</h3></div>';

    if (giView === 'main') {
      const rows = g.members.map((mm) => {
        const p = profiles[mm.user_id], mine = mm.user_id === me2;
        const canRemove = admin && !mine && mm.user_id !== g.created_by;
        const acts = mine ? '' : `<div class="gi-act"><button class="mini" data-gi="report" data-u="${mm.user_id}" type="button">Report</button>
          <button class="mini" data-gi="block" data-u="${mm.user_id}" type="button">${isBlocked(mm.user_id) ? 'Unblock' : 'Block'}</button>
          ${canRemove ? `<button class="mini" data-gi="remove" data-u="${mm.user_id}" type="button">Remove</button>` : ''}</div>`;
        return `<div class="item gi-m">${avatar(p, 'sm')}<div class="body"><div class="top"><span class="name">${esc(pname(mm.user_id))}${vb(p)}${mine ? ' (you)' : ''}${mm.role === 'admin' ? '<span class="g-adm">admin</span>' : ''}</span></div></div></div>${acts}`;
      }).join('');
      const reqs = admin && g.requests.length ? `<div class="section-title">Join requests (${g.requests.length})</div>` + g.requests.map((r) => `<div class="gi-req">${avatar(profiles[r.user_id], 'sm')}<span class="who">${esc(pname(r.user_id))}</span>
          <button class="mini" data-gi="approve" data-u="${r.user_id}" type="button">Approve</button><button class="mini" data-gi="reject" data-u="${r.user_id}" type="button">Reject</button></div>`).join('') : '';
      const rules = admin ? '' : `<p class="gi-note">${[g.send_messages === 'admins' ? 'Only admins can send messages.' : '', g.add_members === 'admins' ? 'Only admins can add members.' : '', g.edit_info === 'admins' ? 'Only admins can edit group info.' : ''].filter(Boolean).join(' ') || 'Everyone can take part in this group.'}</p>`;
      h += `<div class="gi-head"><div class="gi-av" ${canEdit(g) ? 'data-gi="avatar"' : ''}>${gAv(g, 'big')}${canEdit(g) ? '<small>Tap to change photo</small>' : ''}</div>
        <h2>${esc(g.name)}</h2><small>Group · ${g.members.length} members</small></div>
        ${g.description ? `<p class="gi-desc">${esc(g.description)}</p>` : ''}
        ${canEdit(g) ? `<div style="text-align:center;padding-bottom:6px"><button class="mini" data-gi="rename" type="button">Edit name</button> <button class="mini" data-gi="desc" type="button">${g.description ? 'Edit' : 'Add'} description</button>${g.avatar_url ? ' <button class="mini" data-gi="rmavatar" type="button">Remove photo</button>' : ''}</div>` : ''}
        <div class="gi-quick">
          ${canAdd(g) ? '<button class="gi-q" data-gi="add" type="button"><span>➕</span>Add</button>' : ''}
          ${canInvite(g) ? '<button class="gi-q" data-gi="share" type="button"><span>🔗</span>Share</button>' : ''}
          <button class="gi-q" data-gi="media" type="button"><span>🖼</span>Media</button></div>
        ${rules}${reqs}
        ${admin ? `<button class="item set-row" data-gi="perms" type="button"><span class="set-ic">🔐</span><div class="body"><div class="top"><span class="name">Group permissions</span></div><div class="bottom"><span class="preview">Who can add, share, send and edit; join approval</span></div></div></button>
        <button class="item set-row" data-gi="admins" type="button"><span class="set-ic">🛡</span><div class="body"><div class="top"><span class="name">Group admins</span></div><div class="bottom"><span class="preview">Choose who can manage this group</span></div></div></button>
        <button class="item set-row" data-gi="copy" type="button"><span class="set-ic">📋</span><div class="body"><div class="top"><span class="name">Copy invite link</span></div></div></button>
        <button class="item set-row" data-gi="reset" type="button"><span class="set-ic">♻️</span><div class="body"><div class="top"><span class="name">Reset invite link</span></div><div class="bottom"><span class="preview">The old link stops working</span></div></div></button>` : (canInvite(g) ? '<button class="item set-row" data-gi="copy" type="button"><span class="set-ic">📋</span><div class="body"><div class="top"><span class="name">Copy invite link</span></div></div></button>' : '')}
        <div class="section-title">Members</div>${rows}
        <button class="item set-row danger" data-gi="leave" type="button"><span class="set-ic">🚪</span><div class="body"><div class="top"><span class="name">Leave group</span></div></div></button>
        ${g.created_by === me2 ? '<button class="item set-row danger" data-gi="delete" type="button"><span class="set-ic">🗑</span><div class="body"><div class="top"><span class="name">Delete group</span></div></div></button>' : ''}`;
    } else if (giView === 'perms') {
      h += `<p class="set-note">Choose what members of this group can do. Admins can always do everything.</p>
        ${gSel('add_members', 'Add new members', g.add_members)}
        ${gSel('invite_by', 'Share group invite link', g.invite_by)}
        <label class="set-tog"><span><b>Require admin approval</b><small>People who join with the invite link wait for an admin to approve them.</small></span><input type="checkbox" data-p="require_approval" ${g.require_approval ? 'checked' : ''}></label>
        ${gSel('send_messages', 'Send new messages', g.send_messages)}
        ${gSel('edit_info', 'Edit group info', g.edit_info)}
        <p class="set-note">"Edit group info" covers the group name, picture and description.</p>`;
    } else if (giView === 'admins') {
      h += '<p class="set-note">Tick the people you want to be admins. The group creator is always an admin.</p>' +
        g.members.map((mm) => `<label class="set-tog"><span><b>${esc(pname(mm.user_id))}${mm.user_id === me2 ? ' (you)' : ''}</b>${mm.user_id === g.created_by ? '<small>Creator</small>' : ''}</span>
          <input type="checkbox" data-adm="${mm.user_id}" ${mm.role === 'admin' ? 'checked' : ''} ${mm.user_id === g.created_by ? 'disabled' : ''}></label>`).join('');
    } else if (giView === 'media') {
      if (!giMedia || giMedia.gid !== g.id) { h += '<div class="empty-note">Loading…</div>'; loadGiMedia(g.id); }
      else {
        const { media, links } = giMedia,
              au = media.filter((x) => x.media_type === 'audio'),
              dc = media.filter((x) => x.media_type === 'file'),
              vi = media.filter((x) => x.media_type === 'image' || x.media_type === 'video');
        const tab = renderInfo.tab || 'm';
        h += `<div class="media-tabs"><button class="${tab === 'm' ? 'active' : ''}" data-gi="tab" data-t="m" type="button">Media (${vi.length})</button><button class="${tab === 'a' ? 'active' : ''}" data-gi="tab" data-t="a" type="button">Audio (${au.length})</button><button class="${tab === 'd' ? 'active' : ''}" data-gi="tab" data-t="d" type="button">Docs (${dc.length})</button><button class="${tab === 'l' ? 'active' : ''}" data-gi="tab" data-t="l" type="button">Links (${links.length})</button></div>`;
        h += tab === 'm' ? (vi.length ? `<div class="media-grid">${vi.map((x) => x.media_type === 'image' ? `<a href="${esc(x.media_url)}" target="_blank" rel="noopener"><img src="${esc(x.media_url)}" loading="lazy" alt=""></a>` : `<video src="${esc(x.media_url)}" controls preload="metadata"></video>`).join('')}</div>` : '<div class="empty-note">No photos or videos yet.</div>')
          : tab === 'd' ? (dc.length ? dc.map((x) => `<a class="doc-row" href="${esc(x.media_url)}" target="_blank" rel="noopener"><span style="font-size:28px">${docIcon(x.media_name)}</span><span>${esc(x.media_name || 'Document')}<small style="display:block;opacity:.65">${fmtSize(x.media_size)}</small></span></a>`).join('') : '<div class="empty-note">No documents yet.</div>')
          : tab === 'a' ? (au.length ? au.map((x) => `<div style="padding:8px 16px">${esc(x.media_name || 'Audio')}<audio src="${esc(x.media_url)}" controls preload="none" style="width:100%"></audio></div>`).join('') : '<div class="empty-note">No audio yet.</div>')
          : (links.length ? links.map((u) => `<div style="padding:10px 16px"><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></div>`).join('') : '<div class="empty-note">No links yet.</div>');
      }
    }
    body.innerHTML = h;
    body.onclick = onInfoClick; body.onchange = onInfoChange;
  }

  async function groupUpdate(args, okMsg) {
    const g = getG(openG); if (!g) return false;
    const { error } = await sb.rpc('rada_update_group', { p_group: g.id, ...args });
    if (error) { toast(error.message); return false; }
    if (okMsg) toast(okMsg); await loadGroups(); return true;
  }
  async function onInfoClick(e) {
    const b = e.target.closest('[data-gi]'); if (!b) return;
    const g = getG(openG); if (!g) return;
    const a = b.dataset.gi, u = b.dataset.u, m = $('modal-ginfo');
    if (a === 'back') { giView = 'main'; return renderInfo(); }
    if (a === 'perms' || a === 'admins') { giView = a; return renderInfo(); }
    if (a === 'media') { giView = 'media'; renderInfo.tab = 'm'; giMedia = null; return renderInfo(); }
    if (a === 'tab') { renderInfo.tab = b.dataset.t; return renderInfo(); }
    if (a === 'share') return shareGroup(g);
    if (a === 'copy') return copyLink(g);
    if (a === 'reset') {
      if (!confirm('Reset the invite link? Anyone with the old link will no longer be able to join.')) return;
      const { error } = await sb.rpc('rada_reset_invite', { p_group: g.id }); return toast(error ? error.message : 'Invite link reset');
    }
    if (a === 'report') { m.classList.add('hidden'); return openReport(u); }
    if (a === 'block') { await toggleBlockUI(u); return renderInfo(); }
    if (a === 'rename') { const n = (prompt('Group name', g.name) || '').trim(); if (n && n !== g.name) await groupUpdate({ p_name: n }); return; }
    if (a === 'desc') { const d = prompt('Group description', g.description || ''); if (d !== null) await groupUpdate({ p_description: d.trim() }); return; }
    if (a === 'rmavatar') { if (confirm('Remove the group photo?')) await groupUpdate({ p_avatar: '' }, 'Photo removed'); return; }
    if (a === 'avatar') {
      return pickFile('image/*', async (f) => {
        toast('Uploading photo…');
        try { const blob = await shrink(f, 512); await groupUpdate({ p_avatar: await uploadTo(`${g.id}/avatar/${Date.now()}.jpg`, blob) }, 'Group photo updated'); }
        catch (err) { toast(err.message); }
      });
    }
    if (a === 'approve' || a === 'reject') {
      const { error } = await sb.rpc('rada_review_request', { p_group: g.id, p_user: u, p_approve: a === 'approve' });
      if (error) return toast(error.message); toast(a === 'approve' ? 'Member approved' : 'Request rejected'); return loadGroups();
    }
    if (a === 'add') {
      m.classList.add('hidden');
      return openPicker({ title: 'Add members', exclude: new Set(g.members.map((x) => x.user_id)), cta: 'Add', onDone: async (ids, _n, say) => {
        if (!ids.length) { say('Pick at least one person.'); return false; }
        const { error } = await sb.rpc('rada_add_group_members', { p_group: g.id, p_members: ids });
        if (error) { say(error.message); return false; }
        await loadGroups(); toast('Members added'); return true;
      } });
    }
    if (a === 'remove') {
      if (!confirm(`Remove ${pname(u)} from the group?`)) return;
      const { error } = await sb.from('rada_group_members').delete().eq('group_id', g.id).eq('user_id', u);
      if (error) return toast(error.message); return loadGroups();
    }
    if (a === 'leave') {
      if (!confirm('Leave this group?')) return;
      const { error } = await sb.rpc('rada_leave_group', { p_group: g.id });
      if (error) return toast(error.message);
      m.classList.add('hidden'); closeGroup(); delete gmsgs[g.id]; return loadGroups();
    }
    if (a === 'delete') {
      if (!confirm('Delete this group for everyone? This cannot be undone.')) return;
      const { error } = await sb.from('rada_groups').delete().eq('id', g.id);
      if (error) return toast(error.message);
      m.classList.add('hidden'); closeGroup(); delete gmsgs[g.id]; return loadGroups();
    }
  }
  async function onInfoChange(e) {
    const g = getG(openG), el = e.target; if (!g) return;
    if (el.dataset.p) {
      const next = { add_members: g.add_members, invite_by: g.invite_by, require_approval: g.require_approval, send_messages: g.send_messages, edit_info: g.edit_info };
      next[el.dataset.p] = el.type === 'checkbox' ? el.checked : el.value;
      const { error } = await sb.rpc('rada_update_permissions', { p_group: g.id, p_add_members: next.add_members, p_invite_by: next.invite_by, p_require_approval: next.require_approval, p_send_messages: next.send_messages, p_edit_info: next.edit_info });
      if (error) { toast(error.message); return renderInfo(); }
      Object.assign(g, next); toast('Saved'); refreshGvHeader();
    } else if (el.dataset.adm) {
      const { error } = await sb.rpc('rada_set_admin', { p_group: g.id, p_user: el.dataset.adm, p_admin: el.checked });
      if (error) { toast(error.message); return renderInfo(); }
      toast(el.checked ? 'Made admin' : 'Admin removed'); loadGroups();
    }
  }

  /* ---- joining through an invite link (?join=CODE) ---- */
  (() => {
    try {
      const u = new URL(location.href), c = u.searchParams.get('join');
      if (c) { lsSet('rada-join', c); u.searchParams.delete('join'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
    } catch (e) {}
  })();
  async function processJoin() {
    const code = lsGet('rada-join', null); if (!code || !cur) return;
    lsSet('rada-join', null);
    const { data, error } = await sb.rpc('rada_group_preview', { p_code: code });
    const p = Array.isArray(data) ? data[0] : data;
    if (error || !p) return toast('This invite link is invalid or was reset.');
    if (p.is_member) { await loadGroups(); return openGroup(p.id); }
    if (!confirm(`Join the group "${p.name}" (${p.members} members)?` + (p.require_approval ? '\nAn admin has to approve your request.' : ''))) return;
    const r = await sb.rpc('rada_join_group', { p_code: code });
    if (r.error) return toast(r.error.message);
    if (r.data === 'pending') return toast('Request sent. An admin will review it.');
    await loadGroups(); openGroup(p.id);
  }

  /* ============================================================
     4. BLOCK + REPORT in the ⋮ menu
     ============================================================ */
  async function toggleBlockUI(id) {
    if (!id) return;
    if (isBlocked(id)) return setBlock(id, false);
    if (!confirm(`Block ${pname(id)}? They will not be able to message or call you.`)) return;
    await setBlock(id, true);
  }
  window.toggleBlock = toggleBlockUI;     // menu.js looks for this name

  const menuEl = $('chat-menu');
  if (menuEl) new MutationObserver(() => {
    menuEl.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Block' && activeId && isBlocked(activeId)) b.textContent = 'Unblock'; });
  }).observe(menuEl, { childList: true });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('#chat-menu button, #top-menu button[data-go="group"], #comm-new, #chips [data-chip="plus"]');
    if (!b) return;
    if (b.closest('#chat-menu')) {
      const t = b.textContent.trim();
      if (t === 'Report') { stop(e); menuEl.classList.add('hidden'); if (activeId) openReport(activeId); }
      else if (t === 'Block' || t === 'Unblock') { stop(e); menuEl.classList.add('hidden'); toggleBlockUI(activeId); }
      else if (t === 'New group') { stop(e); menuEl.classList.add('hidden'); openCreateGroup(); }
    } else { stop(e); const tm = $('top-menu'); if (tm) tm.classList.add('hidden'); openCreateGroup(); }
  }, true);

  /* ============================================================
     5. DOCUMENTS IN 1:1 CHATS
     Picks up document files chosen in the normal attach button.
     Photos/videos/audio are still handled by app.js.
     ============================================================ */
  const af = $('attach-file');
  if (af) af.addEventListener('change', async (e) => {
    const all = [...af.files];
    const docs = all.filter(isDoc), rest = all.filter((f) => !docs.includes(f));
    if (!docs.length) return;                       // only photos/videos/audio: app.js handles them
    if (!rest.length) { stop(e); } else {           // mixed: hand app.js only the media files
      const dt = new DataTransfer(); rest.forEach((f) => dt.items.add(f)); af.files = dt.files;
    }
    const to = activeId; if (!to) return;
    for (const f of docs) {
      toast('Sending document…');
      try {
        const url = await uploadDoc(f);
        // ASSUMPTION: table "messages" with sender_id / receiver_id. Match the insert used in app.js.
        const { error } = await sb.from('messages').insert({
          sender_id: myId(), receiver_id: to, content: '',
          media_url: url, media_type: 'file', media_name: f.name.slice(0, 120), media_size: f.size, media_mime: f.type || null,
        });
        if (error) throw error;
      } catch (err) { toast(err.message); }
    }
    if (!rest.length) af.value = '';
  }, true);

  /* ============================================================
     session lifecycle
     ============================================================ */
  function startSession() {
    buildGV();
    gCh = sb.channel('groups-' + myId())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rada_group_messages' }, (p) => onGroupMsg(p.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rada_group_members' }, reloadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rada_groups' }, reloadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rada_group_requests' }, (p) => {
        if (p.eventType === 'INSERT' && p.new && getG(p.new.group_id) && isAdmin(getG(p.new.group_id))) {
          fetchProfiles([p.new.user_id]).then(() => toast(`${pname(p.new.user_id)} wants to join "${getG(p.new.group_id).name}"`));
        }
        reloadSoon();
      })
      .subscribe();
    chan('typing-in:' + myId(), true);
    loadGroups().then(processJoin);
  }
  function endSession() {
    if (gCh) { try { sb.removeChannel(gCh); } catch (e) {} gCh = null; }
    Object.keys(tCh).forEach(dropChan);
    groups = []; gmsgs = {}; openG = null; lastSig = '';
    Object.keys(typingUntil).forEach((k) => delete typingUntil[k]);
    const v = $('gv'); if (v) v.classList.add('hidden');
  }
  setInterval(() => {
    const id = myId();
    if (id !== cur) { if (cur) endSession(); cur = id; if (id) startSession(); }
    if (cur) typingTick();
  }, 700);
})();