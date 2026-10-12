/* ChatApp PWA: install button (browser only), service worker, phone-friendly behaviour */
(() => {
  const $ = (id) => document.getElementById(id);
  const ua = navigator.userAgent || '';

  /* ---- service worker (needed for install + offline shell) ---- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e)));
  }

  /* ---- are we already running as an installed app? ---- */
  const standalone = () =>
    ['standalone', 'fullscreen', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches) ||
    navigator.standalone === true || new URLSearchParams(location.search).get('source') === 'pwa';
  const markMode = () => document.documentElement.classList.toggle('is-app', standalone());
  markMode();
  try { matchMedia('(display-mode: standalone)').addEventListener('change', () => { markMode(); refresh(); }); } catch (e) {}

  /* ---- install prompt ---- */
  let deferred = null, installed = false;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(ua);
  const inAppBrowser = /FBAN|FBAV|Instagram|Line\/|TikTok|Snapchat|MicroMessenger|; wv\)/i.test(ua);
  const iosNotSafari = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const DISMISS_KEY = 'chatapp.installBannerDismissed';

  const dismissedRecently = () => { try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < 3 * 864e5; } catch (e) { return false; } };

  function refresh() {
    const show = !standalone() && !installed;
    ['install-auth', 'btn-install'].forEach((id) => $(id) && $(id).classList.toggle('hidden', !show));
    const appVisible = $('app') && !$('app').classList.contains('hidden');
    $('install-banner') && $('install-banner').classList.toggle('hidden', !(show && appVisible && !dismissedRecently()));
  }

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; refresh(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; closeHelp(); refresh(); });

  async function install() {
    if (deferred) {
      deferred.prompt();
      try { const { outcome } = await deferred.userChoice; if (outcome === 'accepted') installed = true; } catch (e) {}
      deferred = null; refresh();
    } else openHelp();
  }

  /* ---- "how to install" sheet (iPhone, Firefox, in-app browsers, no prompt available) ---- */
  function helpHtml() {
    const secure = window.isSecureContext;
    let s = '';
    if (!secure) s += '<p class="warn">Installing needs a secure (https) address. Open the site with https:// first.</p>';
    if (inAppBrowser) {
      s += '<ol><li>Tap the <b>⋮</b> or <b>•••</b> menu at the corner of this screen.</li><li>Choose <b>Open in browser</b> (Chrome on Android, Safari on iPhone).</li><li>Then tap <b>Install ChatApp</b> again.</li></ol>';
    } else if (isIOS) {
      s += iosNotSafari ? '<p>On iPhone/iPad, apps can only be added from <b>Safari</b>. Open this page in Safari first.</p>' : '';
      s += '<ol><li>Tap the <b>Share</b> button <span class="ic">⎋</span> (square with an arrow) in Safari.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. ChatApp now opens full screen from your home screen.</li></ol>';
    } else if (isAndroid) {
      s += '<ol><li>Tap the browser menu <b>⋮</b> (top right).</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</li><li>Confirm with <b>Install</b>.</li></ol>';
    } else {
      s += '<ol><li>Look for the <b>install</b> icon <span class="ic">⊕</span> at the right end of the address bar, or open the browser menu.</li><li>Choose <b>Install ChatApp</b>.</li></ol>';
    }
    return s;
  }
  function openHelp() { $('install-help-body').innerHTML = helpHtml(); $('modal-install').classList.remove('hidden'); }
  function closeHelp() { $('modal-install') && $('modal-install').classList.add('hidden'); }

  ['install-auth', 'btn-install', 'install-banner-btn'].forEach((id) => $(id) && $(id).addEventListener('click', install));
  $('install-banner-x') && $('install-banner-x').addEventListener('click', () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {} refresh(); });
  $('modal-install') && $('modal-install').addEventListener('click', (e) => { if (e.target === $('modal-install') || e.target.closest('[data-close-install]')) closeHelp(); });

  // show/hide the banner when the login screen switches to the app
  if ($('app')) new MutationObserver(refresh).observe($('app'), { attributes: true, attributeFilter: ['class'] });
  refresh();

  /* ---- phone behaviour ---- */
  // keep the page from scrolling behind the app when the keyboard opens (iOS)
  if (window.visualViewport) window.visualViewport.addEventListener('scroll', () => { if (window.scrollY) window.scrollTo(0, 0); });

  // Android/phone back button: close the open chat instead of leaving the app
  if ($('app')) {
    const isOpen = () => $('app').classList.contains('chat-open');
    new MutationObserver(() => {
      if (isOpen() && !(history.state && history.state.chat)) history.pushState({ chat: 1 }, '');
      else if (!isOpen() && history.state && history.state.chat) history.back();
    }).observe($('app'), { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('popstate', () => { if (isOpen() && $('btn-back')) $('btn-back').click(); });
  }
})();