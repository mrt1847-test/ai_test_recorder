chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Test Recorder installed');
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'GET_EVENTS') {
    chrome.storage.local.get({events:[]}, res => sendResponse({events: res.events || []}));
    return true;
  }
  if (msg && msg.type === 'SAVE_EVENT') {
    chrome.storage.local.get({events:[]}, res => {
      const evs = res.events || [];
      evs.push(msg.event);
      chrome.storage.local.set({events: evs}, () => sendResponse({ok:true}));
    });
    return true;
  }
});