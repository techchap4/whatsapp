/* User-supplied notification sounds. Nothing is uploaded. */
(() => {
  'use strict';
  const names = ['Bottle', 'Bubble', 'Bullfrog', 'Burst', 'Chirp', 'Clank', 'Crystal', 'FadeIn', 'FadeOut', 'Flute', 'Fresh', 'Frog', 'Guitar', 'Harp', 'Moment', 'NotificationXylophone', 'Potion', 'Radar', 'Spring'];
  const key = 'rada-receive-sound';
  const maxBytes = 5 * 1024 * 1024;
  const valid = n => names.includes(n);
  function selected() {
    try { const s = localStorage.getItem(key) || 'default'; return s === 'none' || valid(s) ? s : 'default'; }
    catch (_) { return 'default'; }
  }
  function setSelected(s) { localStorage.setItem(key, s); }
  function db() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('Local storage is unavailable.'));
      const r = indexedDB.open('rada-local-sounds', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('sounds', { keyPath: 'name' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('Cannot open local storage.'));
      r.onblocked = () => reject(new Error('Local storage is blocked by another tab.'));
    });
  }
  async function transaction(mode, run) {
    const d = await db();
    try {
      return await new Promise((resolve, reject) => {
        const t = d.transaction('sounds', mode), r = run(t.objectStore('sounds'));
        let result;
        r.onsuccess = () => { result = r.result; };
        r.onerror = () => reject(r.error || new Error('Storage failed.'));
        t.oncomplete = () => resolve(result);
        t.onabort = t.onerror = () => reject(t.error || new Error('Storage failed.'));
      });
    } finally { d.close(); }
  }
  const get = n => transaction('readonly', s => s.get(n));
  const all = () => transaction('readonly', s => s.getAllKeys());
  async function put(n, file) {
    if (!valid(n)) throw new Error('Choose a sound name.');
    if (!file || !file.size || file.size > maxBytes) throw new Error('Choose a non-empty audio file of at most 5 MB.');
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name)) throw new Error('Choose an audio file.');
    await transaction('readwrite', s => s.put({ name: n, audio: file }));
  }
  async function remove(n) { await transaction('readwrite', s => s.delete(n)); }
  function playback(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob), a = new Audio(url);
      let finished = false;
      const timer = setTimeout(() => done(new Error('Playback timed out.')), 30000);
      function done(err) {
        if (finished) return;
        finished = true; clearTimeout(timer); a.pause(); a.removeAttribute('src'); a.load(); URL.revokeObjectURL(url);
        err ? reject(err) : resolve();
      }
      a.onended = () => done();
      a.onerror = () => done(new Error('This browser cannot play that file.'));
      try { Promise.resolve(a.play()).catch(() => done(new Error('Playback was blocked or the audio format is unsupported.'))); }
      catch (_) { done(new Error('Playback was blocked or the audio format is unsupported.')); }
    });
  }
  // Returns a promise; the caller can supply the original receive tone as fallback.
  async function play(fallback) {
    const n = selected();
    if (n === 'none') return;
    if (n === 'default') { fallback(); return; }
    const record = await get(n);
    if (!record || !(record.audio instanceof Blob)) throw new Error('Sound file is missing on this device.');
    await playback(record.audio);
  }
  function mount(pane, fallback) {
    const box = document.createElement('section'); box.className = 'set-form';
    box.innerHTML = `<h4>Incoming notification sound</h4>
      <p>These names do not include audio. Add your own files that you have permission to use. Files stay in this browser on this device; they are not uploaded or synced.</p>
      <label>Sound for incoming notifications <select id="local-sound-active"></select></label>
      <label>Sound name to add or replace <select id="local-sound-name"></select></label>
      <label>Audio file (up to 5 MB) <input id="local-sound-file" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm"></label>
      <button class="primary" id="local-sound-import" type="button">Add or replace file</button>
      <button class="primary ghostbtn" id="local-sound-preview" type="button">Preview selected sound</button>
      <button class="primary ghostbtn" id="local-sound-delete" type="button">Delete file for chosen name</button>
      <p id="local-sound-status" role="status" aria-live="polite"></p>
      <p>Custom sounds work only while the app can play audio. Background web push and system notifications use browser/device sounds and may not use this choice; browsers may block autoplay. The sound switch also controls send sounds. None silences incoming sounds only.</p>`;
    pane.appendChild(box);
    const active = box.querySelector('#local-sound-active'), name = box.querySelector('#local-sound-name'), input = box.querySelector('#local-sound-file'), status = box.querySelector('#local-sound-status');
    const say = m => { status.textContent = m; };
    async function refresh() {
      const keys = await all(), present = new Set(keys);
      const chosen = selected();
      if (valid(chosen) && !present.has(chosen)) setSelected('default');
      active.replaceChildren();
      for (const [value, label, disabled] of [['default', 'Default (existing sound)', false], ['none', 'None (silence)', false], ...names.map(n => [n, n + (present.has(n) ? ' (file added)' : ' (needs audio)'), !present.has(n)])]) {
        const o = new Option(label, value); o.disabled = disabled; active.add(o);
      }
      active.value = selected();
      const previous = name.value;
      name.replaceChildren();
      for (const n of names) name.add(new Option(n + (present.has(n) ? ' (file added)' : ' (needs audio)'), n));
      if (valid(previous)) name.value = previous;
    }
    const error = e => say(e && e.message ? e.message : 'Local sound storage is unavailable.');
    refresh().catch(error);
    active.onchange = () => { try { setSelected(active.value); say('Incoming sound saved on this device.'); } catch (e) { error(e); refresh().catch(error); } };
    box.querySelector('#local-sound-import').onclick = async () => {
      try { await put(name.value, input.files[0]); input.value = ''; await refresh(); say('File saved locally. Select it above to use it.'); } catch (e) { error(e); }
    };
    box.querySelector('#local-sound-delete').onclick = async () => {
      try {
        const n = name.value;
        await remove(n);
        if (selected() === n) setSelected('default');
        await refresh(); say('Local file deleted. If it was selected, the default sound is restored.');
      } catch (e) { error(e); }
    };
    box.querySelector('#local-sound-preview').onclick = async () => {
      try {
        if (localStorage.getItem('chat-sound') === 'off') return say('Turn on notification sounds to preview.');
        if (selected() === 'none') return say('None is selected: incoming notifications are silent.');
        say('Playing preview…'); await play(fallback); say('Preview finished.');
      } catch (e) { error(e); }
    };
  }
  window.RadaSounds = { play, mount };
})();
