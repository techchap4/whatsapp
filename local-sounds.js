/* Original synthesized notification tone alternatives; no sound files are uploaded. */
(() => {
  'use strict';
  const names = ['Bottle', 'Bubble', 'Bullfrog', 'Burst', 'Chirp', 'Clank', 'Crystal', 'FadeIn', 'FadeOut', 'Flute', 'Fresh', 'Frog', 'Guitar', 'Harp', 'Moment', 'NotificationXylophone', 'Potion', 'Radar', 'Spring'];
  const key = 'rada-receive-sound';
  function selected() {
    try { const s = localStorage.getItem(key) || 'default'; return s === 'none' || names.includes(s) ? s : 'default'; }
    catch (_) { return 'default'; }
  }
  function soundOn() { try { return localStorage.getItem('chat-sound') !== 'off'; } catch (_) { return false; } }
  async function play(fallback, contextFactory) {
    const n = selected();
    if (!soundOn() || n === 'none') return 'none';
    if (n === 'default') { fallback(); return 'default'; }
    const ctx = contextFactory();
    if (ctx.state === 'suspended') await ctx.resume();
    if (!soundOn() || selected() !== n) return 'cancelled';
    if (!window.RadaOriginalTones) { fallback(); return 'default'; }
    window.RadaOriginalTones.play(ctx, n);
    return 'original';
  }
  function mount(pane, fallback, contextFactory) {
    const box = document.createElement('section'); box.className = 'set-form';
    box.innerHTML = `<h4>Incoming notification sound</h4>
      <p>These are original alternatives inspired by the tone names, not Xiaomi recordings.</p>
      <label>Sound for incoming notifications <select id="local-sound-active"></select></label>
      <button class="primary ghostbtn" id="local-sound-preview" type="button">Preview selected sound</button>
      <p id="local-sound-status" role="status" aria-live="polite"></p>
      <p>These sounds play while Rada can play audio. Background or closed-app notifications use your browser or device sound. You may need to tap the app first. The sound switch also controls send sounds. None silences incoming sounds only.</p>`;
    pane.appendChild(box);
    const active = box.querySelector('#local-sound-active'), status = box.querySelector('#local-sound-status');
    for (const [value, label] of [['default', 'Default (existing sound)'], ['none', 'None (silence)'], ...names.map(n => [n, n + ' (original alternative)'])]) active.add(new Option(label, value));
    active.value = selected();
    active.onchange = () => {
      try { localStorage.setItem(key, active.value); status.textContent = 'Incoming sound saved on this device.'; }
      catch (_) { active.value = selected(); status.textContent = 'Could not save this sound on this device.'; }
    };
    box.querySelector('#local-sound-preview').onclick = async () => {
      try {
        if (!soundOn()) { status.textContent = 'Turn on notification sounds to preview.'; return; }
        if (selected() === 'none') { status.textContent = 'None is selected: incoming notifications are silent.'; return; }
        const result = await play(fallback, contextFactory);
        status.textContent = result === 'cancelled' ? 'Preview cancelled.' : 'Preview started.';
      } catch (_) { status.textContent = 'Audio is blocked. Tap the app and try preview again.'; }
    };
  }
  window.RadaSounds = { play, mount };
})();
