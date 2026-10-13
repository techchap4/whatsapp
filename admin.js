/* ChatApp admin dashboard. Needs admin_setup.sql and your account flagged is_admin = true. */
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VB = '<svg class="vbadge" viewBox="0 0 24 24" aria-label="Verified"><path fill="#1d9bf0" d="M22.5 12.5l-2.1-2.4.3-3.2-3.1-.7-1.6-2.8L13 4.6 10 3.3 8.4 6.1l-3.1.7.3 3.2L3.5 12.5l2.1 2.4-.3 3.2 3.1.7 1.6 2.8 3-1.3 3 1.3 1.6-2.8 3.1-.7-.3-3.2z"/><path fill="none" stroke="#fff" stroke-width="2" d="M8 12.5l2.7 2.7L16 9.8"/></svg>';
const nm = (p) => (p ? p.full_name || p.username : 'Deleted user');
const hue = (id = '') => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 45% 42%)`; };
const av = (p) => (p && p.avatar_url ? `<img class="av" src="${esc(p.avatar_url)}" alt="">` : `<div class="av" style="background:${hue(p && p.id)}">${esc(nm(p).slice(0, 2).toUpperCase())}</div>`);
const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2800); }

let me = null, users = {}, vreqs = [], reports = [], notifs = [], view = 'overview', vFilter = 'pending', rFilter = 'open', uFilter = '', uQuery = '';
const stats = { messages: 0, statuses: 0 };

/* ---------- auth gate ---------- */
async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) { $('gate').classList.remove('hidden'); return; }
  const { data: p } = await sb.from('profiles').select('*').eq('id', data.session.user.id).single();
  if (!p || !p.is_admin) { await sb.auth.signOut(); $('gate').classList.remove('hidden'); $('g-err').textContent = 'This account is not an admin.'; return; }
  me = p; $('gate').classList.add('hidden'); $('shell').classList.remove('hidden'); $('me-name').textContent = nm(p);
  await refresh(); go('overview');
  sb.channel('admin-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'verification_requests' }, async () => { await loadVreqs(); counts(); if (view === 'verify' || view === 'overview') render(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, async () => { await loadReports(); counts(); if (view === 'reports' || view === 'overview') render(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, async () => { await loadUsers(); if (view === 'users' || view === 'overview') render(); })
    .subscribe();
}
$('gate-form').onsubmit = async (e) => {
  e.preventDefault(); $('g-err').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('g-email').value.trim(), password: $('g-pw').value });
  if (error) { $('g-err').textContent = error.message; return; }
  boot();
};
$('out').onclick = async () => { await sb.auth.signOut(); location.reload(); };

/* ---------- data ---------- */
async function loadUsers() { const { data } = await sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(2000); users = {}; (data || []).forEach((p) => (users[p.id] = p)); }
async function loadVreqs() { const { data } = await sb.from('verification_requests').select('*').order('created_at', { ascending: false }).limit(300); vreqs = data || []; }
async function loadReports() { const { data } = await sb.from('reports').select('*').order('created_at', { ascending: false }).limit(300); reports = data || []; }
async function loadNotifs() { const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60); notifs = data || []; }
async function loadStats() {
  const c = async (t) => (await sb.from(t).select('*', { count: 'exact', head: true })).count || 0;
  [stats.messages, stats.statuses] = await Promise.all([c('messages'), c('statuses')]);
}
async function refresh() { await Promise.all([loadUsers(), loadVreqs(), loadReports(), loadNotifs(), loadStats()]); counts(); }
function counts() {
  const set = (id, n) => { $(id).textContent = n; $(id).classList.toggle('hidden', !n); };
  set('c-verify', vreqs.filter((r) => r.status === 'pending').length);
  set('c-reports', reports.filter((r) => r.status === 'open').length);
}
async function act(fn, ok) {
  const { error } = await fn(); if (error) return toast('Error: ' + error.message);
  toast(ok); await refresh(); render();
}

/* ---------- navigation ---------- */
$('nav').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.v); };
function go(v) { view = v; document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); render(); }
function render() { ({ overview: vOverview, users: vUsers, verify: vVerify, reports: vReports, notify: vNotify })[view](); }
const main = () => $('view');

/* ---------- overview ---------- */
function vOverview() {
  const us = Object.values(users), day = Date.now() - 864e5;
  main().innerHTML = `<h1 class="t">Overview</h1><div class="stats">
    <div class="stat"><b>${us.length}</b><span>Total users</span></div>
    <div class="stat"><b>${us.filter((u) => u.created_at && new Date(u.created_at).getTime() > day).length}</b><span>New in 24 hours</span></div>
    <div class="stat"><b>${us.filter((u) => u.is_verified).length}</b><span>Verified (blue badge)</span></div>
    <div class="stat"><b>${us.filter((u) => u.banned).length}</b><span>Banned</span></div>
    <div class="stat"><b>${vreqs.filter((r) => r.status === 'pending').length}</b><span>Verification requests waiting</span></div>
    <div class="stat"><b>${reports.filter((r) => r.status === 'open').length}</b><span>Open reports and appeals</span></div>
    <div class="stat"><b>${stats.messages}</b><span>Messages sent</span></div>
    <div class="stat"><b>${stats.statuses}</b><span>Statuses posted</span></div></div>
    <div class="panel"><div class="pad"><b>Newest users</b></div><div class="tablewrap"><table><tbody>${us.slice(0, 6).map((u) => `<tr><td><div class="who">${av(u)}<div><b>${esc(nm(u))}${u.is_verified ? VB : ''}</b><small>@${esc(u.username)}</small></div></div></td><td>${u.created_at ? when(u.created_at) : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
}

/* ---------- users ---------- */
function userRows() {
  const q = uQuery.toLowerCase();
  return Object.values(users).filter((u) => (!q || (nm(u) + ' ' + u.username).toLowerCase().includes(q)) &&
    (!uFilter || (uFilter === 'verified' && u.is_verified) || (uFilter === 'banned' && u.banned) || (uFilter === 'admin' && u.is_admin)));
}
function vUsers() {
  main().innerHTML = `<h1 class="t">Users</h1><div class="bar"><input id="uq" type="search" placeholder="Search name or username" value="${esc(uQuery)}">
    <select id="uf"><option value="">All users</option><option value="verified">Verified</option><option value="banned">Banned</option><option value="admin">Admins</option></select></div>
    <div class="panel"><div class="tablewrap"><table><thead><tr><th>User</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead><tbody id="ubody"></tbody></table></div></div>`;
  $('uf').value = uFilter; fillUsers();
  $('uq').oninput = (e) => { uQuery = e.target.value; fillUsers(); };
  $('uf').onchange = (e) => { uFilter = e.target.value; fillUsers(); };
}
function fillUsers() {
  const rows = userRows().slice(0, 300);
  $('ubody').innerHTML = rows.length ? rows.map((u) => `<tr><td><div class="who">${av(u)}<div><b>${esc(nm(u))}${u.is_verified ? VB : ''}</b><small>@${esc(u.username)}</small></div></div></td>
    <td>${u.is_admin ? '<span class="chip adm">Admin</span> ' : ''}${u.is_verified ? '<span class="chip ok">Verified</span> ' : ''}${u.banned ? `<span class="chip bad" title="${esc(u.ban_reason || '')}">Banned</span>` : '<span class="chip">Active</span>'}</td>
    <td>${u.created_at ? when(u.created_at) : ''}</td>
    <td><div class="acts"><button class="btn sm blue" data-a="verify" data-id="${u.id}">${u.is_verified ? 'Remove badge' : 'Give badge'}</button>
      <button class="btn sm ${u.banned ? '' : 'danger'}" data-a="ban" data-id="${u.id}" ${u.is_admin ? 'disabled' : ''}>${u.banned ? 'Unban' : 'Ban'}</button>
      <button class="btn sm ghost" data-a="msg" data-id="${u.id}">Notify</button>
      <button class="btn sm ghost" data-a="del" data-id="${u.id}" ${u.is_admin ? 'disabled' : ''}>Delete</button></div></td></tr>`).join('') : '<tr><td colspan="4" class="empty">No users match.</td></tr>';
}
main().addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, id = b.dataset.id, u = users[id];
  if (a === 'verify') return act(() => sb.rpc('admin_set_verified', { p_user: id, p_value: !u.is_verified }), u.is_verified ? 'Badge removed' : 'Blue badge given');
  if (a === 'ban') {
    if (u.banned) return act(() => sb.rpc('admin_set_ban', { p_user: id, p_banned: false, p_reason: null }), 'User unbanned');
    const reason = prompt(`Ban ${nm(u)}? Reason shown to the user:`, 'Violation of the rules'); if (reason === null) return;
    return act(() => sb.rpc('admin_set_ban', { p_user: id, p_banned: true, p_reason: reason }), 'User banned');
  }
  if (a === 'del') { if (!confirm(`Permanently delete ${nm(u)} and all their data?`)) return; return act(() => sb.rpc('admin_delete_user', { p_user: id }), 'User deleted'); }
  if (a === 'msg') { nTarget = id; go('notify'); }
  if (a === 'vok' || a === 'vno') {
    const approve = a === 'vok', note = approve ? null : prompt('Reason for declining (shown to the user):', '');
    if (!approve && note === null) return;
    return act(() => sb.rpc('admin_review_verification', { p_id: id, p_approve: approve, p_note: note }), approve ? 'Approved, badge given' : 'Request declined');
  }
  if (a === 'doc') {
    const { data, error } = await sb.storage.from('verification-docs').createSignedUrl(b.dataset.path, 300);
    if (error) return toast(error.message); window.open(data.signedUrl, '_blank', 'noopener');
  }
  if (a === 'rban') { const rep = reports.find((r) => r.id === id), t = users[rep.reported_id];
    const reason = prompt(`Ban ${nm(t)}? Reason shown to the user:`, rep.reason || 'Reported by other users'); if (reason === null) return;
    const r1 = await sb.rpc('admin_set_ban', { p_user: rep.reported_id, p_banned: true, p_reason: reason }); if (r1.error) return toast(r1.error.message);
    return act(() => sb.rpc('admin_resolve_report', { p_id: id, p_status: 'actioned' }), 'User banned, report closed'); }
  if (a === 'runban') { const rep = reports.find((r) => r.id === id);
    const r1 = await sb.rpc('admin_set_ban', { p_user: rep.reporter_id, p_banned: false, p_reason: null }); if (r1.error) return toast(r1.error.message);
    return act(() => sb.rpc('admin_resolve_report', { p_id: id, p_status: 'actioned' }), 'Appeal accepted, user unbanned'); }
  if (a === 'rdis') return act(() => sb.rpc('admin_resolve_report', { p_id: id, p_status: 'dismissed' }), 'Dismissed');
  if (a === 'rdone') return act(() => sb.rpc('admin_resolve_report', { p_id: id, p_status: 'actioned' }), 'Marked done');
  if (a === 'ndel') return act(() => sb.from('notifications').delete().eq('id', id), 'Notification deleted');
});

/* ---------- verification requests ---------- */
function vVerify() {
  const list = vreqs.filter((r) => r.status === vFilter);
  main().innerHTML = `<h1 class="t">Verification requests</h1>
    <div class="tabs2">${['pending', 'approved', 'rejected'].map((s) => `<button data-f="${s}" class="${vFilter === s ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)} (${vreqs.filter((r) => r.status === s).length})</button>`).join('')}</div>
    <div class="panel">${list.length ? list.map((r) => { const u = users[r.user_id]; return `<div class="card"><div class="row"><div class="who">${av(u)}<div><b>${esc(nm(u))}${u && u.is_verified ? VB : ''}</b><small>@${esc(u && u.username)} · applied ${when(r.created_at)}</small></div></div><span class="chip ${r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'wait'}">${r.status}</span></div>
      <div class="meta">Legal name: <b>${esc(r.full_name)}</b> · Category: <b>${esc(r.category)}</b>${r.links ? ' · Links: ' + esc(r.links) : ''}</div><p>${esc(r.reason)}</p>
      ${r.admin_note ? `<div class="meta">Note: ${esc(r.admin_note)}</div>` : ''}
      <div class="acts">${r.doc_path ? `<button class="btn sm ghost" data-a="doc" data-path="${esc(r.doc_path)}">View proof</button>` : ''}
      ${r.status === 'pending' ? `<button class="btn sm blue" data-a="vok" data-id="${r.id}">Approve</button><button class="btn sm danger" data-a="vno" data-id="${r.id}">Decline</button>` : ''}</div></div>`; }).join('') : '<div class="empty">Nothing here.</div>'}</div>`;
  main().querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { vFilter = b.dataset.f; vVerify(); }));
}

/* ---------- reports / ban requests / appeals / feedback ---------- */
function vReports() {
  const list = reports.filter((r) => r.status === rFilter);
  const label = { report: 'Ban request', appeal: 'Ban appeal', feedback: 'Help message' };
  main().innerHTML = `<h1 class="t">Reports and appeals</h1>
    <div class="tabs2">${['open', 'actioned', 'dismissed'].map((s) => `<button data-f="${s}" class="${rFilter === s ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)} (${reports.filter((r) => r.status === s).length})</button>`).join('')}</div>
    <div class="panel">${list.length ? list.map((r) => { const rep = users[r.reporter_id], tgt = users[r.reported_id]; return `<div class="card"><div class="row"><div><span class="chip ${r.kind === 'report' ? 'bad' : r.kind === 'appeal' ? 'wait' : ''}">${label[r.kind]}</span> <b>${esc(r.reason || '')}</b></div><span class="meta">${when(r.created_at)}</span></div>
      <div class="meta">From <b>${esc(nm(rep))}</b> (@${esc(rep && rep.username)})${r.kind === 'report' ? ` against <b>${esc(nm(tgt))}</b> (@${esc(tgt && tgt.username)})${tgt && tgt.banned ? ' · already banned' : ''}` : ''}</div>
      ${r.details ? `<p>${esc(r.details)}</p>` : ''}
      ${r.status === 'open' ? `<div class="acts">${r.kind === 'report' ? `<button class="btn sm danger" data-a="rban" data-id="${r.id}" ${tgt ? '' : 'disabled'}>Ban user</button>` : ''}
        ${r.kind === 'appeal' ? `<button class="btn sm" data-a="runban" data-id="${r.id}">Accept and unban</button>` : ''}
        ${r.kind === 'feedback' ? `<button class="btn sm" data-a="rdone" data-id="${r.id}">Mark done</button>` : ''}
        <button class="btn sm ghost" data-a="rdis" data-id="${r.id}">Dismiss</button></div>` : ''}</div>`; }).join('') : '<div class="empty">Nothing here.</div>'}</div>`;
  main().querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { rFilter = b.dataset.f; vReports(); }));
}

/* ---------- send notifications ---------- */
let nTarget = '';
function vNotify() {
  const opts = Object.values(users).sort((a, b) => nm(a).localeCompare(nm(b))).map((u) => `<option value="${u.id}">${esc(nm(u))} (@${esc(u.username)})</option>`).join('');
  main().innerHTML = `<h1 class="t">Send notification</h1><div class="two"><div class="panel pad">
    <label>Send to<select id="n-to"><option value="">Everyone</option>${opts}</select></label>
    <label>Type<select id="n-type"><option value="update">App update (shows an Update now button)</option><option value="info">Announcement</option><option value="warning">Warning</option></select></label>
    <label>Title<input id="n-title" maxlength="80" placeholder="Version 2.1 is here"></label>
    <label>Message<textarea id="n-body" rows="4" maxlength="500" placeholder="What is new or what should people know?"></textarea></label>
    <button class="btn" id="n-send" type="button">Send now</button></div>
    <div class="panel"><div class="pad"><b>Sent notifications</b></div>${notifs.length ? notifs.map((n) => `<div class="card"><div class="row"><div><span class="chip ${n.type === 'update' ? 'ok' : n.type === 'warning' ? 'wait' : ''}">${n.type}</span> <b>${esc(n.title)}</b></div><button class="btn sm ghost" data-a="ndel" data-id="${n.id}">Delete</button></div>
      <p>${esc(n.body || '')}</p><div class="meta">${n.user_id ? 'To ' + esc(nm(users[n.user_id])) : 'To everyone'} · ${when(n.created_at)}</div></div>`).join('') : '<div class="empty">None sent yet.</div>'}</div></div>`;
  $('n-to').value = nTarget; nTarget = '';
  $('n-send').onclick = async () => {
    const title = $('n-title').value.trim(), body = $('n-body').value.trim(), to = $('n-to').value || null;
    if (!title) return toast('Add a title');
    if (!to && !confirm('Send this to ALL users?')) return;
    const b = $('n-send'); b.disabled = true;
    const { error } = await sb.from('notifications').insert({ user_id: to, title, body: body || null, type: $('n-type').value });
    b.disabled = false; if (error) return toast('Error: ' + error.message);
    toast('Notification sent'); await loadNotifs(); vNotify();
  };
}

boot();