/* Purple theme extension. Load after app.js; existing theme options remain available. */
(() => {
  'use strict';
  if (typeof APP_THEMES === 'undefined' || typeof applyAppTheme !== 'function') return;
  if (!APP_THEMES.some(t => t.id === 'rada')) {
    APP_THEMES.unshift({id:'rada', name:'Rada Purple', vars:['#100d19','#1d1729','#f6f1ff','#9b5de5']});
  }
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const previous = localStorage.getItem('chatapp-app-theme');
      if (!localStorage.getItem('rada-purple-migrated-v1')) {
        // Move only the previous default; preserve explicitly chosen other themes.
        if (!previous || previous === 'classic') applyAppTheme('rada');
        localStorage.setItem('rada-purple-migrated-v1', '1');
      }
    } catch (e) { console.warn('Could not initialize Rada Purple theme', e); }
  });
})();
