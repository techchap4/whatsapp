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
const nameOf = (p) => (p && (p.full_name || p.username)) || 'Unknown';
const initials = (p) => {
  const n = nameOf(p);
  return String(n).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
};
function colorFor(id = '') {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 45%)`;
}
function avatar(p, cls = '') {
  if (p && p.avatar_url) return `<img class="avatar ${cls}" src="${esc(p.avatar_url)}" alt="">`;
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
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}, { once: true });

/* ---------------- auth screen ---------------- */
let mode = 'login';
function setMode(m) {
  mode = m;
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
      if (!data.session) {
        setAuthMsg('Account created. Check your email to confirm it, then log in.', true);
        setMode('login'); setAuthMsg('Account created. Check your email to confirm it, then log in.', true);
      }
    }
  } catch (err) {
    let m = err.message || 'Something went wrong.';
    if (/database error/i.test(m)) m = 'That username is already taken. Try another one.';
    if (/already registered/i.test(m)) m = 'This email already has an account. Use the Log in tab.';
    if (/invalid login/i.test(m)) m = 'Wrong email or password.';
    setAuthMsg(m);
  } finally { btn.disabled = false; }
};

$('btn-logout').onclick = async () => { await sb.auth.signOut(); };

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
  await Promise.all([loadMessages(), loadStatuses()]);
  renderAll();
  subscribe();
  pruneTimer = setInterval(pruneStatuses, 60000);
}
function stop() {
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
      if (p.new && p.new.id) { profiles[p.new.id] = p.new; renderAll(); if (activeId) openHeader(); }
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
    playReceive();
    if (!viewing) desktopNotify(m);
  }
  renderList();
  if (activeId && (m.sender_id === activeId || m.receiver_id === activeId)) renderMessages(true);
  updateTitle();
}
function desktopNotify(m) {
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
  ['chats', 'status', 'profile'].forEach((x) => $('pane-' + x).classList.toggle('hidden', x !== t));
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
    const tick = mine ? `<span class="tick ${m.read ? 'read' : ''}">${m.read ? '✓✓' : '✓'}</span> ` : '';
    return `<button class="item ${c.id === activeId ? 'active' : ''}" data-id="${c.id}">
      ${avatar(p)}
      <div class="body">
        <div class="top"><span class="name">${esc(nameOf(p))}</span><span class="time ${c.unread ? 'unread' : ''}">${listTime(m.created_at)}</span></div>
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
  $('conv-name').textContent = nameOf(p);
  $('conv-sub').textContent = online.has(activeId) ? 'online' : '@' + (p?.username || '');
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
    const tick = mine ? `<span class="tick ${m.read ? 'read' : ''}">${m.read ? '✓✓' : '✓'}</span>` : '';
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
  if (e.key === 'Enter' && !e.shiftKey && !isMobile()) { e.preventDefault(); $('composer').requestSubmit(); }
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
      <div class="body"><div class="top"><span class="name">${esc(nameOf(p))}</span></div>
      <div class="bottom"><span class="preview">${esc(p.about || '')}</span></div></div></button>`).join('')
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
        <div class="body"><div class="top"><span class="name">${esc(nameOf(profiles[id]))}</span></div>
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
  const statusText = typeof s.content === 'string' && s.content.trim() ? s.content : '';
  if (s.image_url) {
    body.style.background = '#000';
    body.innerHTML = `<img src="${esc(s.image_url)}" alt="">${statusText ? `<div class="cap">${esc(statusText)}</div>` : ''}`;
  } else { body.style.background = s.bg || '#00a884'; body.textContent = statusText; }
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
  const icon = { image: '📷 Photo', video: '🎥 Video', audio: '🎵 Audio', voice: '🎤 Voice note' }[m.media_type];
  return icon ? icon + (m.content ? ' ' + m.content : '') : (m.content || '');
}
function msgHtml(m, mine, tick) {
  const side = mine ? 'out' : 'in';
  const meta = `<span class="meta">${timeStr(m.created_at)}${tick}</span>`;
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
const themeKey = (id) => `chat-theme:${me?.id ?? 'guest'}:${id ?? 'default'}`;
const themeOf = (id) => {
  try {
    const stored = localStorage.getItem(themeKey(id));
    return THEMES.find((t) => t.id === stored) || THEMES[0];
  } catch (e) {
    return THEMES[0];
  }
};
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

setMode('login');