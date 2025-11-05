// content.js - listens for user interactions and sends minimal event info to background
(function() {
  if (window.__ai_test_recorder_attached) return;
  window.__ai_test_recorder_attached = true;

  function generateSimpleSelector(el) {
    if (!el) return null;
    // Prefer data-testid > id > name > class > text (trim)
    const parts = [];
    if (el.dataset && el.dataset.testid) return `[data-testid="\${el.dataset.testid}"]`;
    if (el.id) return `#${el.id}`;
    if (el.getAttribute && el.getAttribute('name')) return `[name="${el.getAttribute('name')}"]`;
    if (el.classList && el.classList.length) {
      return '.' + Array.from(el.classList).slice(0,2).join('.');
    }
    const txt = (el.innerText || el.textContent || '').trim().split('\n')[0].trim();
    if (txt) return `text="${txt.slice(0,30)}"`;
    return el.tagName ? el.tagName.toLowerCase() : null;
  }

  function serializeEvent(e) {
    const target = e.target;
    const selector = generateSimpleSelector(target);
    const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : {};
    return {
      action: e.type,
      selector,
      tag: target.tagName,
      timestamp: Date.now(),
      x: Math.round(rect.x || 0),
      y: Math.round(rect.y || 0),
    };
  }

  // Listen for clicks and input changes (basic)
  document.addEventListener('click', (e) => {
    const ev = serializeEvent(e);
    chrome.runtime.sendMessage({ type: 'RECORD_EVENT', event: ev }, (resp) => {});
  }, true);

  document.addEventListener('change', (e) => {
    const ev = serializeEvent(e);
    ev.value = e.target.value || null;
    chrome.runtime.sendMessage({ type: 'RECORD_EVENT', event: ev }, (resp) => {});
  }, true);

  console.log('AI Test Recorder content script attached');
})();
