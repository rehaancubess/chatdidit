(() => {
  'use strict';
  const ext = window.Twitch?.ext;
  const form = document.getElementById('configuration-form');
  const input = document.getElementById('backend-url');
  const save = document.getElementById('save-button');
  const feedback = document.getElementById('feedback');
  const dashboard = document.getElementById('dashboard-link');
  let authorized = false;
  function validBackend(value) {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    )
      throw new Error('Use an HTTPS backend URL (HTTP is allowed only on localhost).');
    if (url.username || url.password || url.search || url.hash)
      throw new Error('Enter the backend origin only, without credentials or query parameters.');
    return url.origin;
  }
  function showLink(value) {
    try {
      dashboard.href = validBackend(value) + '/';
      dashboard.hidden = false;
    } catch {
      dashboard.hidden = true;
    }
  }
  function loadConfig() {
    try {
      const raw = ext.configuration.broadcaster?.content || ext.configuration.developer?.content;
      const value = raw ? JSON.parse(raw).backendUrl : '';
      if (value) {
        input.value = validBackend(value);
        showLink(value);
      }
    } catch {
      feedback.textContent = 'Saved configuration could not be read. Enter your backend URL again.';
    }
  }
  if (!ext) {
    feedback.textContent = 'Open this page through Twitch Extension Local Test to configure it.';
    return;
  }
  ext.onAuthorized((auth) => {
    // Broadcaster role is supplied by the signed Twitch context, never inferred from a URL.
    try {
      const body = JSON.parse(atob(auth.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      authorized = body.role === 'broadcaster';
    } catch {
      authorized = false;
    }
    save.disabled = !authorized;
    feedback.textContent = authorized
      ? 'Connected to Twitch. Set the URL of your ChatDidIt backend.'
      : 'Only the broadcaster can save this configuration.';
    loadConfig();
  });
  ext.configuration.onChanged(loadConfig);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!authorized) return;
    try {
      const backendUrl = validBackend(input.value.trim());
      ext.configuration.set('broadcaster', '1', JSON.stringify({ backendUrl }));
      input.value = backendUrl;
      showLink(backendUrl);
      feedback.classList.remove('error');
      feedback.textContent = 'Configuration saved. Your viewer panel will connect automatically.';
    } catch (error) {
      feedback.classList.add('error');
      feedback.textContent = error.message || 'Could not save configuration.';
    }
  });
})();
