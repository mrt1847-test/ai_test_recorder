import { initializeContentScript } from './init.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript, { once: true });
} else {
  initializeContentScript();
}

