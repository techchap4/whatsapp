/* ============================================================
   ChatApp - WhatsApp-style chat on Supabase
   ============================================================ */
// persistSession keeps the login in the phone's storage, so users stay signed in (like WhatsApp)
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = (id) => document.getElementById(id);

let me = null;               // auth user
let profiles = {};           // id -> profile
let messages = [];           // all my messages (ascending)
let statuses = [];           // statuses from the last 24h (ascending)
let activeId = null;         // open chat partner id
let online = new Set();      // ids currently online
let currentTab = 'chats';
let started = false;
let realtimeCh = null, presenceCh = null;
let statusViews = {};        // status_id -> [{viewer_id, viewed_at}] (only for my statuses)
let pruneTimer = null;
const DAY_MS = 24 * 3600 * 1000;
const alive = (s) => Date.now() - new Date(s.created_at).getTime() < DAY_MS;
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

/* ---------------- helpers ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameOf = (p) => p ? (p.full_name || p.username) : 'Unknown';
const initials = (p) => nameOf(p).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
function colorFor(id = '') {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 45%)`;
}
function avatar(p, cls = '') {
  if (p && p.avatar_url && canSee(p, 'photo')) return `<img class="avatar ${cls}" src="${esc(p.avatar_url)}" alt="">`;
  return `<div class="avatar ${cls}" style="background:${colorFor(p?.id)}">${esc(initials(p))}</div>`;
}
const timeStr = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function dayLabel(ts) {
  const d = new Date(ts), t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}
function listTime(ts) {
  const d = new Date(ts), l = dayLabel(ts);
  return l === 'Today' ? timeStr(ts) : l === 'Yesterday' ? l : d.toLocaleDateString();
}

/* ---------------- sounds (no audio files needed) ---------------- */
let ac = null;
const soundOn = () => localStorage.getItem('chat-sound') !== 'off';
function audio() {
  ac = ac || new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function tone(freq, start, dur, vol = 0.18) {
  try {
    const a = audio(), o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    o.connect(g); g.connect(a.destination);
    const t = a.currentTime + start;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  } catch (e) { /* audio blocked until first click */ }
}
const playReceive = () => { if (soundOn()) { tone(880, 0, 0.16); tone(1175, 0.16, 0.28); } };
const playSend = () => { if (soundOn()) tone(620, 0, 0.1, 0.1); };
// Browsers only allow sound after the user has interacted with the page
document.addEventListener('pointerdown', () => {
  try { audio(); } catch (e) {}
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(() => { if (me) registerPush(); });
}, { once: true });

/* ---------------- auth screen ---------------- */
let mode = 'login';
function setMode(m) {
  mode = m; hideOtp();
  $('tab-login').classList.toggle('active', m === 'login');
  $('tab-signup').classList.toggle('active', m === 'signup');
  $('signup-fields').classList.toggle('hidden', m !== 'signup');
  $('signup-confirm').classList.toggle('hidden', m !== 'signup');
  $('auth-submit').textContent = m === 'login' ? 'Log in' : 'Create account';
  $('f-password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  setAuthMsg('');
}
function setAuthMsg(t, ok = false) { const el = $('auth-msg'); el.textContent = t; el.classList.toggle('ok', ok); }
$('tab-login').onclick = () => setMode('login');
$('tab-signup').onclick = () => setMode('signup');

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const email = $('f-email').value.trim();
  const password = $('f-password').value;
  const btn = $('auth-submit');
  setAuthMsg('');
  btn.disabled = true;
  try {
    if (mode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const username = $('f-username').value.trim().toLowerCase();
      const full_name = $('f-name').value.trim();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error('Username: 3-20 letters, numbers or underscores.');
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');
      if (password !== $('f-password2').value) throw new Error('Passwords do not match.');
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username, full_name: full_name || username } } });
      if (error) throw error;
      if (!data.session) showOtp(email);   // account needs the 8-digit email code
    }
  } catch (err) {
    let m = err.message || 'Something went wrong.';
    if (/not confirmed/i.test(m)) {
      const r = await sb.auth.resend({ type: 'signup', email });
      if (!r.error) { showOtp(email); return; }
      m = r.error.message;
    }
    if (/database error/i.test(m)) m = 'That username is already taken. Try another one.';
    if (/already registered/i.test(m)) m = 'This email already has an account. Use the Log in tab.';
    if (/invalid login/i.test(m)) m = 'Wrong email or password.';
    setAuthMsg(m);
  } finally { btn.disabled = false; }
};

/* ---------------- email code (OTP) verification ---------------- */
let otpEmail = '', otpTimer = null;
function setOtpMsg(t, ok = false) { const el = $('otp-msg'); el.textContent = t; el.classList.toggle('ok', ok); }
function showOtp(email) {
  otpEmail = email;
  $('auth-form').classList.add('hidden'); $('auth-tabs').classList.add('hidden');
  $('otp-form').classList.remove('hidden');
  $('otp-email').textContent = email; $('f-otp').value = '';
  setOtpMsg('Code sent. Check your inbox (and spam).', true);
  cooldown(60); $('f-otp').focus();
}
function hideOtp() {
  clearInterval(otpTimer);
  $('otp-form').classList.add('hidden');
  $('auth-form').classList.remove('hidden'); $('auth-tabs').classList.remove('hidden');
}
function cooldown(sec) {            // stops people (and the email rate limit) from spamming "resend"
  const b = $('otp-resend'); clearInterval(otpTimer); b.disabled = true;
  const tick = () => { if (sec <= 0) { clearInterval(otpTimer); b.disabled = false; b.textContent = 'Resend code'; } else b.textContent = `Resend in ${sec--}s`; };
  tick(); otpTimer = setInterval(tick, 1000);
}
$('f-otp').oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8); };
$('otp-form').onsubmit = async (e) => {
  e.preventDefault();
  const token = $('f-otp').value.trim();
  if (!/^\d{8}$/.test(token)) return setOtpMsg('Enter the 8-digit code from your email.');
  const btn = $('otp-submit'); btn.disabled = true; setOtpMsg('');
  const { error } = await sb.auth.verifyOtp({ email: otpEmail, token, type: 'signup' });
  btn.disabled = false;
  if (error) return setOtpMsg(/expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Request a new one.' : error.message);
  // success: a session now exists, onAuthStateChange opens the app
};
$('otp-resend').onclick = async () => {
  setOtpMsg('');
  const { error } = await sb.auth.resend({ type: 'signup', email: otpEmail });
  if (error) return setOtpMsg(/rate|seconds/i.test(error.message) ? 'Too many emails sent. Please wait a few minutes and try again.' : error.message);
  setOtpMsg('A new code was sent.', true); cooldown(60);
};
$('otp-back').onclick = () => setMode('signup');

$('btn-logout').onclick = async () => { await unregisterPush(); await sb.auth.signOut(); };

sb.auth.onAuthStateChange((event, session) => {
  if (session && !started) { started = true; setTimeout(() => start(session.user), 0); }
  if (!session && started) { stop(); }
});
sb.auth.getSession().then(({ data }) => { if (!data.session) { $('splash').classList.add('hidden'); $('auth').classList.remove('hidden'); } });

/* ---------------- start / stop ---------------- */
async function start(user) {
  me = user;
  $('auth').classList.add('hidden'); $('splash').classList.add('hidden');
  $('app').classList.remove('hidden');
  await loadProfiles();
  if (checkBanned()) return;
  await Promise.all([loadMessages(), loadStatuses()]);
  renderAll();
  subscribe();
  initCalls();
  initExtras();
  registerPush();
  pruneTimer = setInterval(pruneStatuses, 60000);
}
function stop() {
  stopCalls(); stopExtras();
  started = false; me = null; profiles = {}; messages = []; statuses = []; activeId = null; statusViews = {}; clearInterval(pruneTimer);
  if (realtimeCh) sb.removeChannel(realtimeCh);
  if (presenceCh) sb.removeChannel(presenceCh);
  realtimeCh = presenceCh = null;
  document.title = 'ChatApp';
  $('app').classList.add('hidden');
  $('app').classList.remove('chat-open');
  $('conv').classList.add('hidden'); $('empty').classList.remove('hidden');
  $('auth').classList.remove('hidden');
  $('f-password').value = ''; $('f-password2').value = '';
  setMode('login');
}

/* ---------------- data loading ---------------- */
async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('*');
  if (error) return console.error(error);
  profiles = {}; data.forEach((p) => (profiles[p.id] = p));
  if (!profiles[me.id]) { // safety net if the signup trigger did not run
    const username = (me.user_metadata?.username || me.email.split('@')[0]).toLowerCase();
    const { data: p } = await sb.from('profiles').insert({ id: me.id, username, full_name: me.user_metadata?.full_name || username }).select().single();
    if (p) profiles[me.id] = p;
  }
}
async function loadMessages() {
  const { data, error } = await sb.from('messages').select('*').order('created_at', { ascending: true }).limit(3000);
  if (error) return console.error(error);
  messages = data;
}
async function loadStatuses() {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { data, error } = await sb.from('statuses').select('*').gte('created_at', since).order('created_at', { ascending: true });
  if (error) return console.error(error);
  statuses = data.filter(alive);
  if (me) { renderStatusPane(); loadViews(); }
}
function pruneStatuses() {           // runs every minute: status disappears 24h after posting
  const n = statuses.length; statuses = statuses.filter(alive);
  if (me && statuses.length !== n) renderStatusPane();
}
async function loadViews() {
  const ids = statuses.filter((s) => s.user_id === me.id).map((s) => s.id);
  statusViews = {};
  if (ids.length) {
    const { data } = await sb.from('status_views').select('*').in('status_id', ids);
    (data || []).forEach((v) => (statusViews[v.status_id] = statusViews[v.status_id] || []).push(v));
  }
  if (!$('status-viewer').classList.contains('hidden')) updateViewsBtn();
}

/* ---------------- realtime ---------------- */
function subscribe() {
  realtimeCh = sb.channel('db-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => onMessage(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => {
      const i = messages.findIndex((m) => m.id === p.new.id);
      if (i >= 0) { messages[i] = p.new; renderList(); if (activeId) renderMessages(false); }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'statuses' }, () => loadStatuses())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'status_views' }, () => loadViews())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (p) => {
      if (p.new && p.new.id) { profiles[p.new.id] = p.new; if (p.new.id === me.id && checkBanned()) return; renderAll(); if (activeId) openHeader(); }
    })
    .subscribe();

  presenceCh = sb.channel('online-users', { config: { presence: { key: me.id } } });
  presenceCh.on('presence', { event: 'sync' }, () => {
    online = new Set(Object.keys(presenceCh.presenceState()));
    if (activeId) openHeader();
  }).subscribe(async (s) => { if (s === 'SUBSCRIBED') await presenceCh.track({ at: Date.now() }); });
}

function onMessage(m) {
  if (messages.some((x) => x.id === m.id)) return;
  messages.push(m);
  const incoming = m.receiver_id === me.id;
  if (incoming) {
    const viewing = activeId === m.sender_id && !document.hidden;
    if (viewing) markRead(m.sender_id);
    if (!parseCall(m) && S().notif.messages) { playReceive(); if (!viewing) desktopNotify(m); }
  }
  renderList();
  if (activeId && (m.sender_id === activeId || m.receiver_id === activeId)) renderMessages(true);
  updateTitle();
}
function desktopNotify(m) {
  if (!S().notif.desktop) return;
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const p = profiles[m.sender_id];
  try { new Notification(nameOf(p), { body: previewText(m), icon: p?.avatar_url || undefined }); } catch (e) {}
}
function unreadCount(from) {
  return messages.filter((m) => m.receiver_id === me.id && !m.read && (!from || m.sender_id === from)).length;
}
function updateTitle() {
  const n = unreadCount();
  document.title = n ? `(${n}) ChatApp` : 'ChatApp';
  const b = $('unread-total'); b.textContent = n; b.classList.toggle('hidden', !n);
}
async function markRead(otherId) {
  const ids = messages.filter((m) => m.sender_id === otherId && m.receiver_id === me.id && !m.read);
  if (!ids.length) return;
  ids.forEach((m) => (m.read = true));
  await sb.from('messages').update({ read: true }).eq('sender_id', otherId).eq('receiver_id', me.id).eq('read', false);
  renderList(); updateTitle();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && activeId && me) markRead(activeId); });

/* ---------------- rendering: shell ---------------- */
function renderAll() {
  $('me-avatar').innerHTML = avatar(profiles[me.id], 'sm');
  renderList(); renderStatusPane(); renderProfilePane(); updateTitle();
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
function switchTab(t) {
  currentTab = t;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  $('chat-search').classList.toggle('hidden', t !== 'chats');
  ['chats', 'status', 'profile', 'settings'].forEach((x) => $('pane-' + x).classList.toggle('hidden', x !== t));
}
$('me-avatar').onclick = () => switchTab('profile');

/* ---------------- rendering: chat list ---------------- */
function conversations() {
  const map = {};
  for (const m of messages) {
    const other = m.sender_id === me.id ? m.receiver_id : m.sender_id;
    map[other] = map[other] || { id: other, unread: 0 };
    map[other].last = m;
    if (m.receiver_id === me.id && !m.read) map[other].unread++;
  }
  return Object.values(map).sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));
}
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const list = conversations().filter((c) => {
    const p = profiles[c.id]; return !q || (nameOf(p) + ' ' + (p?.username || '')).toLowerCase().includes(q);
  });
  $('chat-list').innerHTML = list.length ? list.map((c) => {
    const p = profiles[c.id], m = c.last, mine = m.sender_id === me.id;
    const tick = mine ? tickHtml(m) + ' ' : '';
    return `<button class="item ${c.id === activeId ? 'active' : ''}" data-id="${c.id}">
      ${avatar(p)}
      <div class="body">
        <div class="top"><span class="name">${esc(nameOf(p))}${vb(p)}</span><span class="time ${c.unread ? 'unread' : ''}">${listTime(m.created_at)}</span></div>
        <div class="bottom"><span class="preview">${tick}${esc(previewText(m))}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</div>
      </div></button>`;
  }).join('') : `<div class="empty-note">${q ? 'No chats match your search.' : 'No chats yet.<br>Tap ＋ at the top to message someone.'}</div>`;
  $('chat-list').querySelectorAll('.item').forEach((b) => (b.onclick = () => openChat(b.dataset.id)));
}
$('search').oninput = renderList;

/* ---------------- rendering: conversation ---------------- */
function openChat(id) {
  activeId = id;
  $('empty').classList.add('hidden'); $('conv').classList.remove('hidden');
  $('app').classList.add('chat-open');
  closeModal('modal-contacts');
  applyTheme(id); openHeader(); renderMessages(true); markRead(id); renderList();
  if (!isMobile()) $('msg-input').focus();
}
function openHeader() {
  const p = profiles[activeId];
  $('conv-avatar').innerHTML = avatar(p, 'sm');
  $('conv-name').innerHTML = esc(nameOf(p)) + vb(p);
  $('conv-sub').textContent = online.has(activeId) && canSee(p, 'online') ? 'online' : '@' + (p?.username || '');
}
function renderMessages(scroll) {
  const box = $('messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const msgs = messages.filter((m) => m.sender_id === activeId || m.receiver_id === activeId);
  let html = '', lastDay = '';
  for (const m of msgs) {
    const d = dayLabel(m.created_at);
    if (d !== lastDay) { html += `<div class="day">${d}</div>`; lastDay = d; }
    const mine = m.sender_id === me.id;
    const tick = mine ? tickHtml(m) : '';
    html += msgHtml(m, mine, tick);
  }
  box.innerHTML = html;
  if (scroll || nearBottom) box.scrollTop = box.scrollHeight;
}
$('btn-back').onclick = () => { activeId = null; $('app').classList.remove('chat-open'); $('conv').classList.add('hidden'); $('empty').classList.remove('hidden'); renderList(); };

/* ---------------- sending ---------------- */
const input = $('msg-input');
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && S().chats.enterSend && !isMobile()) { e.preventDefault(); $('composer').requestSubmit(); }
});
$('composer').onsubmit = async (e) => {
  e.preventDefault();
  const content = input.value.trim();
  if (!content || !activeId) return;
  input.value = ''; input.style.height = 'auto';
  const { data, error } = await sb.from('messages').insert({ receiver_id: activeId, content }).select().single();
  if (error) { alert('Message not sent: ' + error.message); input.value = content; return; }
  if (!messages.some((m) => m.id === data.id)) messages.push(data);
  playSend(); renderList(); renderMessages(true);
};

/* ---------------- new chat (contacts) ---------------- */
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => b.closest('.modal').classList.add('hidden')));
$('btn-new').onclick = () => { $('contact-search').value = ''; renderContacts(); openModal('modal-contacts'); $('contact-search').focus(); };
$('contact-search').oninput = renderContacts;
function renderContacts() {
  const q = $('contact-search').value.trim().toLowerCase();
  const list = Object.values(profiles).filter((p) => p.id !== me.id && (!q || (nameOf(p) + ' ' + p.username).toLowerCase().includes(q)))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  $('contact-list').innerHTML = list.length ? list.map((p) => `
    <button class="item" data-id="${p.id}">${avatar(p)}
      <div class="body"><div class="top"><span class="name">${esc(nameOf(p))}${vb(p)}</span></div>
      <div class="bottom"><span class="preview">${esc(canSee(p, 'about') ? (p.about || '') : '')}</span></div></div></button>`).join('')
    : '<div class="empty-note">No other users found yet.<br>Ask a friend to sign up!</div>';
  $('contact-list').querySelectorAll('.item').forEach((b) => (b.onclick = () => openChat(b.dataset.id)));
}

/* ---------------- status ---------------- */
const STATUS_COLORS = ['#00a884', '#128c7e', '#7c4dff', '#e53935', '#f9a825', '#1e88e5', '#111b21'];
let statusBg = STATUS_COLORS[0], statusFile = null;

function groupStatuses() {
  const g = {};
  statuses.forEach((s) => (g[s.user_id] = g[s.user_id] || []).push(s));
  return g;
}
function renderStatusPane() {
  const g = groupStatuses(), mine = g[me.id] || [];
  const others = Object.keys(g).filter((id) => id !== me.id)
    .sort((a, b) => new Date(g[b].at(-1).created_at) - new Date(g[a].at(-1).created_at));
  $('pane-status').innerHTML = `
    <button class="item" id="my-status">
      <div class="ring ${mine.length ? '' : 'none'}">${avatar(profiles[me.id])}</div>
      <div class="body"><div class="top"><span class="name">My status</span></div>
      <div class="bottom"><span class="preview">${mine.length ? `${mine.length} update${mine.length > 1 ? 's' : ''} · ${listTime(mine.at(-1).created_at)}` : 'Tap to view your status'}</span></div></div>
    </button>
    <div class="status-actions"><button id="add-text">✏️ Text status</button><button id="add-photo">📷 Photo status</button></div>
    <div class="section-title">Recent updates</div>
    ${others.length ? others.map((id) => `
      <button class="item" data-uid="${id}">
        <div class="ring">${avatar(profiles[id])}</div>
        <div class="body"><div class="top"><span class="name">${esc(nameOf(profiles[id]))}${vb(profiles[id])}</span></div>
        <div class="bottom"><span class="preview">${listTime(g[id].at(-1).created_at)}</span></div></div>
      </button>`).join('') : '<div class="empty-note">No recent updates from your contacts.</div>'}`;
  $('my-status').onclick = () => (mine.length ? openViewer(me.id) : openComposer());
  $('add-text').onclick = () => openComposer();
  $('add-photo').onclick = () => { openComposer(); $('status-file').click(); };
  $('pane-status').querySelectorAll('[data-uid]').forEach((b) => (b.onclick = () => openViewer(b.dataset.uid)));
}

function openComposer() {
  statusFile = null; $('status-text').value = ''; $('status-msg').textContent = '';
  $('status-img').classList.add('hidden'); $('status-preview').classList.remove('has-img');
  setStatusBg(STATUS_COLORS[0]); openModal('modal-status');
}
function setStatusBg(c) {
  statusBg = c; $('status-preview').style.background = c;
  $('status-colors').querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.c === c));
}
$('status-colors').innerHTML = STATUS_COLORS.map((c) => `<button type="button" data-c="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('');
$('status-colors').querySelectorAll('button').forEach((b) => (b.onclick = () => setStatusBg(b.dataset.c)));
$('status-file').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > 5 * 1024 * 1024) { $('status-msg').textContent = 'Photo must be under 5 MB.'; return; }
  statusFile = f;
  const img = $('status-img'); img.src = URL.createObjectURL(f); img.classList.remove('hidden');
  $('status-preview').classList.add('has-img'); e.target.value = '';
};
$('status-post').onclick = async () => {
  const content = $('status-text').value.trim();
  if (!content && !statusFile) { $('status-msg').textContent = 'Write something or add a photo.'; return; }
  const btn = $('status-post'); btn.disabled = true; $('status-msg').textContent = '';
  try {
    let image_url = null;
    if (statusFile) {
      const ext = (statusFile.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${me.id}/${Date.now()}.${ext}`;
      const { error } = await sb.storage.from('statuses').upload(path, statusFile, { contentType: statusFile.type });
      if (error) throw error;
      image_url = sb.storage.from('statuses').getPublicUrl(path).data.publicUrl;
    }
    const { error } = await sb.from('statuses').insert({ content: content || null, image_url, bg: statusBg });
    if (error) throw error;
    closeModal('modal-status'); await loadStatuses();
  } catch (err) { $('status-msg').textContent = err.message; }
  finally { btn.disabled = false; }
};

/* status viewer */
let sv = { list: [], i: 0, timer: null };
function openViewer(uid) {
  sv.list = statuses.filter((s) => s.user_id === uid); sv.i = 0;
  if (!sv.list.length) return;
  $('status-viewer').classList.remove('hidden'); showStatus();
}
function showStatus() {
  clearTimeout(sv.timer);
  const s = sv.list[sv.i], p = profiles[s.user_id];
  $('sv-bars').innerHTML = sv.list.map((_, i) => `<span class="${i < sv.i ? 'done' : ''}"><i></i></span>`).join('');
  $('sv-avatar').innerHTML = avatar(p, 'sm');
  $('sv-name').textContent = s.user_id === me.id ? 'My status' : nameOf(p);
  $('sv-time').textContent = listTime(s.created_at) === timeStr(s.created_at) ? 'Today, ' + timeStr(s.created_at) : listTime(s.created_at) + ', ' + timeStr(s.created_at);
  $('sv-delete').classList.toggle('hidden', s.user_id !== me.id);
  trackView(s); hideViewers(); updateViewsBtn();
  const body = $('sv-body');
  if (s.image_url) {
    body.style.background = '#000';
    body.innerHTML = `<img src="${esc(s.image_url)}" alt="">${s.content ? `<div class="cap">${esc(s.content)}</div>` : ''}`;
  } else { body.style.background = s.bg || '#00a884'; body.textContent = s.content; }
  requestAnimationFrame(() => requestAnimationFrame(() => { const bar = $('sv-bars').children[sv.i]; if (bar) bar.classList.add('run'); }));
  sv.timer = setTimeout(nextStatus, 5000);
}
function nextStatus() { if (sv.i < sv.list.length - 1) { sv.i++; showStatus(); } else closeViewer(); }
function prevStatus() { if (sv.i > 0) sv.i--; showStatus(); }
function closeViewer() { clearTimeout(sv.timer); $('status-viewer').classList.add('hidden'); }
$('sv-next').onclick = nextStatus; $('sv-prev').onclick = prevStatus; $('sv-close').onclick = closeViewer;
$('sv-delete').onclick = async () => {
  const s = sv.list[sv.i]; if (!s || !confirm('Delete this status?')) return;
  await sb.from('statuses').delete().eq('id', s.id);
  closeViewer(); loadStatuses();
};
document.addEventListener('keydown', (e) => {
  if ($('status-viewer').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeViewer(); if (e.key === 'ArrowRight') nextStatus(); if (e.key === 'ArrowLeft') prevStatus();
});

/* ---------------- profile ---------------- */
function renderProfilePane() {
  const p = profiles[me.id]; if (!p) return;
  $('pane-profile').innerHTML = `
    <div class="profile">
      <label class="avatar-edit" title="Change profile photo">${avatar(p, 'xl')}<span class="cam">📷</span><input id="avatar-file" type="file" accept="image/*" hidden></label>
      <div class="field"><label>Your name</label><input id="p-name" value="${esc(p.full_name || '')}" maxlength="40"></div>
      <div class="field"><label>About</label><input id="p-about" value="${esc(p.about || '')}" maxlength="100"></div>
      <div class="field"><label>Username</label><input value="@${esc(p.username)}" disabled></div>
      <div class="field"><label>Email</label><input value="${esc(me.email)}" disabled></div>
      <label class="switch">Notification sounds <input id="p-sound" type="checkbox" ${soundOn() ? 'checked' : ''}></label>
      <p id="p-msg" class="auth-msg"></p>
      <button id="p-save" class="primary">Save profile</button>
    </div>`;
  $('p-sound').onchange = (e) => { localStorage.setItem('chat-sound', e.target.checked ? 'on' : 'off'); if (e.target.checked) playReceive(); };
  $('p-save').onclick = async () => {
    const full_name = $('p-name').value.trim(), about = $('p-about').value.trim();
    const { error } = await sb.from('profiles').update({ full_name: full_name || p.username, about }).eq('id', me.id);
    const msg = $('p-msg');
    msg.textContent = error ? error.message : 'Saved.'; msg.classList.toggle('ok', !error);
    if (!error) { profiles[me.id] = { ...p, full_name: full_name || p.username, about }; $('me-avatar').innerHTML = avatar(profiles[me.id], 'sm'); }
  };
  $('avatar-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const msg = $('p-msg'); msg.classList.remove('ok');
    if (f.size > 3 * 1024 * 1024) { msg.textContent = 'Picture must be under 3 MB.'; return; }
    msg.textContent = 'Uploading…';
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${me.id}/avatar-${Date.now()}.${ext}`;
    const up = await sb.storage.from('avatars').upload(path, f, { contentType: f.type });
    if (up.error) { msg.textContent = up.error.message; return; }
    const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    const { error } = await sb.from('profiles').update({ avatar_url: url }).eq('id', me.id);
    if (error) { msg.textContent = error.message; return; }
    profiles[me.id].avatar_url = url; renderAll(); switchTab('profile');
    $('p-msg').textContent = 'Profile picture updated.'; $('p-msg').classList.add('ok');
  };
}

/* ============================================================
   UPDATE 1: media messages (photo, video, audio/music, voice note)
   ============================================================ */
const MAX_MEDIA = 25 * 1024 * 1024; // 25 MB
const kindOf = (f) => /^image\//.test(f.type) ? 'image' : /^video\//.test(f.type) ? 'video'
  : (/^audio\//.test(f.type) || /\.(mp3|m4a|wav|ogg|aac|flac|opus)$/i.test(f.name)) ? 'audio' : null;

function previewText(m) {
  const cl = parseCall(m);
  if (cl) return (cl.kind === 'video' ? '📹 ' : '📞 ') + callLabel(cl, m.sender_id === me.id).title;
  const icon = { image: '📷 Photo', video: '🎥 Video', audio: '🎵 Audio', voice: '🎤 Voice note' }[m.media_type];
  return icon ? icon + (m.content ? ' ' + m.content : '') : (m.content || '');
}
function msgHtml(m, mine, tick) {
  const side = mine ? 'out' : 'in';
  const meta = `<span class="meta">${timeStr(m.created_at)}${tick}</span>`;
  const cl = parseCall(m);
  if (cl) {
    const v = callLabel(cl, mine);
    return `<div class="bubble callmsg ${side}${v.missed ? ' missed' : ''}" data-call="${cl.kind}" title="Tap to call back"><span class="ci">${cl.kind === 'video' ? '📹' : '📞'}</span><div class="t"><b>${v.title}</b><small>${v.sub}</small></div><span class="meta">${timeStr(m.created_at)}</span></div>`;
  }
  if (!m.media_url) return `<div class="bubble ${side}">${esc(m.content)}${meta}</div>`;
  const u = esc(m.media_url);
  let media;
  if (m.media_type === 'image') media = `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" loading="lazy" alt="Photo"></a>`;
  else if (m.media_type === 'video') media = `<video src="${u}" controls preload="metadata" playsinline></video>`;
  else media = `${m.media_type === 'audio' && m.media_name ? `<div class="fname">🎵 ${esc(m.media_name)}</div>` : ''}<audio src="${u}" controls preload="none"></audio>`;
  return `<div class="bubble media ${side}">${media}<div class="cap">${m.content ? esc(m.content) : ''}${meta}</div></div>`;
}
async function sendMedia(file, kind, caption = '') {
  if (!activeId) return;
  if (!kind) return alert('Only photos, videos and audio files can be sent.');
  if (file.size > MAX_MEDIA) return alert(`"${file.name}" is bigger than 25 MB.`);
  const to = activeId;
  $('conv-sub').textContent = 'sending…';
  try {
    const ext = ((file.name.split('.').pop() || 'bin').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'bin';
    const path = `${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const up = await sb.storage.from('chat-media').upload(path, file, { contentType: file.type || undefined });
    if (up.error) throw up.error;
    const media_url = sb.storage.from('chat-media').getPublicUrl(path).data.publicUrl;
    const { data, error } = await sb.from('messages').insert({
      receiver_id: to, content: caption || null, media_url, media_type: kind, media_name: kind === 'voice' ? null : file.name
    }).select().single();
    if (error) throw error;
    if (!messages.some((x) => x.id === data.id)) messages.push(data);
    playSend(); renderList(); if (activeId === to) renderMessages(true);
  } catch (err) { alert('Not sent: ' + err.message); }
  finally { if (activeId) openHeader(); }
}
$('attach-file').onchange = async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  let caption = input.value.trim(); input.value = ''; input.style.height = 'auto';
  for (const f of files) { await sendMedia(f, kindOf(f), caption); caption = ''; }
};

/* voice notes */
let rec = null;
async function startRec() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return alert('Voice notes are not supported on this browser (the site must also be opened over https).');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { return alert('Please allow microphone access to record voice notes.'); }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const r = rec = { mr, stream, chunks: [], t0: Date.now(), cancel: false };
  mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
  mr.onstop = async () => {
    clearInterval(r.timer); stream.getTracks().forEach((t) => t.stop());
    $('rec-bar').classList.add('hidden'); $('composer').classList.remove('hidden'); rec = null;
    if (r.cancel || !r.chunks.length) return;
    const type = (mr.mimeType || mime || 'audio/webm').split(';')[0];
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    await sendMedia(new File([new Blob(r.chunks, { type })], `voice.${ext}`, { type }), 'voice');
  };
  mr.start();
  $('composer').classList.add('hidden'); $('rec-bar').classList.remove('hidden');
  const tick = () => { const s = Math.floor((Date.now() - r.t0) / 1000); $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  tick(); r.timer = setInterval(tick, 500);
}
$('btn-rec').onclick = startRec;
$('rec-send').onclick = () => rec && rec.mr.stop();
$('rec-cancel').onclick = () => { if (rec) { rec.cancel = true; rec.mr.stop(); } };

/* ============================================================
   UPDATE 2: status views (who actually watched my status)
   ============================================================ */
const viewedNow = new Set();
function trackView(s) {
  if (s.user_id === me.id || viewedNow.has(s.id)) return;
  viewedNow.add(s.id);
  sb.from('status_views').upsert({ status_id: s.id, viewer_id: me.id }, { onConflict: 'status_id,viewer_id', ignoreDuplicates: true })
    .then(({ error }) => { if (error) { viewedNow.delete(s.id); console.error(error); } });
}
function updateViewsBtn() {
  const s = sv.list[sv.i], btn = $('sv-views');
  const mine = s && s.user_id === me.id;
  btn.classList.toggle('hidden', !mine);
  if (mine) btn.textContent = '👁 ' + (statusViews[s.id]?.length || 0);
}
function hideViewers() { $('sv-viewers').classList.add('hidden'); }
$('sv-views').onclick = () => {
  const s = sv.list[sv.i]; if (!s) return;
  const list = [...(statusViews[s.id] || [])].sort((a, b) => new Date(b.viewed_at) - new Date(a.viewed_at));
  clearTimeout(sv.timer);
  $('sv-viewers').innerHTML = `<div class="vh"><span>Viewed by ${list.length}</span><button id="sv-vclose" aria-label="Close">✕</button></div>` +
    (list.length ? list.map((v) => `<div class="item">${avatar(profiles[v.viewer_id], 'sm')}<div class="body"><div class="top"><span class="name">${esc(nameOf(profiles[v.viewer_id]))}</span><span class="time">${listTime(v.viewed_at)}, ${timeStr(v.viewed_at)}</span></div></div></div>`).join('')
      : '<div class="empty-note">No one has viewed this yet.</div>');
  $('sv-viewers').classList.remove('hidden');
  $('sv-vclose').onclick = () => { hideViewers(); showStatus(); };
};

/* ============================================================
   UPDATE 3: chat themes (saved per chat on this device)
   ============================================================ */
const THEMES = [
  { id: 'default',  name: 'Classic',  bg: '#efeae2', out: '#d9fdd3', in: '#ffffff', text: '#111b21', dots: 'rgba(11,20,26,.055)' },
  { id: 'dark',     name: 'Dark',     bg: '#0b141a', out: '#005c4b', in: '#202c33', text: '#e9edef', dots: 'rgba(255,255,255,.05)', dark: 1 },
  { id: 'midnight', name: 'Midnight', bg: '#10152b', out: '#3a3f91', in: '#1d2347', text: '#eef0ff', dots: 'rgba(255,255,255,.05)', dark: 1 },
  { id: 'ocean',    name: 'Ocean',    bg: '#d6ecf7', out: '#a7d8f5', in: '#ffffff', text: '#0d2b3a', dots: 'rgba(13,43,58,.07)' },
  { id: 'forest',   name: 'Forest',   bg: '#dcebd9', out: '#b7e1b0', in: '#ffffff', text: '#14301a', dots: 'rgba(20,48,26,.07)' },
  { id: 'sunset',   name: 'Sunset',   bg: '#fde4d0', out: '#ffc9a3', in: '#ffffff', text: '#3a1d0b', dots: 'rgba(58,29,11,.07)' },
  { id: 'lavender', name: 'Lavender', bg: '#e8e0f5', out: '#cdb9f2', in: '#ffffff', text: '#24163f', dots: 'rgba(36,22,63,.07)' },
  { id: 'rose',     name: 'Rose',     bg: '#fbe1e8', out: '#f7b9cb', in: '#ffffff', text: '#3f1020', dots: 'rgba(63,16,32,.07)' },
];
const themeKey = (id) => `chat-theme:${me.id}:${id}`;
const themeOf = (id) => THEMES.find((t) => t.id === localStorage.getItem(themeKey(id))) || THEMES.find((t) => t.id === S().chats.theme) || THEMES[0];
function applyTheme(id) {
  const t = themeOf(id), s = $('conv').style;
  s.setProperty('--bg-chat', t.bg); s.setProperty('--bubble-out', t.out); s.setProperty('--bubble-in', t.in);
  s.setProperty('--bub-text', t.text); s.setProperty('--dots', t.dots);
}
$('btn-theme').onclick = () => {
  const cur = themeOf(activeId).id;
  $('theme-list').innerHTML = THEMES.map((t) => `<button class="theme ${t.dark ? 'dark' : ''} ${t.id === cur ? 'sel' : ''}" data-t="${t.id}" style="background:${t.bg}">
    <i style="background:${t.in}"></i><i class="o" style="background:${t.out}"></i><b>${t.name}</b></button>`).join('');
  $('theme-list').querySelectorAll('.theme').forEach((b) => (b.onclick = () => {
    localStorage.setItem(themeKey(activeId), b.dataset.t); applyTheme(activeId); closeModal('modal-theme');
  }));
  openModal('modal-theme');
};

/* ============================================================
   UPDATE 4: keep layout correct when the phone keyboard opens
   ============================================================ */
if (window.visualViewport) {
  const fit = () => document.documentElement.style.setProperty('--app-h', window.visualViewport.height + 'px');
  window.visualViewport.addEventListener('resize', fit); fit();
}

/* ============================================================
   UPDATE 5: voice + video calls (WebRTC, signalling over Supabase Realtime)
   - no new tables: the call history is saved as a special chat message
   - put TURN servers in config.js (window.ICE_SERVERS) so calls work on every network
   ============================================================ */
const ICE_SERVERS = (window.ICE_SERVERS && window.ICE_SERVERS.length) ? window.ICE_SERVERS
  : [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const RING_MS = 45000;
const RESEND_MS = 2500;      // keep re-sending the invite until the other phone answers 'ringing'
const endedCalls = new Set();  // call ids that are over (so a late/duplicate invite never rings again)
const CALL_RE = /^\[\[call:(audio|video):(ended|missed|declined)(?::(\d+))?\]\]$/;
const END_TEXT = { hangup: 'Call ended', cancel: 'Call cancelled', decline: 'Call declined', busy: 'User is busy', timeout: 'No answer', failed: 'Connection lost' };
let call = null;            // the one call in progress (ringing or live)
let callInbox = null;       // my channel: other people send me signals here
let hideTimer = null, ringLoop = null;
const callOut = {};         // peerId -> Promise<channel> used to send signals to that person
const callOutCh = {};

/* ---- call history lines shown inside the chat ---- */
const parseCall = (m) => { const x = CALL_RE.exec((m && m.content) || ''); return x ? { kind: x[1], status: x[2], secs: +x[3] || 0 } : null; };
function fmtDur(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
}
function callLabel(cl, mine) {
  const k = cl.kind === 'video' ? 'video call' : 'voice call', cap = k[0].toUpperCase() + k.slice(1);
  if (cl.status === 'ended') return { title: cap, sub: (mine ? '↗ ' : '↙ ') + fmtDur(cl.secs), missed: false };
  if (mine) return { title: cap, sub: '↗ ' + (cl.status === 'declined' ? 'Declined' : 'No answer'), missed: false };
  return { title: 'Missed ' + k, sub: '↙ Tap to call back', missed: true };
}
async function logCall(c, status, secs) {      // only the caller writes it, so it appears once in both chats
  const content = `[[call:${c.kind}:${status}${status === 'ended' ? ':' + secs : ''}]]`;
  const { data, error } = await sb.from('messages').insert({ receiver_id: c.peerId, content }).select().single();
  if (error) return console.error(error);
  if (!messages.some((x) => x.id === data.id)) messages.push(data);
  renderList(); if (activeId === c.peerId) renderMessages(true);
}
$('messages').addEventListener('click', (e) => {   // tap a call line to call back
  const b = e.target.closest('[data-call]'); if (b) startCall(b.dataset.call);
});

/* ---- signalling ---- */
function sigChannel(peerId) {
  const old = callOutCh[peerId];
  if (old && (old.state === 'closed' || old.state === 'errored')) { try { sb.removeChannel(old); } catch (e) {} delete callOut[peerId]; delete callOutCh[peerId]; }
  if (!callOut[peerId]) {
    const ch = callOutCh[peerId] = sb.channel('calls-in:' + peerId, { config: { broadcast: { self: false } } });
    callOut[peerId] = new Promise((res, rej) => ch.subscribe((s) => {
      if (s === 'SUBSCRIBED') res(ch);
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { delete callOut[peerId]; rej(new Error(s)); }
    }));
  }
  return callOut[peerId];
}
async function signal(peerId, event, payload = {}) {
  try {
    const ch = await sigChannel(peerId);
    await ch.send({ type: 'broadcast', event, payload: { ...payload, from: me.id } });
  } catch (e) { console.error('call signal failed', e); }
}
function initCalls() {
  callInbox = sb.channel('calls-in:' + me.id, { config: { broadcast: { self: false } } });
  ['invite', 'ringing', 'answer', 'ice', 'cam', 'end'].forEach((ev) =>
    callInbox.on('broadcast', { event: ev }, ({ payload }) => onSignal(ev, payload)));
  callInbox.subscribe();
}
function stopCalls() {
  if (call) endCall(call.startedAt ? 'hangup' : call.dir === 'out' ? 'cancel' : 'decline');
  if (callInbox) sb.removeChannel(callInbox);
  Object.values(callOutCh).forEach((ch) => sb.removeChannel(ch));
  callInbox = null; Object.keys(callOut).forEach((k) => { delete callOut[k]; delete callOutCh[k]; });
}
async function onSignal(ev, p) {
  if (!p || !me || p.from === me.id) return;
  if (ev === 'end') endedCalls.add(p.callId);
  if (ev === 'invite') {
    if (endedCalls.has(p.callId)) return;
    if (call && call.id === p.callId) { if (call.dir === 'in' && !call.accepted) signal(p.from, 'ringing', { callId: p.callId }); return; }
    if (call) return signal(p.from, 'end', { callId: p.callId, reason: 'busy' });
    if (isBlocked(p.from)) return;
    return ringIncoming(p);
  }
  if (!call || call.id !== p.callId || call.peerId !== p.from) return;
  const c = call;
  if (ev === 'ringing') { c.ringing = true; if (c.dir === 'out' && !c.answered) setCallStatus('Ringing…'); }
  else if (ev === 'answer' && c.dir === 'out' && c.pc && !c.answered) {
    c.answered = true; stopRing(); setCallStatus('Connecting…');
    try { await c.pc.setRemoteDescription(p.sdp); drainIce(c); } catch (e) { console.error(e); endCall('failed'); }
  }
  else if (ev === 'ice') { if (c.pc && c.pc.remoteDescription) c.pc.addIceCandidate(p.candidate).catch(() => {}); else c.pendingIce.push(p.candidate); }
  else if (ev === 'cam') $('call').classList.toggle('remote-cam-off', !p.on);
  else if (ev === 'end') endCall(p.reason || 'hangup', false);
}
const drainIce = (c) => c.pendingIce.splice(0).forEach((x) => c.pc.addIceCandidate(x).catch(() => {}));

/* ---- ringtones (generated, no audio files) ---- */
function startRing(incoming) {
  stopRing();
  const once = () => {
    if (incoming) {
      if (S().notif.ringtone) { tone(740, 0, .25, .25); tone(988, .3, .25, .25); tone(740, .9, .25, .25); tone(988, 1.2, .25, .25); }
      try { if (S().notif.vibrate) navigator.vibrate && navigator.vibrate([700, 300, 700]); } catch (e) {}
    } else tone(440, 0, 1.0, .08);       // ringback tone for the caller
  };
  once(); ringLoop = setInterval(once, incoming ? 3000 : 3500);
}
function stopRing() { clearInterval(ringLoop); ringLoop = null; try { navigator.vibrate && navigator.vibrate(0); } catch (e) {} }

/* ---- media + peer connection ---- */
const getMedia = (kind, facing) => navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: kind === 'video' ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false
});
function mediaErr(e) {
  if (e && e.name === 'NotAllowedError') return 'Please allow microphone and camera access to make calls.';
  if (e && e.name === 'NotFoundError') return 'No microphone or camera was found on this device.';
  return 'Could not start the call: ' + ((e && e.message) || e);
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
function newCall(o) { return { pendingIce: [], outIce: [], ready: false, startedAt: 0, muted: false, camOff: false, facing: 'user', ...o }; }

function buildPc(c) {
  const pc = c.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 });
  c.stream.getTracks().forEach((t) => pc.addTrack(t, c.stream));
  c.remote = new MediaStream();
  pc.ontrack = (e) => {
    c.remote.addTrack(e.track);
    const v = $('call-remote'); v.srcObject = c.remote;
    v.play().catch(() => { const go = () => { v.play().catch(() => {}); }; document.addEventListener('pointerdown', go, { once: true }); });
  };
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    const cand = e.candidate.toJSON();
    if (c.ready) signal(c.peerId, 'ice', { callId: c.id, candidate: cand }); else c.outIce.push(cand);
  };
  pc.onconnectionstatechange = () => {
    if (call !== c) return;
    const s = pc.connectionState;
    clearTimeout(c.dcTimer);
    if (s === 'connected') { if (!c.startedAt) onConnected(c); }
    else if (s === 'failed') endCall('failed');
    else if (s === 'disconnected') c.dcTimer = setTimeout(() => { if (call === c && pc.connectionState !== 'connected') endCall('failed'); }, 8000);
  };
}
function flushOut(c) {          // candidates found before the invite/answer was sent
  c.ready = true; c.outIce.splice(0).forEach((x) => signal(c.peerId, 'ice', { callId: c.id, candidate: x }));
}
function onConnected(c) {
  c.startedAt = Date.now(); stopRing(); clearTimeout(c.ringTimer);
  $('call').classList.add('live'); $('call').classList.remove('incoming');
  const tick = () => setCallStatus(fmtDur(Math.round((Date.now() - c.startedAt) / 1000)));
  tick(); c.timer = setInterval(tick, 1000);
  try { navigator.wakeLock && navigator.wakeLock.request('screen').then((w) => (c.wake = w)).catch(() => {}); } catch (e) {}
}

/* ---- starting / answering ---- */
async function startCall(kind) {
  if (!activeId) return;
  if (call) return alert('You are already on a call.');
  if (isBlocked(activeId)) return alert('Unblock this contact to call them.');
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return alert('Calls are not supported on this browser (the site must also be opened over https).');
  const c = call = newCall({ id: uid(), peerId: activeId, kind, dir: 'out' });
  showCallUI();
  try { c.stream = await getMedia(kind, c.facing); }
  catch (e) { if (call === c) cleanupCall(''); return alert(mediaErr(e)); }
  if (call !== c) { c.stream.getTracks().forEach((t) => t.stop()); return; }   // cancelled while the permission prompt was open
  attachLocal(c);
  try {
    buildPc(c);
    const offer = await c.pc.createOffer(); await c.pc.setLocalDescription(offer);
    if (call !== c) return;
    c.invite = { callId: c.id, kind, sdp: { type: offer.type, sdp: offer.sdp } };
    await signal(c.peerId, 'invite', c.invite);
    c.invited = true; flushOut(c); startRing(false);
    pushCall(c.peerId, c, 'invite');                       // wakes the other phone if the app is closed
    c.resend = setInterval(() => { if (call === c && !c.ringing && !c.answered && !c.startedAt) signal(c.peerId, 'invite', c.invite); }, RESEND_MS);
    if (!online.has(c.peerId)) setCallStatus('Calling… (not online right now)');
    c.ringTimer = setTimeout(() => { if (call === c && !c.startedAt) endCall('timeout'); }, RING_MS);
  } catch (e) { console.error(e); if (call === c) endCall('failed'); }
}
function ringIncoming(p) {
  const c = call = newCall({ id: p.callId, peerId: p.from, kind: p.kind === 'video' ? 'video' : 'audio', dir: 'in', offer: p.sdp });
  signal(c.peerId, 'ringing', { callId: c.id });
  showCallUI(); startRing(true);
  c.ringTimer = setTimeout(() => { if (call === c && !c.accepted) endCall('timeout', false); }, RING_MS);
  notifyCall(c);
}
async function acceptCall() {
  const c = call; if (!c || c.dir !== 'in' || c.accepted) return;
  c.accepted = true; stopRing(); clearTimeout(c.ringTimer);
  $('call').classList.remove('incoming'); setCallStatus('Connecting…');
  try { c.stream = await getMedia(c.kind, c.facing); }
  catch (e) { if (call === c) endCall('decline'); return alert(mediaErr(e)); }
  if (call !== c) { c.stream.getTracks().forEach((t) => t.stop()); return; }
  attachLocal(c);
  try {
    buildPc(c);
    await c.pc.setRemoteDescription(c.offer); drainIce(c);
    const ans = await c.pc.createAnswer(); await c.pc.setLocalDescription(ans);
    await signal(c.peerId, 'answer', { callId: c.id, sdp: { type: ans.type, sdp: ans.sdp } });
    flushOut(c);
  } catch (e) { console.error(e); if (call === c) endCall('failed'); }
}

/* ---- ending ---- */
function endCall(reason, notify = true) {
  const c = call; if (!c) return;
  if (notify && (c.dir === 'in' || c.invited || c.startedAt)) signal(c.peerId, 'end', { callId: c.id, reason });
  if (c.dir === 'out' && c.invited) {
    const secs = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
    const status = c.startedAt ? 'ended' : (reason === 'decline' || reason === 'busy') ? 'declined' : 'missed';
    logCall(c, status, secs);
    if (!c.startedAt && (reason === 'cancel' || reason === 'timeout')) pushCall(c.peerId, c, 'missed');
  }
  cleanupCall(!notify && reason === 'cancel' ? 'Missed call' : (END_TEXT[reason] || 'Call ended'));
}
function cleanupCall(text) {
  const c = call; call = null; stopRing();
  if (!c) return;
  endedCalls.add(c.id); clearInterval(c.resend); closeCallNotif();
  clearTimeout(c.ringTimer); clearTimeout(c.dcTimer); clearInterval(c.timer);
  try { c.pc && c.pc.close(); } catch (e) {}
  if (c.stream) c.stream.getTracks().forEach((t) => t.stop());
  try { c.wake && c.wake.release(); } catch (e) {}
  $('call-remote').srcObject = null; $('call-local').srcObject = null;
  const el = $('call');
  clearTimeout(hideTimer);
  if (!text) return el.classList.add('hidden');
  setCallStatus(text); el.classList.remove('live', 'incoming'); el.classList.add('ending');
  hideTimer = setTimeout(() => { if (!call) el.classList.add('hidden'); }, 1400);
}

/* ---- call screen ---- */
const setCallStatus = (t) => { $('call-status').textContent = t; };
function showCallUI() {
  const c = call, p = profiles[c.peerId], el = $('call');
  clearTimeout(hideTimer);
  el.className = [c.kind === 'video' ? 'video' : '', c.dir === 'in' ? 'incoming' : ''].join(' ').trim();
  $('call-avatar').innerHTML = avatar(p, 'xl');
  $('call-name').textContent = nameOf(p);
  setCallStatus(c.dir === 'in' ? `Incoming ${c.kind === 'video' ? 'video' : 'voice'} call` : 'Calling…');
  $('call-cam').classList.toggle('hidden', c.kind !== 'video');
  $('call-flip').classList.add('hidden');
  $('call-mute').classList.remove('off'); $('call-mute').textContent = '🎤';
  $('call-cam').classList.remove('off'); $('call-local').classList.remove('cam-off');
  $('call-local').classList.add('mirror');
}
function attachLocal(c) {
  $('call-local').srcObject = c.stream;
  if (c.kind === 'video' && navigator.mediaDevices.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices().then((d) => {
      if (call === c && d.filter((x) => x.kind === 'videoinput').length > 1) $('call-flip').classList.remove('hidden');
    }).catch(() => {});
  }
}
$('call-accept').onclick = acceptCall;
$('call-decline').onclick = () => endCall('decline');
$('call-end').onclick = () => { const c = call; if (c) endCall(c.startedAt ? 'hangup' : c.dir === 'out' ? 'cancel' : 'decline'); };
$('call-mute').onclick = () => {
  const c = call; if (!c || !c.stream) return;
  c.muted = !c.muted; c.stream.getAudioTracks().forEach((t) => (t.enabled = !c.muted));
  $('call-mute').classList.toggle('off', c.muted); $('call-mute').textContent = c.muted ? '🔇' : '🎤';
};
$('call-cam').onclick = () => {
  const c = call; if (!c || !c.stream) return;
  c.camOff = !c.camOff; c.stream.getVideoTracks().forEach((t) => (t.enabled = !c.camOff));
  $('call-cam').classList.toggle('off', c.camOff); $('call-local').classList.toggle('cam-off', c.camOff);
  if (c.startedAt) signal(c.peerId, 'cam', { callId: c.id, on: !c.camOff });
};
$('call-flip').onclick = async () => {
  const c = call; if (!c || !c.pc || c.kind !== 'video') return;
  const next = c.facing === 'user' ? 'environment' : 'user';
  const old = c.stream.getVideoTracks()[0]; if (old) old.stop();   // some phones can't open two cameras at once
  let nt;
  try { nt = (await navigator.mediaDevices.getUserMedia({ video: { facingMode: next } })).getVideoTracks()[0]; c.facing = next; }
  catch (e) { try { nt = (await navigator.mediaDevices.getUserMedia({ video: { facingMode: c.facing } })).getVideoTracks()[0]; } catch (e2) { return; } }
  nt.enabled = !c.camOff;
  const sender = c.pc.getSenders().find((s) => s.track && s.track.kind === 'video') || c.pc.getSenders().find((s) => s.track === null);
  if (sender) await sender.replaceTrack(nt);
  if (old) c.stream.removeTrack(old);
  c.stream.addTrack(nt);
  $('call-local').srcObject = c.stream; $('call-local').classList.toggle('mirror', c.facing === 'user');
};
// header buttons in the chat
$('btn-vcall').onclick = () => startCall('video');
$('btn-acall').onclick = () => startCall('audio');
// best effort: tell the other person if the tab is closed mid-call
window.addEventListener('pagehide', () => { if (call) endCall(call.startedAt ? 'hangup' : call.dir === 'out' ? 'cancel' : 'decline'); });

/* ============================================================
   UPDATE 6: ringing when the app is closed / phone locked (Web Push)
   needs: sw.js, push_subscriptions table, 'call-push' edge function, VAPID keys (see SETUP.md)
   ============================================================ */
let swReg = null;
const b64ToU8 = (b) => { const pad = '='.repeat((4 - b.length % 4) % 4), raw = atob((b + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
async function getSw() {
  if (!('serviceWorker' in navigator)) return null;
  try { swReg = swReg || await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('service worker', e); }
  return swReg;
}
async function registerPush() {
  const reg = await getSw();
  if (!reg || !window.VAPID_PUBLIC_KEY || !('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted' || !me) return;
  try {
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(window.VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({ user_id: me.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
    if (error) console.warn('push subscription not saved', error.message);
  } catch (e) { console.warn('push setup failed', e); }
}
async function unregisterPush() {
  try {
    const reg = await getSw(); const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch (e) {}
}
function pushCall(to, c, type) {
  if (!window.VAPID_PUBLIC_KEY) return;
  sb.functions.invoke('call-push', { body: { to, callId: c.id, kind: c.kind, type } }).then(({ error }) => { if (error) console.warn('call push failed', error.message); });
}
async function notifyCall(c) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const pr = profiles[c.peerId], opts = { body: `Incoming ${c.kind === 'video' ? 'video' : 'voice'} call`, tag: 'call', renotify: true, requireInteraction: true, vibrate: [500, 250, 500, 250, 500], icon: pr?.avatar_url || 'icon.svg' };
  try { const reg = await getSw(); if (reg) await reg.showNotification(nameOf(pr), opts); else new Notification(nameOf(pr), opts); } catch (e) {}
}
async function closeCallNotif() {
  try { const reg = swReg || (await getSw()); (await reg.getNotifications({ tag: 'call' })).forEach((n) => n.close()); } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) closeCallNotif(); });

setMode('login');