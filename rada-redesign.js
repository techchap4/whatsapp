/* Reposition the existing notification button without replacing its handler. */
(() => {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  function placeBell() {
    const bell = document.getElementById('btn-bell');
    const camera = document.getElementById('btn-cam-status');
    if (bell && camera && bell.parentNode !== camera.parentNode) camera.before(bell);
  }
  new MutationObserver(placeBell).observe(sidebar, { childList: true, subtree: true });
  placeBell();
})();
