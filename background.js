/**
 * Background Service Worker with Tab Screenshot Capture for Vision AI
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    autoRedact: false
  });
  console.log('PII AI Redactor Extension installed successfully.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'UPDATE_BADGE') {
    const count = request.count;
    const tabId = sender.tab ? sender.tab.id : null;
    
    if (tabId) {
      if (count > 0) {
        chrome.action.setBadgeText({ tabId, text: count.toString() });
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#0ea5e9' });
      } else {
        chrome.action.setBadgeText({ tabId, text: '' });
      }
    }
  } else if (request.action === 'CAPTURE_VISIBLE_TAB') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, dataUrl });
      }
    });
    return true; // Keep response channel open async
  }
  return true;
});
