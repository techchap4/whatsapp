/* Online dots use Rada's existing presence channel and privacy checks. */
(() => {
  'use strict';
  function currentIds() {
    try {
      if (!me || !presenceCh || presenceCh.state !== 'joined') return new Set();
      return new Set(Object.keys(presenceCh.presenceState()));
    } catch (_) { return new Set(); }
  }
  function setDot(container, visible) {
    if (!container) return;
    let dot = Array.from(container.children).find(e => e.classList.contains('presence-dot'));
    if (!visible) { if (dot) dot.remove(); return; }
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'presence-dot';
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', 'Online');
      dot.title = 'Online';
      container.appendChild(dot);
    }
  }
  function update() {
    const now = currentIds();
    const allowed = id => {
      try { const p = profiles[id]; return !!(me && p && id !== me.id && now.has(id) && canSee(p, 'online')); }
      catch (_) { return false; }
    };
    document.querySelectorAll('#chat-list .item[data-id]').forEach(row => setDot(row, allowed(row.dataset.id)));
    setDot(document.getElementById('conv-avatar'), !!activeId && allowed(activeId));
  }
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; setTimeout(() => { queued = false; update(); }, 0); } };
  for (const id of ['chat-list', 'conv-avatar']) {
    const el = document.getElementById(id);
    if (el) new MutationObserver(schedule).observe(el, { childList: true, subtree: true });
  }
  setInterval(update, 1500);
  schedule();
})();
