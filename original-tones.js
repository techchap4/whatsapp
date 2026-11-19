/* Original synthesized alternatives for Rada; not Xiaomi audio or recordings. */
(() => {
  'use strict';
  // Notes: [start, duration, start Hz, end Hz, waveform, peak, attack seconds].
  // Distinct short motifs, original oscillator/envelope recipes; no external assets.
  const scores = {
    Bottle: [[0,.35,620,580,'sine',.14,.008],[.01,.22,1250,1180,'sine',.045,.005]],
    Bubble: [[0,.12,420,780,'sine',.11,.015],[.14,.14,520,940,'sine',.10,.01],[.31,.12,600,1050,'sine',.08,.01]],
    Bullfrog: [[0,.22,150,105,'triangle',.15,.018],[.26,.24,175,115,'triangle',.14,.02]],
    Burst: [[0,.07,1150,450,'sawtooth',.05,.004],[.09,.12,800,250,'triangle',.11,.004]],
    Chirp: [[0,.10,1050,1650,'sine',.10,.01],[.12,.14,1300,1950,'sine',.09,.01]],
    Clank: [[0,.22,430,420,'square',.045,.004],[.003,.25,1173,1150,'triangle',.08,.004],[.005,.18,1895,1860,'sine',.06,.004]],
    Crystal: [[0,.42,1320,1320,'sine',.11,.005],[.06,.35,1980,1980,'sine',.055,.005],[.15,.29,2640,2640,'sine',.035,.005]],
    FadeIn: [[0,.65,660,880,'sine',.13,.45]],
    FadeOut: [[0,.70,880,660,'triangle',.13,.012]],
    Flute: [[0,.27,784,784,'sine',.12,.05],[.29,.34,988,988,'sine',.12,.05]],
    Fresh: [[0,.13,740,740,'triangle',.09,.008],[.14,.13,988,988,'triangle',.10,.008],[.28,.22,1319,1319,'sine',.11,.008]],
    Frog: [[0,.10,330,200,'square',.06,.006],[.14,.10,360,210,'square',.06,.006],[.28,.12,300,180,'triangle',.11,.006]],
    Guitar: [[0,.34,392,390,'triangle',.10,.004],[.045,.34,494,492,'triangle',.09,.004],[.09,.40,587,585,'triangle',.08,.004]],
    Harp: [[0,.38,523,523,'sine',.12,.005],[.11,.40,659,659,'sine',.11,.005],[.22,.42,784,784,'sine',.10,.005]],
    Moment: [[0,.23,659,659,'sine',.10,.025],[.25,.42,784,784,'sine',.11,.025]],
    NotificationXylophone: [[0,.17,880,880,'triangle',.10,.004],[.15,.17,1109,1109,'triangle',.10,.004],[.30,.24,1319,1319,'triangle',.10,.004]],
    Potion: [[0,.18,480,720,'sine',.09,.02],[.19,.19,610,1030,'sine',.10,.015],[.39,.25,770,1250,'triangle',.08,.01]],
    Radar: [[0,.13,1050,1050,'sine',.12,.006],[.22,.13,1050,1050,'sine',.12,.006],[.44,.13,1050,1050,'sine',.12,.006]],
    Spring: [[0,.34,950,330,'triangle',.12,.006],[.10,.23,720,460,'sine',.07,.006]]
  };
  function play(ctx, name) {
    const notes = scores[name];
    if (!notes) throw new Error('Unknown sound.');
    if (!ctx || (ctx.state !== 'running' && !(typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext))) throw new Error('Audio is blocked. Tap the app and try preview again.');
    const base = ctx.currentTime + .01;
    let end = 0;
    for (const [start, duration, from, to, wave, peak, attack] of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = base + start;
      o.type = wave; o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + duration);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(.0001, t + duration);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + duration + .01);
      end = Math.max(end, start + duration);
    }
    return end;
  }
  window.RadaOriginalTones = { names: Object.keys(scores), play };
})();
