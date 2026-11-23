// Loads the User Memory settings panel (repo openwebui-user-memory-filter,
// frontend/user_memory_panel.js), served as /static/user-memory-panel.js.
// Paste this block at the end of the site's /static/loader.js.
(function () {
  const script = document.createElement('script');
  script.src = '/static/user-memory-panel.js';
  script.defer = true;
  document.head.appendChild(script);
})();
