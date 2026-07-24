// options.js — Settings page for Share Together extension

document.addEventListener('DOMContentLoaded', init);

// ---- DOM elements ----
const profilesList = document.getElementById('profiles-list');
const profileName = document.getElementById('profile-name');
const profileUrl = document.getElementById('profile-url');
const btnAddProfile = document.getElementById('btn-add-profile');
const btnCancelProfile = document.getElementById('btn-cancel-profile');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const btnLogin = document.getElementById('btn-login');
const btnRegister = document.getElementById('btn-register');
const btnLogout = document.getElementById('btn-logout');
const authError = document.getElementById('auth-error');
const loggedOutState = document.getElementById('logged-out-state');
const loggedInState = document.getElementById('logged-in-state');
const loggedInUser = document.getElementById('logged-in-user');
const aiProvider = document.getElementById('ai-provider');
const aiApiKey = document.getElementById('ai-api-key');
const aiModel = document.getElementById('ai-model');
const btnSave = document.getElementById('btn-save');
const saveMsg = document.getElementById('save-msg');

let profiles = [];
let activeProfileId = null;
let editingProfileId = null;

// ---- Init ----
async function init() {
  const settings = await chrome.storage.local.get([
    'profiles', 'activeProfileId', 'session', 'apiConfig'
  ]);

  profiles = settings.profiles || [];
  activeProfileId = settings.activeProfileId || null;

  // Auto-migrate legacy apiBaseUrl to a profile
  if (profiles.length === 0 && settings.apiBaseUrl) {
    profiles.push({
      id: crypto.randomUUID(),
      name: 'Default',
      url: settings.apiBaseUrl.replace(/\/+$/, '')
    });
    activeProfileId = profiles[0].id;
    await chrome.storage.local.set({ profiles, activeProfileId });
  }

  if (settings.apiConfig) {
    aiProvider.value = settings.apiConfig.provider || 'openai';
    aiApiKey.value = settings.apiConfig.apiKey || '';
    aiModel.value = settings.apiConfig.model || '';
  }

  if (settings.session) {
    showLoggedIn(settings.session.username);
  }

  renderProfiles();
}

// ---- Profiles ----
function renderProfiles() {
  profilesList.innerHTML = '';

  if (profiles.length === 0) {
    profilesList.innerHTML = '<p class="hint" style="padding:8px 0;">No profiles yet. Add one below.</p>';
    return;
  }

  for (const p of profiles) {
    const isActive = p.id === activeProfileId;
    const el = document.createElement('div');
    el.className = 'profile-card' + (isActive ? ' active' : '');
    el.innerHTML = `
      <div class="profile-info">
        <span class="profile-name">${escapeHtml(p.name)}</span>
        <span class="profile-url">${escapeHtml(p.url)}</span>
        ${isActive ? '<span class="profile-badge">active</span>' : ''}
      </div>
      <div class="profile-actions">
        ${isActive ? '' : `<button class="btn small" data-action="activate" data-id="${p.id}">Activate</button>`}
        <button class="btn small" data-action="edit" data-id="${p.id}">Edit</button>
        <button class="btn small danger" data-action="delete" data-id="${p.id}">Delete</button>
      </div>
    `;
    profilesList.appendChild(el);
  }

  // Event delegation for profile actions
  profilesList.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'activate') activateProfile(id);
    if (action === 'edit') editProfile(id);
    if (action === 'delete') deleteProfile(id);
  });
}

btnAddProfile.addEventListener('click', () => {
  const name = profileName.value.trim();
  const url = profileUrl.value.trim();

  if (!name || !url) return;

  if (editingProfileId) {
    // Update existing profile
    const idx = profiles.findIndex(p => p.id === editingProfileId);
    if (idx >= 0) {
      profiles[idx].name = name;
      profiles[idx].url = url;
    }
    editingProfileId = null;
    btnAddProfile.textContent = 'Add Profile';
    btnCancelProfile.classList.add('hidden');
  } else {
    // Add new profile
    profiles.push({
      id: crypto.randomUUID(),
      name,
      url: url.replace(/\/+$/, '') // strip trailing slash
    });
  }

  profileName.value = '';
  profileUrl.value = '';
  saveProfiles();
  renderProfiles();
});

btnCancelProfile.addEventListener('click', () => {
  editingProfileId = null;
  profileName.value = '';
  profileUrl.value = '';
  btnAddProfile.textContent = 'Add Profile';
  btnCancelProfile.classList.add('hidden');
});

function editProfile(id) {
  const p = profiles.find(p => p.id === id);
  if (!p) return;
  editingProfileId = id;
  profileName.value = p.name;
  profileUrl.value = p.url;
  btnAddProfile.textContent = 'Update';
  btnCancelProfile.classList.remove('hidden');
  profileName.focus();
}

function deleteProfile(id) {
  if (!confirm('Delete this profile?')) return;
  profiles = profiles.filter(p => p.id !== id);
  if (activeProfileId === id) {
    activeProfileId = profiles.length > 0 ? profiles[0].id : null;
  }
  saveProfiles();
  renderProfiles();
}

function activateProfile(id) {
  activeProfileId = id;
  saveProfiles();
  renderProfiles();
}

async function saveProfiles() {
  await chrome.storage.local.set({ profiles, activeProfileId });
}

// ---- Login / Register ----
btnLogin.addEventListener('click', () => handleAuth('login'));
btnRegister.addEventListener('click', () => handleAuth('register'));

async function handleAuth(action) {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;

  if (!username || !password) {
    showAuthError('Please enter both username and password.');
    return;
  }

  const baseUrl = getActiveProfileUrl();
  if (!baseUrl) {
    showAuthError('No active profile. Please add and activate a server profile first.');
    return;
  }

  authError.classList.add('hidden');

  try {
    const endpoint = action === 'register' ? '/api/auth/register' : '/api/auth/login';
    const body = action === 'register'
      ? { username, password, confirm_password: password }
      : { username, password };

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    await chrome.storage.local.set({
      session: { token: data.session.token, username: data.user.username }
    });

    showLoggedIn(data.user.username);
  } catch (err) {
    showAuthError(err.message);
  }
}

function showLoggedIn(username) {
  loggedOutState.classList.add('hidden');
  loggedInState.classList.remove('hidden');
  loggedInUser.textContent = username;
}

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.remove('hidden');
}

// ---- Logout ----
btnLogout.addEventListener('click', async () => {
  const baseUrl = getActiveProfileUrl();
  const settings = await chrome.storage.local.get(['session']);

  if (settings.session && baseUrl) {
    try {
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${settings.session.token}` }
      });
    } catch {
      // Ignore
    }
  }

  await chrome.storage.local.remove('session');
  loggedOutState.classList.remove('hidden');
  loggedInState.classList.add('hidden');
  loginUsername.value = '';
  loginPassword.value = '';
});

// ---- Save AI settings ----
btnSave.addEventListener('click', async () => {
  const provider = aiProvider.value;
  const apiKey = aiApiKey.value.trim();
  const model = aiModel.value.trim();

  await chrome.storage.local.set({
    apiConfig: {
      provider,
      apiKey: apiKey || null,
      model: model || null
    }
  });

  saveMsg.classList.remove('hidden');
  setTimeout(() => saveMsg.classList.add('hidden'), 2000);
});

// ---- Helpers ----
function getActiveProfileUrl() {
  if (!activeProfileId || profiles.length === 0) return null;
  const p = profiles.find(p => p.id === activeProfileId);
  return p ? p.url : null;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
