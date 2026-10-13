// Shared guard for callback APIs used by the isolated content scripts.
(() => {
  'use strict';
  let invalidated = false;
  function handleError(error) {
    if (!/extension context invalidated/i.test(String(error?.message || error || ''))) return;
    if (invalidated) return;
    invalidated = true;
    const show = () => {
      if (document.getElementById('harmonova-context-reload')) return;
      const notice = document.createElement('div');
      notice.id = 'harmonova-context-reload';
      notice.setAttribute('role', 'alert');
      const message = document.createElement('span');
      message.textContent = 'HarmoNova was reloaded or updated. Refresh this tab to reconnect.';
      const reload = document.createElement('button');
      reload.type = 'button';
      reload.textContent = 'Reload tab';
      reload.addEventListener('click', () => location.reload());
      notice.append(message, reload);
      document.documentElement.appendChild(notice);
    };
    if (document.documentElement) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  }
  function call(invoke, fallback) {
    return new Promise(resolve => {
      const fail = error => { handleError(error); resolve(fallback(error)); };
      try {
        invoke(response => {
          try {
            const error = chrome.runtime.lastError;
            if (error) fail(error);
            else resolve(response);
          } catch (error) { fail(error); }
        });
      } catch (error) { fail(error); }
    });
  }
  const send = message => call(callback => chrome.runtime.sendMessage(message, callback),
    error => ({ ok: false, message: String(error?.message || error || 'Unknown error') }))
    .then(response => response || { ok: false });
  function getURL(path) {
    try { return chrome.runtime.getURL(path); }
    catch (error) { handleError(error); return null; }
  }
  globalThis.HarmoNovaContentRuntime = Object.freeze({
    send, call, getURL, handleError,
    get invalidated() { return invalidated; },
  });
})();
