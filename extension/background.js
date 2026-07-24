// background.js — Service worker for the Share Together extension

// Cache for generated summaries (keyed by URL)
async function getCachedResult(url) {
  const data = await chrome.storage.local.get(['summaryCache']);
  const cache = data.summaryCache || {};
  return cache[url] || null;
}

async function setCachedResult(url, result) {
  const data = await chrome.storage.local.get(['summaryCache']);
  const cache = data.summaryCache || {};
  cache[url] = result;
  // Keep cache under 100 entries
  const keys = Object.keys(cache);
  if (keys.length > 100) {
    delete cache[keys[0]];
  }
  await chrome.storage.local.set({ summaryCache: cache });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_CACHED') {
    getCachedResult(message.url).then(sendResponse);
    return true;
  }
  if (message.type === 'SET_CACHED') {
    setCachedResult(message.url, message.result).then(() => sendResponse({ ok: true }));
    return true;
  }
});
