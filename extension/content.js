// content.js — Extract readable text from the current page for AI summarization

const MAX_TEXT_CHARS = 8000;

function extractArticleText() {
  // Try article-specific selectors first
  const articleSelectors = [
    'article',
    '[role="article"]',
    '.article-body',
    '.article-content',
    '.post-content',
    '.entry-content',
    '.story-body',
    'main',
    '[data-component="text"]'
  ];

  for (const selector of articleSelectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim().length > 200) {
      return el.textContent.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
    }
  }

  // Fallback: extract from body, excluding nav, footer, scripts, etc.
  const body = document.body.cloneNode(true);
  const removeSelectors = [
    'script', 'style', 'nav', 'footer', 'header',
    '.sidebar', '.nav', '.menu', '.comments',
    'noscript', 'iframe', 'svg', 'img', 'video'
  ];
  for (const sel of removeSelectors) {
    body.querySelectorAll(sel).forEach(el => el.remove());
  }

  return body.textContent.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

// Listen for extraction requests from the popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_TEXT') {
    const text = extractArticleText();
    const title = document.title || '';
    const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    sendResponse({ text, title, metaDescription });
  }
  return true; // keep channel open for async response
});
