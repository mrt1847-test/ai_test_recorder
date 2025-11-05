// background.js - handles messages and simple storage proxy
chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Test Recorder background installed');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'RECORD_EVENT') {
    // For MVP we persist events in chrome.storage.local as an array
    chrome.storage.local.get({ events: [] }, (res) => {
      const events = res.events || [];
      events.push(msg.event);
      chrome.storage.local.set({ events }, () => {
        // Ack
        sendResponse({ ok: true, length: events.length });
      });
    });
    // Return true to indicate async sendResponse
    return true;
  } else if (msg?.type === 'GET_EVENTS') {
    chrome.storage.local.get({ events: [] }, (res) => {
      sendResponse({ events: res.events || [] });
    });
    return true;
  } else if (msg?.type === 'CLEAR_EVENTS') {
    chrome.storage.local.set({ events: [] }, () => sendResponse({ ok: true }));
    return true;
  }
});
