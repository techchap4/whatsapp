/* Rada: WhatsApp-style layout add-on. Loaded after app.js + extras.js */
(() => {
  const $ = (id) => document.getElementById(id);
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const K = (n) => `rada-${n}:${me.id}`;
  const favs = () => get(K('favs'), []);
  const cleared = () => get(K('cleared'), {});
  window.isMuted = (id) => (get(K('muted'), {})[id] || 0) > Date.now();

  const VIDEO = '<svg class="so" viewBox="0 0 24 24"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3z"/></svg>';
  const PHONE = '<svg class="so" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>';

  /* ---------- Clear chat: hide old messages on this device ---------- */
  const visible = (all) => {
    const c = cleared(); if (!Object.keys(c).length) return all;
    return all.filter((m) => {
      const other = m.sender_id === me.id ? m.receiver_id : m.sender_id;
      return !c[other] || new Date(m.created_at).getTime() > c[other];
    });
  };
  const origMsgs = window.renderMessages;
  window.renderMessages = function (...a) {
    const all = messages; messages = visible(all);
    try { return origMsgs.apply(this, a); } finally { messages = all; }
  };

  /* ---------- Filter chips: All / Unread / Favourites / Groups / + ---------- */
  let chip = 'all';
  const chips = document.createElement('div');
  chips.id = 'chips'; chips.className = 'chips';
  chips.innerHTML = [['all', 'All'], ['unread', 'Unread'], ['fav', 'Favourites'], ['groups', 'Groups']]
    .map(([k, l]) => `<button type="button" data-chip="${k}" class="${k === 'all' ? 'active' : ''}">${l}</button>`).join('')
    + '<button type="button" data-chip="plus" aria-label="New group">+</button>';
  $('chat-search').appendChild(chips);
  chips.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.chip === 'plus') return createGroupPrompt();
    chip = b.dataset.chip;
    chips.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.chip === chip));
    renderList();
  };

  function decorate() {
    if (typeof me === 'undefined' || !me) return;
    const list = $('chat-list'), f = favs(), live = new Set(statuses.map((s) => s.user_id));
    let shown = 0;
    const old = $('chip-note'); if (old) old.remove();
    list.querySelectorAll('.item[data-id]').forEach((it) => {
      const id = it.dataset.id, av = it.querySelector('.avatar');
      if (av) av.classList.toggle('has-status', live.has(id));
      const ok = chip === 'all' || (chip === 'unread' && !!it.querySelector('.badge')) || (chip === 'fav' && f.includes(id));
      it.classList.toggle('hidden', !ok); if (ok) shown++;
    });
    list.querySelectorAll('.empty-note').forEach((n) => n.classList.toggle('hidden', chip !== 'all'));
    if (chip !== 'all' && !shown) {
      const d = document.createElement('div'); d.id = 'chip-note'; d.className = 'empty-note';
      d.textContent = chip === 'groups' ? 'No groups yet. Tap + to create one.'
        : chip === 'fav' ? 'No favourites yet. In a chat use ⋮ › More › Add to list.' : 'No unread chats.';
      list.appendChild(d);
    }
  }
  const origList = window.renderList;
  window.renderList = function () {
    const all = messages; messages = visible(all);
    try { origList(); } finally { messages = all; }
    decorate();
    const cp = $('pane-calls'); if (cp && !cp.classList.contains('hidden')) renderCalls();
  };
  $('search').oninput = () => renderList();

  /* green ring around the contact in the chat header when they have a status */
  const origHeader = window.openHeader;
  window.openHeader = function () {
    origHeader();
    const a = $('conv-avatar').firstElementChild;
    if (a) a.classList.toggle('has-status', statuses.some((s) => s.user_id === activeId));
  };

  /* ---------- Bottom nav: Calls + Communities tabs ---------- */
  const origTab = window.switchTab;
  window.switchTab = function (t) {
    origTab(t);
    ['calls', 'communities'].forEach((x) => $('pane-' + x).classList.toggle('hidden', x !== t));
    if (t === 'calls') renderCalls();
  };
  $('comm-new').onclick = () => createGroupPrompt();

  function renderCalls() {
    const rows = visible(messages).filter((m) => parseCall(m)).reverse();
    const pane = $('pane-calls');
    pane.innerHTML = '<div class="section-title">Recent</div>' + (rows.length ? rows.map((m) => {
      const cl = parseCall(m), mine = m.sender_id === me.id, other = mine ? m.receiver_id : m.sender_id, v = callLabel(cl, mine);
      const st = v.missed ? 'Missed' : v.sub.replace(/^[↗↙]\s*/, '');
      return `<button class="item" type="button" data-id="${other}" data-kind="${cl.kind}">${avatar(profiles[other])}
        <div class="body"><div class="top"><span class="name${v.missed ? ' missed' : ''}">${esc(nameOf(profiles[other]))}</span></div>
        <div class="bottom"><span class="preview${v.missed ? ' missed' : ''}">${mine ? '↗' : '↙'} ${esc(st)} · ${listTime(m.created_at)}</span></div></div>
        <span class="call-ic">${cl.kind === 'video' ? VIDEO : PHONE}</span></button>`;
    }).join('') : '<div class="empty-note">No calls yet.<br>Open a chat and tap the phone or video icon.</div>');
    pane.querySelectorAll('.item').forEach((b) => b.onclick = () => { openChat(b.dataset.id); startCall(b.dataset.kind); });
  }

  /* ---------- Top bar: camera + ⋮ ---------- */
  const closePops = (except) => document.querySelectorAll('.pop').forEach((p) => { if (p !== except) p.classList.add('hidden'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.pop')) closePops(); });
  $('btn-cam-status').onclick = () => { openComposer(); $('status-file').click(); };
  const tm = $('top-menu');
  $('btn-topmore').onclick = (e) => { e.stopPropagation(); closePops(tm); tm.classList.toggle('hidden'); };
  tm.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    tm.classList.add('hidden');
    const g = b.dataset.go; if (g === 'group') createGroupPrompt(); else if (g) switchTab(g);
  };

  /* ---------- Chat ⋮ menu ---------- */
  const menu = $('chat-menu');
  const mainItems = () => [
    ['New group', () => createGroupPrompt(), 1],
    ['View contact', viewContact],
    ['Search', openSearch],
    ['Media, links, and docs', openMedia],
    [isMuted(activeId) ? 'Unmute notifications' : 'Mute notifications', toggleMute],
    ['Chat theme', () => $('btn-theme').click()],
    ['More  ▸', () => showMenu(moreItems()), 1, 1],
  ];
  const moreItems = () => [
    ['◂  Back', () => showMenu(mainItems()), 1, 1],
    ['Report', reportUser],
    ['Block', blockUser],
    ['Clear chat', clearChat],
    ['Export chat', exportChat],
    ['Add shortcut', addShortcut],
    [favs().includes(activeId) ? 'Remove from list' : 'Add to list', toggleFav],
  ];
  function showMenu(items) {
    menu.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" class="${it[2] ? 'sep' : ''}">${it[0]}</button>`).join('');
    menu.classList.remove('hidden');
    menu.querySelectorAll('button').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const it = items[b.dataset.i];
      if (!it[3]) menu.classList.add('hidden');
      it[1]();
    });
  }
  $('btn-more').onclick = (e) => {
    e.stopPropagation(); closePops(menu);
    menu.classList.contains('hidden') ? showMenu(mainItems()) : menu.classList.add('hidden');
  };

  function sheet(title, html) {
    let m = $('modal-menu');
    if (!m) {
      m = document.createElement('div'); m.id = 'modal-menu'; m.className = 'modal hidden';
      m.innerHTML = '<div class="modal-card"><header><button class="close" type="button">✕</button><h3></h3></header><div class="sheet-body"></div></div>';
      document.body.appendChild(m);
      m.querySelector('.close').onclick = () => m.classList.add('hidden');
      m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
    }
    m.querySelector('h3').textContent = title;
    m.querySelector('.sheet-body').innerHTML = html;
    m.classList.remove('hidden');
    return m.querySelector('.sheet-body');
  }

  function viewContact() {
    const p = profiles[activeId]; if (!p) return;
    sheet('Contact info', `<div class="profile" style="text-align:center">
      <div style="justify-self:center">${avatar(p, 'xl')}</div>
      <h2 style="margin:0">${esc(nameOf(p))}</h2>
      <div class="field"><label>About</label><input disabled value="${esc(p.about || '')}"></div>
      <div class="field"><label>Username</label><input disabled value="@${esc(p.username)}"></div></div>`);
  }
  function openSearch() {
    let bar = $('chat-find');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'chat-find';
      bar.innerHTML = '<input type="search" placeholder="Search in this chat"><button type="button" aria-label="Close">✕</button>';
      $('messages').before(bar);
      const inp = bar.querySelector('input');
      inp.oninput = () => {
        const q = inp.value.trim().toLowerCase();
        $('messages').querySelectorAll('.bubble').forEach((b) => { b.style.display = !q || b.textContent.toLowerCase().includes(q) ? '' : 'none'; });
      };
      bar.querySelector('button').onclick = () => { inp.value = ''; inp.oninput(); bar.classList.add('hidden'); };
    }
    bar.classList.remove('hidden'); bar.querySelector('input').focus();
  }
  function openMedia() {
    const msgs = visible(messages).filter((m) => m.sender_id === activeId || m.receiver_id === activeId);
    const media = msgs.filter((m) => m.media_url && (m.media_type === 'image' || m.media_type === 'video'));
    const docs = msgs.filter((m) => m.media_url && (m.media_type === 'audio' || m.media_type === 'voice'));
    const links = msgs.flatMap((m) => ((m.content || '').match(/https?:\/\/[^\s]+/g) || []).map((u) => ({ u, t: m.created_at })));
    const body = sheet('Media, links, and docs', `
      <div class="media-tabs"><button class="active" data-t="m">Media (${media.length})</button><button data-t="d">Audio (${docs.length})</button><button data-t="l">Links (${links.length})</button></div>
      <div id="mm-pane"></div>`);
    const draw = (t) => {
      $('mm-pane').innerHTML =
        t === 'm' ? (media.length ? `<div class="media-grid">${media.map((m) => m.media_type === 'image'
          ? `<a href="${esc(m.media_url)}" target="_blank" rel="noopener"><img src="${esc(m.media_url)}" loading="lazy" alt=""></a>`
          : `<video src="${esc(m.media_url)}" controls preload="metadata"></video>`).join('')}</div>` : '<div class="empty-note">No media yet.</div>')
        : t === 'd' ? (docs.length ? docs.map((m) => `<div style="padding:8px 16px">${esc(m.media_name || 'Voice note')}<audio src="${esc(m.media_url)}" controls preload="none" style="width:100%"></audio></div>`).join('') : '<div class="empty-note">No audio yet.</div>')
        : (links.length ? links.map((l) => `<div style="padding:10px 16px"><a href="${esc(l.u)}" target="_blank" rel="noopener">${esc(l.u)}</a></div>`).join('') : '<div class="empty-note">No links yet.</div>');
    };
    draw('m');
    body.querySelectorAll('.media-tabs button').forEach((b) => b.onclick = () => {
      body.querySelectorAll('.media-tabs button').forEach((x) => x.classList.toggle('active', x === b)); draw(b.dataset.t);
    });
  }
  function toggleMute() {
    const m = get(K('muted'), {});
    if (isMuted(activeId)) delete m[activeId];
    else {
      const h = prompt('Mute for how many hours? (use 8760 for one year)', '8'); if (!h || isNaN(h)) return;
      m[activeId] = Date.now() + Number(h) * 3600000;
    }
    set(K('muted'), m);
  }
  async function reportUser() {
    const reason = prompt(`Report ${nameOf(profiles[activeId])}. What happened?`); if (!reason) return;
    const { error } = await sb.from('reports').insert({ reported_id: activeId, reason });
    alert(error ? 'Could not send report: ' + error.message : 'Report sent. Thank you.');
  }
  function blockUser() {
    if (!confirm(`Block ${nameOf(profiles[activeId])}? They will no longer be able to call you.`)) return;
    if (typeof window.toggleBlock === 'function') window.toggleBlock(activeId);
    else if (typeof window.blockUser === 'function') window.blockUser(activeId);
    else alert('Block function not found in extras.js. Paste extras.js to me and I will hook it up.');
  }
  function clearChat() {
    if (!confirm('Clear this chat on this device? The other person keeps their copy.')) return;
    const c = cleared(); c[activeId] = Date.now(); set(K('cleared'), c);
    renderMessages(true); renderList();
  }
  function exportChat() {
    const p = profiles[activeId];
    const txt = visible(messages).filter((m) => m.sender_id === activeId || m.receiver_id === activeId).map((m) => {
      const who = m.sender_id === me.id ? nameOf(profiles[me.id]) : nameOf(p);
      const body = m.media_url ? `<${m.media_type}> ${m.media_url}` : (m.content || '');
      return `${new Date(m.created_at).toLocaleString()} - ${who}: ${body}`;
    }).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    a.download = `Rada chat with ${nameOf(p)}.txt`; a.click();
  }
  async function addShortcut() {
    const url = `${location.origin}${location.pathname}?chat=${activeId}`;
    try { await navigator.clipboard.writeText(url); alert('Chat link copied. Open it in your browser and use "Add to Home screen" to make a shortcut.'); }
    catch (e) { prompt('Copy this link:', url); }
  }
  function toggleFav() {
    const f = favs(), i = f.indexOf(activeId);
    i >= 0 ? f.splice(i, 1) : f.push(activeId); set(K('favs'), f);
    renderList();
  }

  /* ---------- Message bar: mic <-> send, emoji, camera ---------- */
  const inp = $('msg-input'), comp = $('composer'), panel = $('emoji-panel');
  const sync = () => comp.classList.toggle('typing', !!inp.value.trim());
  inp.addEventListener('input', sync);
  comp.addEventListener('submit', () => setTimeout(sync, 50));
  $('attach-file').addEventListener('change', () => setTimeout(sync, 50));
  setInterval(sync, 400);

  const EMOJI = '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😎 🤩 🥳 😏 😢 😭 😡 😱 🤔 🙄 😴 🤗 👍 👎 👏 🙏 💪 🙌 👋 ✌️ 🤝 ❤️ 💕 💔 🔥 ✨ 🎉 🎂 🌹 ☀️ 🌙 ⭐ 💯'.split(' ');
  panel.innerHTML = EMOJI.map((e) => `<button type="button">${e}</button>`).join('');
  panel.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    inp.setRangeText(b.textContent, inp.selectionStart, inp.selectionEnd, 'end');
    inp.dispatchEvent(new Event('input')); inp.focus();
  };
  $('btn-emoji').onclick = () => panel.classList.toggle('hidden');

  $('cam-file').onchange = async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) await sendMedia(f, kindOf(f), '');
  };

  /* open ?chat=ID links (shortcut) once the app is ready */
  const want = new URLSearchParams(location.search).get('chat');
  if (want) { const t = setInterval(() => { if (typeof me !== 'undefined' && me && profiles[want]) { clearInterval(t); openChat(want); } }, 400); }
})();