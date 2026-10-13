/* ============================================================
   ChatApp extras: settings, verification badge, update notifications,
   block / report, ban screen.  Loaded after app.js (shares its globals).
   Needs admin_setup.sql to have been run.
   ============================================================ */

/* ---------------- settings model (stored in profiles.settings) ---------------- */
const DEF = {
  privacy: { online: 'everyone', photo: 'everyone', about: 'everyone', receipts: true },
  chats:   { enterSend: true, fontSize: 'medium', theme: 'default' },
  notif:   { messages: true, desktop: true, ringtone: true, vibrate: true, updates: true },
};
const S = () => {
  const s = (me && profiles[me.id] && profiles[me.id].settings) || {};
  return { privacy: { ...DEF.privacy, ...s.privacy }, chats: { ...DEF.chats, ...s.chats }, notif: { ...DEF.notif, ...s.notif } };
};
async function saveSettings(fn) {
  const cur = S(); fn(cur);
  const { error } = await sb.from('profiles').update({ settings: cur }).eq('id', me.id);
  if (error) { toast(error.message); return false; }
  profiles[me.id] = { ...profiles[me.id], settings: cur };
  applySettings(); return true;
}
function applySettings() {
  const px = { small: '13px', medium: '15px', large: '17.5px' }[S().chats.fontSize] || '15px';
  document.documentElement.style.setProperty('--msg-fs', px);
  if (me && activeId) { applyTheme(activeId); renderMessages(false); renderList(); }
}

/* privacy: everyone | contacts (people I have chatted with) | nobody */
function canSee(p, field) {
  if (!p || !me || p.id === me.id) return true;
  const v = (p.settings && p.settings.privacy && p.settings.privacy[field]) || 'everyone';
  if (v === 'everyone') return true;
  if (v === 'nobody') return false;
  return messages.some((m) => (m.sender_id === p.id && m.receiver_id === me.id) || (m.sender_id === me.id && m.receiver_id === p.id));
}
/* read receipts: blue ticks only if the receiver allows it (like WhatsApp) */
function tickHtml(m) {
  const rcv = profiles[m.receiver_id], blue = m.read && !(rcv && rcv.settings && rcv.settings.privacy && rcv.settings.privacy.receipts === false);
  return `<span class="tick ${blue ? 'read' : ''}">${m.read ? '✓✓' : '✓'}</span>`;
}

/* ---------------- small UI helpers ---------------- */
const VB = '<svg class="vbadge" viewBox="0 0 24 24" role="img" aria-label="Verified"><path fill="#1d9bf0" d="M22.5 12.5l-2.1-2.4.3-3.2-3.1-.7-1.6-2.8L13 4.6 10 3.3 8.4 6.1l-3.1.7.3 3.2L3.5 12.5l2.1 2.4-.3 3.2 3.1.7 1.6 2.8 3-1.3 3 1.3 1.6-2.8 3.1-.7-.3-3.2z"/><path fill="none" stroke="#fff" stroke-width="2" d="M8 12.5l2.7 2.7L16 9.8"/></svg>';
const vb = (p) => (p && p.is_verified ? VB : '');
function toast(t) {
  let el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}
function modal(id, title) {
  let m = $(id);
  if (!m) {
    m = document.createElement('div'); m.id = id; m.className = 'modal hidden';
    m.innerHTML = `<div class="modal-card"><header><button class="close" type="button">✕</button><h3>${title}</h3></header><div class="mbody"></div></div>`;
    document.body.appendChild(m); m.querySelector('.close').onclick = () => m.classList.add('hidden');
  }
  return m;
}
const fmtDate = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/* ---------------- state ---------------- */
let myBlocks = new Set(), notifs = [], notifReads = new Set(), myVerif = null, extrasCh = null;
const isBlocked = (id) => myBlocks.has(id);

async function initExtras() {
  applySettings();
  addHeaderButtons();
  const [b, n, r, v] = await Promise.all([
    sb.from('blocks').select('blocked_id').eq('blocker_id', me.id),
    sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
    sb.from('notif_reads').select('notif_id').eq('user_id', me.id),
    sb.from('verification_requests').select('*').eq('user_id', me.id).order('created_at', { ascending: false }).limit(1),
  ]);
  myBlocks = new Set((b.data || []).map((x) => x.blocked_id));
  notifs = n.data || []; notifReads = new Set((r.data || []).map((x) => x.notif_id));
  myVerif = (v.data || [])[0] || null;
  refreshBell(); renderProfilePane(); if (activeId) openHeader();
  extrasCh = sb.channel('extras-' + me.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (p) => onNotif(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'verification_requests', filter: 'user_id=eq.' + me.id }, async () => {
      const { data } = await sb.from('verification_requests').select('*').eq('user_id', me.id).order('created_at', { ascending: false }).limit(1);
      myVerif = (data || [])[0] || null; renderProfilePane();
    })
    .subscribe();
}
function stopExtras() {
  if (extrasCh) sb.removeChannel(extrasCh); extrasCh = null;
  myBlocks = new Set(); notifs = []; notifReads = new Set(); myVerif = null;
  hideBan(); const ub = $('update-banner'); if (ub) ub.remove();
  ['modal-notifs', 'modal-verify', 'modal-chatmenu', 'modal-report'].forEach((i) => { const m = $(i); if (m) m.remove(); });
  settingsView = 'main';
}

/* ============================================================
   BAN screen (admin banned this account)
   ============================================================ */
function checkBanned() {
  const p = profiles[me.id];
  if (!p || !p.banned) { hideBan(); return false; }
  let el = $('ban-screen');
  if (!el) { el = document.createElement('div'); el.id = 'ban-screen'; document.body.appendChild(el); }
  el.innerHTML = `<div class="ban-card"><div class="ban-ic">🚫</div><h2>Account banned</h2>
    <p>${esc(p.ban_reason || 'This account was banned for breaking the rules.')}</p>
    <textarea id="appeal-text" rows="3" maxlength="500" placeholder="Think this is a mistake? Tell us why (optional appeal)"></textarea>
    <p id="appeal-msg" class="auth-msg"></p>
    <button id="appeal-send" class="primary" type="button">Send appeal</button>
    <button id="ban-out" class="ghost" type="button">Log out</button></div>`;
  $('ban-out').onclick = async () => { await sb.auth.signOut(); };
  $('appeal-send').onclick = async () => {
    const t = $('appeal-text').value.trim(); if (!t) { $('appeal-msg').textContent = 'Write a short message first.'; return; }
    const { error } = await sb.from('reports').insert({ kind: 'appeal', reporter_id: me.id, reported_id: me.id, reason: 'Ban appeal', details: t });
    $('appeal-msg').textContent = error ? error.message : 'Appeal sent. An admin will review it.'; $('appeal-msg').classList.toggle('ok', !error);
  };
  return true;
}
function hideBan() { const el = $('ban-screen'); if (el) el.remove(); }

/* ============================================================
   NOTIFICATIONS (admin broadcasts, verification results)
   ============================================================ */
function addHeaderButtons() {
  if (!$('btn-bell')) {
    const b = document.createElement('button'); b.id = 'btn-bell'; b.type = 'button'; b.title = 'Notifications'; b.setAttribute('aria-label', 'Notifications');
    b.innerHTML = '🔔<span id="bell-dot" class="bell-dot hidden"></span>'; b.onclick = openNotifs;
    $('btn-new').before(b);
  }
  if (!$('btn-more')) {
    const b = document.createElement('button'); b.id = 'btn-more'; b.type = 'button'; b.className = 'icon-btn'; b.title = 'More'; b.setAttribute('aria-label', 'More'); b.textContent = '⋮';
    b.onclick = openChatMenu; $('btn-theme').after(b);
  }
}
const unreadNotifs = () => notifs.filter((n) => !notifReads.has(n.id));
function refreshBell() {
  const n = unreadNotifs().length, d = $('bell-dot'); if (d) { d.textContent = n > 9 ? '9+' : n; d.classList.toggle('hidden', !n); }
  const u = unreadNotifs().find((x) => x.type === 'update');
  let ban = $('update-banner');
  if (u && S().notif.updates) {
    if (!ban) { ban = document.createElement('div'); ban.id = 'update-banner'; document.body.appendChild(ban); }
    ban.innerHTML = `<div><b>${esc(u.title)}</b><span>${esc(u.body || '')}</span></div><button id="ub-go" type="button">Update now</button><button id="ub-x" type="button" aria-label="Dismiss">✕</button>`;
    $('ub-go').onclick = updateNow; $('ub-x').onclick = () => { markNotifsRead([u.id]); };
  } else if (ban) ban.remove();
}
async function onNotif(n) {
  if (n.user_id && n.user_id !== me.id) return;
  if (notifs.some((x) => x.id === n.id)) return;
  notifs.unshift(n); refreshBell(); playReceive(); toast((n.type === 'update' ? '⬆ ' : '🔔 ') + n.title);
  if (n.type === 'verification') { const { data } = await sb.from('profiles').select('*').eq('id', me.id).single(); if (data) { profiles[me.id] = data; renderAll(); } }
  if (S().notif.updates && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { const reg = await getSw(); const o = { body: n.body || '', icon: 'icon-192.png', tag: 'notif-' + n.id }; reg ? reg.showNotification(n.title, o) : new Notification(n.title, o); } catch (e) {}
  }
  if (!$('modal-notifs').classList.contains('hidden')) renderNotifs();
}
async function markNotifsRead(ids) {
  ids = ids.filter((i) => !notifReads.has(i)); if (!ids.length) return;
  ids.forEach((i) => notifReads.add(i)); refreshBell();
  await sb.from('notif_reads').upsert(ids.map((i) => ({ user_id: me.id, notif_id: i })), { onConflict: 'user_id,notif_id', ignoreDuplicates: true });
}
function renderNotifs() {
  const m = modal('modal-notifs', 'Notifications'), body = m.querySelector('.mbody');
  const icon = { update: '⬆️', info: 'ℹ️', warning: '⚠️', verification: '✅' };
  body.innerHTML = notifs.length ? notifs.map((n) => `<div class="notif ${notifReads.has(n.id) ? '' : 'new'}">
    <span class="n-ic">${icon[n.type] || '🔔'}</span><div class="n-body"><b>${esc(n.title)}</b><p>${esc(n.body || '')}</p>
    <small>${fmtDate(n.created_at)}, ${timeStr(n.created_at)}</small>${n.type === 'update' ? '<button class="n-go" data-upd type="button">Update now</button>' : ''}</div></div>`).join('')
    : '<div class="empty-note">No notifications yet.</div>';
  body.querySelectorAll('[data-upd]').forEach((b) => (b.onclick = updateNow));
}
function openNotifs() { renderNotifs(); modal('modal-notifs').classList.remove('hidden'); markNotifsRead(notifs.map((n) => n.id)); }
async function updateNow() {      // really refreshes: new service worker + empty caches + reload
  try {
    if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) { try { await r.update(); } catch (e) {} try { await r.unregister(); } catch (e) {} }
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  } catch (e) {}
  location.reload();
}

/* ============================================================
   BLOCK + REPORT (report = request for admins to ban someone)
   ============================================================ */
function afterHeader() {
  const blocked = isBlocked(activeId);
  $('composer').querySelectorAll('textarea,button,input').forEach((e) => (e.disabled = blocked));
  $('btn-vcall').disabled = $('btn-acall').disabled = blocked;
  $('msg-input').placeholder = blocked ? 'You blocked this contact. Unblock to send messages.' : 'Type a message';
}
const _openHeader = openHeader;
openHeader = function () { _openHeader(); afterHeader(); };

function openChatMenu() {
  if (!activeId) return;
  const p = profiles[activeId], m = modal('modal-chatmenu', 'Contact options'), blocked = isBlocked(activeId);
  m.querySelector('.mbody').innerHTML = `<div class="menu-who">${avatar(p, 'sm')}<b>${esc(nameOf(p))}${vb(p)}</b></div>
    <button class="item set-row" id="cm-block" type="button"><span class="set-ic">${blocked ? '✅' : '⛔'}</span><div class="body"><div class="top"><span class="name">${blocked ? 'Unblock' : 'Block'}</span></div></div></button>
    <button class="item set-row" id="cm-report" type="button"><span class="set-ic">🚩</span><div class="body"><div class="top"><span class="name">Report to admin</span></div><div class="bottom"><span class="preview">Ask the admins to review or ban this user</span></div></div></button>`;
  m.classList.remove('hidden');
  $('cm-block').onclick = async () => { await setBlock(activeId, !blocked); m.classList.add('hidden'); };
  $('cm-report').onclick = () => { m.classList.add('hidden'); openReport(activeId); };
}
async function setBlock(id, on) {
  const q = on ? sb.from('blocks').insert({ blocker_id: me.id, blocked_id: id }) : sb.from('blocks').delete().eq('blocker_id', me.id).eq('blocked_id', id);
  const { error } = await q; if (error) return toast(error.message);
  on ? myBlocks.add(id) : myBlocks.delete(id);
  toast(on ? 'Contact blocked' : 'Contact unblocked'); if (activeId) openHeader(); if (settingsView === 'blocked') renderSettings();
}
function openReport(id) {
  const p = profiles[id], m = modal('modal-report', 'Report user');
  m.querySelector('.mbody').innerHTML = `<div class="set-form"><p>Report <b>${esc(nameOf(p))}</b>. Admins will review it and may ban the account.</p>
    <label>Reason<select id="rp-reason"><option>Spam</option><option>Harassment or abuse</option><option>Scam or fraud</option><option>Fake account / impersonation</option><option>Inappropriate content</option><option>Other</option></select></label>
    <label>Details<textarea id="rp-details" rows="3" maxlength="500" placeholder="What happened?"></textarea></label>
    <p id="rp-msg" class="auth-msg"></p><button id="rp-send" class="primary" type="button">Send report</button></div>`;
  m.classList.remove('hidden');
  $('rp-send').onclick = async () => {
    const { error } = await sb.from('reports').insert({ kind: 'report', reporter_id: me.id, reported_id: id, reason: $('rp-reason').value, details: $('rp-details').value.trim() || null });
    if (error) { $('rp-msg').textContent = error.message; return; }
    m.classList.add('hidden'); toast('Report sent to the admins');
  };
}

/* ============================================================
   VERIFICATION (blue badge application)
   ============================================================ */
const VCATS = ['Public figure', 'Business or brand', 'Content creator', 'Journalist or media', 'Organization', 'Other'];
function verifCard() {
  const p = profiles[me.id], r = myVerif;
  if (p.is_verified) return `<div class="vcard ok"><b>${VB} Verified</b><span>Your account has the blue badge${p.verified_at ? ' since ' + fmtDate(p.verified_at) : ''}.</span></div>`;
  if (r && r.status === 'pending') return `<div class="vcard wait"><b>⏳ Verification under review</b><span>Sent ${fmtDate(r.created_at)}. You will get a notification when an admin decides.</span></div>`;
  const rej = r && r.status === 'rejected' ? `<span class="vrej">Last request declined${r.admin_note ? ': ' + esc(r.admin_note) : '.'}</span>` : '';
  return `<div class="vcard"><b>${VB} Get the blue badge</b><span>Apply to show people your account is authentic.</span>${rej}<button id="v-apply" class="primary" type="button">Apply for verification</button></div>`;
}
const _renderProfilePane = renderProfilePane;
renderProfilePane = function () {
  _renderProfilePane();
  const root = $('pane-profile').querySelector('.profile'); if (!root || !profiles[me.id]) return;
  root.insertAdjacentHTML('afterbegin', verifCard());
  const nm = root.querySelector('#p-name'); if (nm && profiles[me.id].is_verified) nm.parentElement.querySelector('label').innerHTML = 'Your name ' + VB;
  const b = $('v-apply'); if (b) b.onclick = openVerify;
};
function openVerify() {
  const m = modal('modal-verify', 'Apply for verification'), p = profiles[me.id];
  m.querySelector('.mbody').innerHTML = `<div class="set-form">
    <label>Full legal name<input id="vf-name" value="${esc(p.full_name || '')}" maxlength="80"></label>
    <label>Category<select id="vf-cat">${VCATS.map((c) => `<option>${c}</option>`).join('')}</select></label>
    <label>Why should your account be verified?<textarea id="vf-why" rows="3" maxlength="600" placeholder="Tell the admins who you are and why you need the badge"></textarea></label>
    <label>Website or social links<input id="vf-links" maxlength="300" placeholder="https://..."></label>
    <label>ID or proof photo (private, only admins see it)<input id="vf-doc" type="file" accept="image/*"></label>
    <p id="vf-msg" class="auth-msg"></p><button id="vf-send" class="primary" type="button">Submit request</button></div>`;
  m.classList.remove('hidden');
  $('vf-send').onclick = async () => {
    const msg = $('vf-msg'), name = $('vf-name').value.trim(), why = $('vf-why').value.trim(), f = $('vf-doc').files[0];
    msg.classList.remove('ok');
    if (!name || !why) { msg.textContent = 'Fill in your name and the reason.'; return; }
    if (!f) { msg.textContent = 'Add a photo of an ID or other proof.'; return; }
    if (f.size > 5 * 1024 * 1024) { msg.textContent = 'Photo must be under 5 MB.'; return; }
    const btn = $('vf-send'); btn.disabled = true; msg.textContent = 'Uploading…';
    try {
      const path = `${me.id}/${Date.now()}.${(f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const up = await sb.storage.from('verification-docs').upload(path, f, { contentType: f.type }); if (up.error) throw up.error;
      const { data, error } = await sb.from('verification_requests').insert({ user_id: me.id, full_name: name, category: $('vf-cat').value, reason: why, links: $('vf-links').value.trim() || null, doc_path: path }).select().single();
      if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'You already have a request waiting for review.' : error.message);
      myVerif = data; m.classList.add('hidden'); renderProfilePane(); renderSettings(); toast('Request sent. We will notify you.');
    } catch (e) { msg.textContent = e.message; btn.disabled = false; }
  };
}

/* ============================================================
   SETTINGS tab (WhatsApp-style: Account, Privacy, Chats, Notifications, Storage, Help)
   ============================================================ */
let settingsView = 'main';
const sRow = (go, ic, t, sub) => `<button class="item set-row" data-go="${go}" type="button"><span class="set-ic">${ic}</span><div class="body"><div class="top"><span class="name">${t}</span></div>${sub ? `<div class="bottom"><span class="preview">${sub}</span></div>` : ''}</div></button>`;
const sTog = (k, t, sub, on) => `<label class="set-tog"><span><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}></label>`;
const sSel = (k, t, opts, val) => `<label class="set-sel"><b>${t}</b><select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
const WHO = [['everyone', 'Everyone'], ['contacts', 'My chats'], ['nobody', 'Nobody']];
const TITLES = { account: 'Account', privacy: 'Privacy', blocked: 'Blocked contacts', chats: 'Chats', notif: 'Notifications', storage: 'Storage and data', help: 'Help' };

function renderSettings() {
  const pane = $('pane-settings'), p = profiles[me.id], s = S(); if (!p) return;
  let h = '';
  if (settingsView === 'main') {
    h = `<button class="item set-me" data-tab-go="profile" type="button">${avatar(p)}<div class="body"><div class="top"><span class="name">${esc(nameOf(p))}${vb(p)}</span></div><div class="bottom"><span class="preview">${esc(p.about || 'Hey there! I am using ChatApp')}</span></div></div></button>
      ${sRow('account', '🔑', 'Account', 'Password, email, verification, delete account')}
      ${sRow('privacy', '🔒', 'Privacy', 'Last seen, profile photo, about, read receipts, blocked')}
      ${sRow('chats', '💬', 'Chats', 'Theme, font size, Enter key')}
      ${sRow('notif', '🔔', 'Notifications', 'Messages, calls, app updates')}
      ${sRow('storage', '🗂', 'Storage and data', 'Export chats, clear cache')}
      ${sRow('help', '❓', 'Help', 'Contact the admins, app info')}
      <button class="item set-row" data-act="share" type="button"><span class="set-ic">👥</span><div class="body"><div class="top"><span class="name">Invite a friend</span></div></div></button>
      <button class="item set-row danger" data-act="logout" type="button"><span class="set-ic">⏻</span><div class="body"><div class="top"><span class="name">Log out</span></div></div></button>`;
  } else {
    h = `<div class="set-head"><button data-go="main" type="button" aria-label="Back">←</button><h3>${TITLES[settingsView]}</h3></div>`;
    if (settingsView === 'account') {
      h += `${verifCard()}
        <div class="set-form"><h4>Change password</h4><input id="ac-pw" type="password" minlength="6" placeholder="New password" autocomplete="new-password"><input id="ac-pw2" type="password" placeholder="Repeat new password" autocomplete="new-password"><button class="primary" data-act="pw" type="button">Update password</button></div>
        <div class="set-form"><h4>Change email</h4><input id="ac-em" type="email" placeholder="${esc(me.email)}"><button class="primary" data-act="email" type="button">Send confirmation link</button></div>
        <div class="set-form"><h4>Delete my account</h4><p>This permanently removes your account, chats and statuses. This cannot be undone.</p><input id="ac-del" placeholder='Type DELETE to confirm'><button class="primary dangerbtn" data-act="delete" type="button">Delete account</button></div>
        <p id="set-msg" class="auth-msg"></p>`;
      // the verification card button lives in this view too
    } else if (settingsView === 'privacy') {
      h += `<p class="set-note">Choose who can see your information. "My chats" means people you have exchanged messages with.</p>
        ${sSel('privacy.online', 'Last seen and online', WHO, s.privacy.online)}${sSel('privacy.photo', 'Profile photo', WHO, s.privacy.photo)}${sSel('privacy.about', 'About', WHO, s.privacy.about)}
        ${sTog('privacy.receipts', 'Read receipts', 'If off, you will not send or see blue ticks.', s.privacy.receipts)}
        ${sRow('blocked', '⛔', 'Blocked contacts', myBlocks.size ? myBlocks.size + ' blocked' : 'None')}`;
    } else if (settingsView === 'blocked') {
      h += myBlocks.size ? [...myBlocks].map((id) => `<div class="item">${avatar(profiles[id], 'sm')}<div class="body"><div class="top"><span class="name">${esc(nameOf(profiles[id]))}</span></div></div><button class="mini" data-unblock="${id}" type="button">Unblock</button></div>`).join('') : '<div class="empty-note">You have not blocked anyone.</div>';
    } else if (settingsView === 'chats') {
      h += `${sSel('chats.theme', 'Default chat theme', THEMES.map((t) => [t.id, t.name]), s.chats.theme)}
        ${sSel('chats.fontSize', 'Font size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], s.chats.fontSize)}
        ${sTog('chats.enterSend', 'Enter is send', 'On computers, Enter sends and Shift+Enter adds a new line.', s.chats.enterSend)}
        <p class="set-note">Pick a theme for a single chat with the 🎨 button inside that chat.</p>`;
    } else if (settingsView === 'notif') {
      const perm = 'Notification' in window ? Notification.permission : 'unsupported';
      h += `${sTog('notif.messages', 'Message notifications', 'Sound and alerts for new messages.', s.notif.messages)}
        ${sTog('sound', 'Notification sounds', 'Play a tone when a message arrives or is sent.', soundOn())}
        ${sTog('notif.desktop', 'Alerts when app is in background', 'Browser permission: ' + perm + '.', s.notif.desktop)}
        ${sTog('notif.ringtone', 'Call ringtone', '', s.notif.ringtone)}
        ${sTog('notif.vibrate', 'Vibrate on calls', 'Phones only.', s.notif.vibrate)}
        ${sTog('notif.updates', 'App update alerts', 'Banner and alert when the admins release an update.', s.notif.updates)}`;
    } else if (settingsView === 'storage') {
      h += `<div class="set-form"><p id="st-usage">Calculating storage used on this device…</p>
        <button class="primary" data-act="export" type="button">Export my chats (JSON)</button>
        <button class="primary ghostbtn" data-act="clearcache" type="button">Clear app cache and reload</button></div>`;
      setTimeout(async () => { try { const e = await navigator.storage.estimate(); const el = $('st-usage'); if (el) el.textContent = `This app uses about ${(e.usage / 1048576).toFixed(1)} MB on this device.`; } catch (x) {} }, 0);
    } else if (settingsView === 'help') {
      h += `<div class="set-form"><h4>Contact the admins</h4><textarea id="hp-text" rows="4" maxlength="600" placeholder="Describe your problem or idea"></textarea><button class="primary" data-act="feedback" type="button">Send</button><p id="set-msg" class="auth-msg"></p></div>
        <div class="set-form"><h4>About</h4><p>ChatApp. Signed in as ${esc(me.email)}.</p></div>`;
    }
  }
  pane.innerHTML = h;
  const vb2 = pane.querySelector('#v-apply'); if (vb2) vb2.onclick = openVerify;
}
function setMsg(t, ok) { const el = $('set-msg'); if (el) { el.textContent = t; el.classList.toggle('ok', !!ok); } }

(function bindSettings() {
  const pane = $('pane-settings');
  pane.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]'), act = e.target.closest('[data-act]'), ub = e.target.closest('[data-unblock]'), tg = e.target.closest('[data-tab-go]');
    if (tg) return switchTab(tg.dataset.tabGo);
    if (go) { settingsView = go.dataset.go; return renderSettings(); }
    if (ub) return setBlock(ub.dataset.unblock, false);
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'logout') return $('btn-logout').click();
    if (a === 'share') {
      const data = { title: 'ChatApp', text: 'Chat with me on ChatApp', url: location.origin + location.pathname.replace(/[^/]*$/, '') };
      return navigator.share ? navigator.share(data).catch(() => {}) : navigator.clipboard.writeText(data.url).then(() => toast('Link copied'));
    }
    if (a === 'pw') {
      const a1 = $('ac-pw').value, a2 = $('ac-pw2').value;
      if (a1.length < 6) return setMsg('Password must be at least 6 characters.'); if (a1 !== a2) return setMsg('Passwords do not match.');
      const { error } = await sb.auth.updateUser({ password: a1 }); return setMsg(error ? error.message : 'Password updated.', !error);
    }
    if (a === 'email') {
      const v = $('ac-em').value.trim(); if (!v) return setMsg('Enter the new email.');
      const { error } = await sb.auth.updateUser({ email: v }); return setMsg(error ? error.message : 'Check your inbox to confirm the new email.', !error);
    }
    if (a === 'delete') {
      if ($('ac-del').value.trim() !== 'DELETE') return setMsg('Type DELETE to confirm.');
      const { error } = await sb.rpc('delete_my_account'); if (error) return setMsg(error.message);
      await sb.auth.signOut(); return;
    }
    if (a === 'feedback') {
      const t = $('hp-text').value.trim(); if (!t) return setMsg('Write a message first.');
      const { error } = await sb.from('reports').insert({ kind: 'feedback', reporter_id: me.id, reason: 'Help request', details: t });
      if (!error) $('hp-text').value = ''; return setMsg(error ? error.message : 'Sent. Thank you!', !error);
    }
    if (a === 'export') {
      const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), account: me.email, messages: messages.map((m) => ({ ...m, with: nameOf(profiles[m.sender_id === me.id ? m.receiver_id : m.sender_id]) })) }, null, 2)], { type: 'application/json' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'chatapp-export.json'; l.click(); return;
    }
    if (a === 'clearcache') return updateNow();
  });
  pane.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-k]'); if (!el) return;
    const k = el.dataset.k, v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'sound') { localStorage.setItem('chat-sound', v ? 'on' : 'off'); if (v) playReceive(); return; }
    if (k === 'notif.desktop' && v && 'Notification' in window && Notification.permission === 'default') { await Notification.requestPermission(); registerPush(); }
    const [g, f] = k.split('.');
    const ok = await saveSettings((s) => { s[g][f] = v; });
    if (ok) toast('Saved'); else el.type === 'checkbox' ? (el.checked = !v) : renderSettings();
  });
})();

const _switchTab = switchTab;
switchTab = function (t) { _switchTab(t); if (t === 'settings') renderSettings(); };