// popup.js - simple UI to view recorded events and generate a Playwright-like snippet
document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const eventsList = document.getElementById('eventsList');
  const codeBlock = document.getElementById('codeBlock');
  const copyBtn = document.getElementById('copyBtn');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const tcInput = document.getElementById('tcInput');

  let recording = false;

  startBtn.addEventListener('click', () => {
    recording = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    // Notify user
    chrome.notifications?.create({ type: 'basic', title: 'Recorder', message: 'Recording started' });
  });

  stopBtn.addEventListener('click', async () => {
    recording = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    await refreshEvents();
  });

  clearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_EVENTS' }, () => {
      eventsList.innerHTML = '';
      codeBlock.textContent = '// Recorded code will appear here';
    });
  });

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(codeBlock.textContent);
  });

  analyzeBtn.addEventListener('click', async () => {
    // For MVP we'll do local analysis: mark text-based selectors as low stability
    const events = await getEvents();
    const suggested = events.map(e => {
      const stability = e.selector && /text=|text\=|text"/.test(e.selector) ? 'low' : 'high';
      return { ...e, stability };
    });
    renderEvents(suggested);
    // generate code snippet
    const snippet = generatePlaywrightSnippet(suggested, tcInput.value);
    codeBlock.textContent = snippet;
  });

  async function getEvents() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_EVENTS' }, (resp) => {
        resolve(resp?.events || []);
      });
    });
  }

  async function refreshEvents() {
    const events = await getEvents();
    renderEvents(events);
    codeBlock.textContent = generatePlaywrightSnippet(events, tcInput.value);
  }

  function renderEvents(events) {
    eventsList.innerHTML = '';
    for (const ev of events) {
      const li = document.createElement('li');
      li.textContent = `[${new Date(ev.timestamp).toLocaleTimeString()}] ${ev.action} → ${ev.selector || ev.tag} ${ev.value ? ' value='+ev.value : ''}`;
      eventsList.appendChild(li);
    }
  }

  function generatePlaywrightSnippet(events, tcText) {
    const lines = [];
    lines.push("test('Recorded test', async ({ page }) => {");
    lines.push("  await page.goto('REPLACE_WITH_URL');");
    for (const ev of events) {
      if (!ev.selector) continue;
      if (ev.action === 'click') {
        lines.push(`  await page.click('${ev.selector}');`);
      } else if (ev.action === 'change') {
        lines.push(`  await page.fill('${ev.selector}', '${ev.value || ''}');`);
      }
    }
    if (tcText) {
      lines.push(`  // TC: ${tcText}`);
    }
    lines.push("});");
    return lines.join('\n');
  }

  // Initial load
  refreshEvents();
});
