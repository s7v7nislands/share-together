// popup.js — Main share flow for the extension popup

import { generateSummaryAndTags } from './ai.js';

const DEBUG = false;

function log(...args) {
  if (DEBUG) console.log('[ShareTogether:Popup]', ...args);
}

// ---- DOM elements ----
const authNeeded = document.getElementById('auth-needed');
const loadingEl = document.getElementById('loading');
const shareForm = document.getElementById('share-form');
const loadingMsg = document.getElementById('loading-msg');
const roomSelect = document.getElementById('room-select');
const summaryField = document.getElementById('summary-field');
const tagsList = document.getElementById('tags-list');
const tagInput = document.getElementById('tag-input');
const btnShare = document.getElementById('btn-share');
const btnRegenerate = document.getElementById('btn-regenerate');
const btnGoOptions = document.getElementById('btn-go-options');
const openOptionsLink = document.getElementById('open-options');
const errorMsg = document.getElementById('error-msg');
const successMsg = document.getElementById('success-msg');

let currentTags = [];
let currentTabUrl = '';
let pageTitle = '';
let pageText = '';
let pageMetaDesc = '';

// ---- Init ----
document.addEventListener('DOMContentLoaded', init);

async function init() {

  // Check auth and config
  const settings = await chrome.storage.local.get(['session', 'apiConfig', 'lastRoom']);
  log('settings loaded — hasSession:', !!settings.session, 'hasApiKey:', !!settings.apiConfig?.apiKey, 'provider:', settings.apiConfig?.provider);

  if (!settings.session || !settings.apiConfig?.apiKey) {
    log('auth or API key missing, showing auth-needed');
    showAuthNeeded();
    return;
  }

  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    showError('Could not access current tab');
    return;
  }

  currentTabUrl = tab.url;
  log('current tab:', currentTabUrl);

  // Load rooms and show share form
  await loadRooms(settings.session, settings.lastRoom);
  shareForm.classList.remove('hidden');

  // Check cache first
  const cached = await chrome.runtime.sendMessage({ type: 'GET_CACHED', url: currentTabUrl });
  if (cached) {
    log('using cached result for', currentTabUrl);
    populateFields(cached.summary, cached.tags);
    return;
  }

  log('no cache, generating summary');
  // Extract text and generate
  await generateSummary(settings.apiConfig, tab.id);
}

// ---- Auth needed ----
function showAuthNeeded() {
  authNeeded.classList.remove('hidden');
  loadingEl.classList.add('hidden');
  shareForm.classList.add('hidden');
}

btnGoOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ---- Base URL from profiles ----
async function getBaseUrl() {
  const settings = await chrome.storage.local.get(['profiles', 'activeProfileId', 'apiBaseUrl']);
  // If profiles exist, use active profile
  if (settings.activeProfileId && settings.profiles?.length > 0) {
    const p = settings.profiles.find(p => p.id === settings.activeProfileId);
    if (p) return p.url;
  }
  // Fallback to legacy flat setting
  return settings.apiBaseUrl || null;
}

openOptionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ---- Room loading ----
async function loadRooms(session, lastRoom) {
  try {
    const baseUrl = await getBaseUrl();
    if (!baseUrl) {
      showError('No server configured. Please add a profile in settings.');
      return;
    }

    const response = await fetch(`${baseUrl}/api/rooms`, {
      headers: { 'Authorization': `Bearer ${session.token}` }
    });

    log('rooms response status:', response.status);
    if (!response.ok) {
      log('failed to load rooms, status:', response.status);
      showError('Failed to load rooms. Please re-login in settings.');
      return;
    }

    const data = await response.json();
    log('loaded', data.rooms?.length, 'rooms');
    roomSelect.innerHTML = '<option value="">Select a room...</option>';

    for (const room of data.rooms) {
      const opt = document.createElement('option');
      opt.value = room.slug;
      opt.textContent = room.name || room.slug;
      if (room.slug === lastRoom) opt.selected = true;
      roomSelect.appendChild(opt);
    }

    // Fallback: select first room if lastRoom not found
    if (lastRoom && !data.rooms.find(r => r.slug === lastRoom)) {
      roomSelect.selectedIndex = 0;
    }
  } catch (err) {
    log('loadRooms error:', err.message);
    showError('Could not connect to Share Together. Check your server URL in settings.');
  }
}

// ---- Summary generation ----
async function generateSummary(apiConfig, tabId) {
  showLoading('Extracting article text...');

  // Extract text from content script
  let pageData;
  try {
    pageData = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_TEXT' });
    if (!pageData) {
      showError('Content script not ready. Try refreshing the page.');
      return;
    }
  } catch (err) {
    showError('Cannot read this page. Try a different page or refresh.');
    return;
  }

  pageTitle = pageData.title;
  pageText = pageData.text;
  pageMetaDesc = pageData.metaDescription;
  log('extracted text — title:', pageTitle?.slice(0, 80), 'textLen:', pageText?.length, 'metaDescLen:', pageMetaDesc?.length);

  if (!pageText || pageText.length < 100) {
    log('not enough content, text length:', pageText?.length || 0);
    showError('Not enough content on this page to summarize.');
    return;
  }

  showLoading('Generating summary with AI...');

  try {
    const result = await generateSummaryAndTags(apiConfig, {
      title: pageTitle,
      text: pageText,
      metaDescription: pageMetaDesc
    });

    // Cache result
    await chrome.runtime.sendMessage({
      type: 'SET_CACHED',
      url: currentTabUrl,
      result
    });

    populateFields(result.summary, result.tags);
  } catch (err) {
    log('AI generation failed: ' + err.message);
    console.error('[ShareTogether] AI error:', err);
    debugLog('ERROR: ' + err.message);
    showError(`AI generation failed: ${err.message || 'Unknown error'}. You can still type manually.`);
    // Still show the form with empty fields
    shareForm.classList.remove('hidden');
    loadingEl.classList.add('hidden');
  }
}

// ---- Populate fields ----
function populateFields(summary, tags) {
  summaryField.value = summary || '';
  currentTags = tags || [];
  renderTags();
  shareForm.classList.remove('hidden');
  loadingEl.classList.add('hidden');
}

// ---- Loading state ----
function showLoading(msg) {
  loadingEl.classList.remove('hidden');
  shareForm.classList.add('hidden');
  loadingMsg.textContent = msg;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  shareForm.classList.remove('hidden');
  loadingEl.classList.add('hidden');
}

// ---- Tags UI ----
function renderTags() {
  tagsList.innerHTML = '';
  for (const tag of currentTags) {
    const el = document.createElement('span');
    el.className = 'tag';
    el.innerHTML = `${escapeHtml(tag)}<span class="tag-remove" data-tag="${escapeHtml(tag)}">&times;</span>`;
    tagsList.appendChild(el);
  }
}

tagsList.addEventListener('click', (e) => {
  if (e.target.classList.contains('tag-remove')) {
    const tag = e.target.dataset.tag;
    currentTags = currentTags.filter(t => t !== tag);
    renderTags();
  }
});

tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(tagInput.value);
  }
});

tagInput.addEventListener('blur', () => {
  if (tagInput.value.trim()) {
    addTag(tagInput.value);
  }
});

function addTag(value) {
  const tag = value.trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, 32);
  if (!tag || currentTags.includes(tag)) {
    tagInput.value = '';
    return;
  }
  if (currentTags.length >= 8) return;
  currentTags.push(tag);
  tagInput.value = '';
  renderTags();
}

// ---- Regenerate ----
btnRegenerate.addEventListener('click', async () => {
  const settings = await chrome.storage.local.get(['apiConfig']);
  if (!settings.apiConfig?.apiKey) {
    showError('AI provider not configured. Check settings.');
    return;
  }

  // Clear cache and regenerate
  await chrome.runtime.sendMessage({ type: 'SET_CACHED', url: currentTabUrl, result: null });

  errorMsg.classList.add('hidden');
  successMsg.classList.add('hidden');
  await generateSummary(settings.apiConfig, (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
});

// ---- Share ----
btnShare.addEventListener('click', async () => {
  const slug = roomSelect.value;
  if (!slug) {
    showError('Please select a room.');
    return;
  }

  log('sharing to room:', slug);
  const settings = await chrome.storage.local.get(['session']);
  const baseUrl = await getBaseUrl();
  if (!baseUrl) {
    showError('No server configured. Please add a profile in settings.');
    btnShare.disabled = false;
    btnShare.textContent = 'Share';
    return;
  }

  // Save last room
  await chrome.storage.local.set({ lastRoom: slug });

  btnShare.disabled = true;
  btnShare.textContent = 'Sharing...';
  errorMsg.classList.add('hidden');
  successMsg.classList.add('hidden');

  try {
    const response = await fetch(`${baseUrl}/api/rooms/${slug}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.session.token}`
      },
      body: JSON.stringify({
        url: currentTabUrl,
        tags: currentTags,
        ai_summary: summaryField.value.trim() || null
      })
    });

    log('share response status:', response.status);
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Request failed' }));
      log('share failed:', response.status, err);
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    log('share succeeded, duplicate:', !!data.duplicate);
    if (data.duplicate) {
      successMsg.textContent = '⚠️ Already shared in this room';
    } else {
      successMsg.textContent = '✅ Shared!';
    }
    successMsg.classList.remove('hidden');

    // Close popup after short delay
    setTimeout(() => window.close(), 1500);
  } catch (err) {
    log('share error:', err.message);
    showError(`Share failed: ${err.message}`);
  } finally {
    btnShare.disabled = false;
    btnShare.textContent = 'Share';
  }
});

// ---- Helpers ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
