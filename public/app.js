const state = {
  roomSlug: roomSlugFromPath(),
  sort: "newest",
  selectedTag: null,
  links: [],
  clientId: getOrCreate("share_together_client_id", () => crypto.randomUUID()),
  adminKey: null,
  replies: {},
  expandedReplies: new Set(),
  session: getSession(),
  user: null,
  membership: null
};

const els = {
  app: document.querySelector("#app"),
  auth: document.querySelector("#auth"),
  authLogin: document.querySelector("#auth-login"),
  authRegister: document.querySelector("#auth-register"),
  authError: document.querySelector("#auth-error"),
  loginForm: document.querySelector("#login-form"),
  registerForm: document.querySelector("#register-form"),
  showRegister: document.querySelector("#show-register"),
  showLogin: document.querySelector("#show-login"),
  logoutBtn: document.querySelector("#logout-btn"),
  topbarUser: document.querySelector("#topbar-user"),
  topbar: document.querySelector("#topbar"),
  content: document.querySelector("#content"),
  home: document.querySelector("#home"),
  room: document.querySelector("#room"),
  createRoom: document.querySelector("#create-room"),
  homeCreateRoom: document.querySelector("#home-create-room"),
  roomNameInput: document.querySelector("#room-name-input"),
  roomListHeader: document.querySelector("#room-list-header"),
  roomList: document.querySelector("#room-list"),
  copyRoom: document.querySelector("#copy-room"),
  joinRoom: document.querySelector("#join-room"),
  manageRequests: document.querySelector("#manage-requests"),
  requestCount: document.querySelector("#request-count"),
  joinPending: document.querySelector("#join-pending"),
  joinRequestsPanel: document.querySelector("#join-requests-panel"),
  roomContent: document.querySelector("#room-content"),
  roomTitle: document.querySelector("#room-title"),
  form: document.querySelector("#submit-link"),
  urlInput: document.querySelector("#url-input"),
  tagsInput: document.querySelector("#tags-input"),
  recommendationInput: document.querySelector("#recommendation-input"),
  notice: document.querySelector("#notice"),
  tabs: document.querySelectorAll(".tab"),
  tagFilters: document.querySelector("#tag-filters"),
  links: document.querySelector("#links"),
  empty: document.querySelector("#empty")
};

// ==========================================================================
// Auth
// ==========================================================================

els.showRegister.addEventListener("click", () => {
  els.authLogin.classList.add("hidden");
  els.authRegister.classList.remove("hidden");
  els.authError.classList.add("hidden");
});

els.showLogin.addEventListener("click", () => {
  els.authRegister.classList.add("hidden");
  els.authLogin.classList.remove("hidden");
  els.authError.classList.add("hidden");
});

els.logoutBtn.addEventListener("click", async () => {
  if (state.session) {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  }
  clearSession();
  showAuth();
});

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.authError.classList.add("hidden");
  const username = els.loginForm.username.value.trim();
  const password = els.loginForm.password.value;
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: { username, password }
    });
    setSession(data.session);
    state.user = data.user;
    showContent();
  } catch (error) {
    showAuthError(error.message);
  }
});

els.registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.authError.classList.add("hidden");
  const username = els.registerForm.username.value.trim();
  const password = els.registerForm.password.value;
  const confirmPassword = els.registerForm.confirm_password.value;

  if (password !== confirmPassword) {
    showAuthError("Passwords do not match");
    return;
  }

  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: { username, password, confirm_password: confirmPassword }
    });
    setSession(data.session);
    state.user = data.user;
    showContent();
  } catch (error) {
    showAuthError(error.message);
  }
});

function showAuthError(message) {
  els.authError.textContent = message;
  els.authError.classList.remove("hidden");
}

function getSession() {
  const raw = localStorage.getItem("share_together_session");
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (session?.token) return session;
  } catch {}
  return null;
}

function setSession(session) {
  state.session = session;
  localStorage.setItem("share_together_session", JSON.stringify(session));
}

function clearSession() {
  state.session = null;
  state.user = null;
  localStorage.removeItem("share_together_session");
  localStorage.removeItem("share_together_admin_key:" + (state.roomSlug || ""));
  state.adminKey = null;
}

async function validateSession() {
  if (!state.session) return false;
  try {
    const data = await api("/api/auth/me");
    state.user = data.user;
    return true;
  } catch {
    clearSession();
    return false;
  }
}

// ==========================================================================
// Init
// ==========================================================================

(async function init() {
  if (state.session) {
    const valid = await validateSession();
    if (valid) {
      showContent();
      return;
    }
  }
  showAuth();
})();

function showAuth() {
  els.auth.classList.remove("hidden");
  els.content.classList.add("hidden");
  els.logoutBtn.classList.add("hidden");
  els.topbarUser.textContent = "";
  els.topbarUser.classList.add("hidden");
  els.home.classList.add("hidden");
  els.room.classList.add("hidden");
  els.app.classList.add("no-topbar-border");
}

async function showContent() {
  els.auth.classList.add("hidden");
  els.content.classList.remove("hidden");
  els.logoutBtn.classList.remove("hidden");
  els.topbarUser.textContent = state.user.username;
  els.topbarUser.classList.remove("hidden");
  els.app.classList.remove("no-topbar-border");

  if (state.roomSlug) {
    await showRoom(state.roomSlug);
  } else {
    showHome();
  }
}

// ==========================================================================
// Home
// ==========================================================================

function showHome() {
  els.home.classList.remove("hidden");
  els.room.classList.add("hidden");
  loadRoomList();
}

async function loadRoomList() {
  try {
    const data = await api("/api/rooms");
    if (!data.rooms?.length) {
      els.roomListHeader.classList.add("hidden");
      els.roomList.classList.add("hidden");
      return;
    }
    els.roomListHeader.classList.remove("hidden");
    els.roomList.classList.remove("hidden");
    els.roomList.replaceChildren(
      ...data.rooms.map((room) => {
        const a = document.createElement("a");
        a.className = "room-list-item";
        a.href = `/room/${room.slug}`;
        const name = document.createElement("span");
        name.className = "room-list-name";
        name.textContent = room.name || room.slug;
        const meta = document.createElement("span");
        meta.className = "room-list-meta";
        meta.textContent = room.role === "owner" ? "Owner · " + relativeTime(room.last_active_at) : relativeTime(room.last_active_at);
        a.append(name, meta);
        return a;
      })
    );
  } catch {
    els.roomListHeader.classList.add("hidden");
    els.roomList.classList.add("hidden");
  }
}

// ==========================================================================
// Room
// ==========================================================================

async function showRoom(slug) {
  state.roomSlug = slug;
  state.adminKey = localStorage.getItem(adminKeyStorageKey(slug));
  els.home.classList.add("hidden");
  els.room.classList.remove("hidden");

  try {
    const room = await api(`/api/rooms/${slug}`);
    state.membership = room.membership;
    setRoomTitle(room.name || room.slug);

    els.joinRoom.classList.add("hidden");
    els.manageRequests.classList.add("hidden");
    els.joinPending.classList.add("hidden");
    els.joinRequestsPanel.classList.add("hidden");
    els.roomContent.classList.add("hidden");

    if (room.membership.is_member) {
      // Full access
      els.roomContent.classList.remove("hidden");

      if (room.membership.is_owner) {
        els.roomTitle.classList.add("editable");
        els.roomTitle.title = "Click to rename";
        els.roomTitle.addEventListener("click", startRenameRoom);
        els.manageRequests.classList.remove("hidden");
        loadPendingRequestCount(slug);
      }

      loadLinks();
      schedulePoll();
    } else if (room.membership.pending_join) {
      els.joinPending.classList.remove("hidden");
    } else {
      els.joinRoom.classList.remove("hidden");
    }

    // Owner can always claim if room has no owner
    if (!room.owner_id && state.adminKey) {
      els.roomContent.classList.remove("hidden");
      if (!room.membership.is_member) {
        state.membership = { is_member: true, is_owner: true };
        await api(`/api/rooms/${slug}/claim`, {
          method: "POST",
          body: { admin_key: state.adminKey }
        });
        setRoomTitle(room.name || room.slug);
        els.roomTitle.classList.add("editable");
        els.roomTitle.title = "Click to rename";
        els.roomTitle.addEventListener("click", startRenameRoom);
        els.manageRequests.classList.remove("hidden");
        loadLinks();
        schedulePoll();
      }
    }
  } catch (error) {
    setNotice(error.message);
    els.roomContent.classList.remove("hidden");
  }
}

els.joinRoom.addEventListener("click", async () => {
  try {
    await api(`/api/rooms/${state.roomSlug}/join`, { method: "POST" });
    els.joinRoom.classList.add("hidden");
    els.joinPending.classList.remove("hidden");
    state.membership = { ...state.membership, pending_join: true };
  } catch (error) {
    setNotice(error.message);
  }
});

els.manageRequests.addEventListener("click", toggleRequestsPanel);

async function toggleRequestsPanel() {
  const panel = els.joinRequestsPanel;
  if (!panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
    return;
  }

  try {
    const data = await api(`/api/rooms/${state.roomSlug}/requests`);
    panel.classList.remove("hidden");
    panel.replaceChildren();

    if (!data.requests?.length) {
      panel.innerHTML = '<p class="requests-empty">No pending requests.</p>';
      return;
    }

    for (const req of data.requests) {
      const row = document.createElement("div");
      row.className = "request-row";

      const name = document.createElement("span");
      name.className = "request-username";
      name.textContent = req.username;

      const actions = document.createElement("div");
      actions.className = "request-actions";

      const approveBtn = document.createElement("button");
      approveBtn.className = "primary small";
      approveBtn.textContent = "Approve";
      approveBtn.addEventListener("click", () => handleRequestAction(req.id, "approve", row));

      const rejectBtn = document.createElement("button");
      rejectBtn.className = "secondary small";
      rejectBtn.textContent = "Reject";
      rejectBtn.addEventListener("click", () => handleRequestAction(req.id, "reject", row));

      actions.append(approveBtn, rejectBtn);
      row.append(name, actions);
      panel.append(row);
    }
  } catch (error) {
    panel.innerHTML = `<p class="requests-error">${error.message}</p>`;
    panel.classList.remove("hidden");
  }
}

async function handleRequestAction(requestId, action, row) {
  try {
    await api(`/api/rooms/${state.roomSlug}/requests/${requestId}/${action}`, { method: "POST" });
    row.remove();
    loadPendingRequestCount(state.roomSlug);
    if (!els.joinRequestsPanel.querySelector(".request-row")) {
      els.joinRequestsPanel.innerHTML = '<p class="requests-empty">No pending requests.</p>';
    }
  } catch (error) {
    setNotice(error.message);
  }
}

async function loadPendingRequestCount(slug) {
  try {
    const data = await api(`/api/rooms/${slug}/requests`);
    const count = data.requests?.length || 0;
    if (count > 0) {
      els.requestCount.textContent = count;
      els.requestCount.classList.remove("hidden");
    } else {
      els.requestCount.classList.add("hidden");
    }
  } catch {
    els.requestCount.classList.add("hidden");
  }
}

// ==========================================================================
// Room actions (same as before, adapted for auth)
// ==========================================================================

els.homeCreateRoom.addEventListener("click", createRoom);

els.copyRoom.addEventListener("click", copyRoomLink);

els.form.addEventListener("submit", submitLink);

for (const tab of els.tabs) {
  tab.addEventListener("click", () => {
    state.sort = tab.dataset.sort;
    updateTabs();
    loadLinks();
  });
}

window.addEventListener("focus", () => {
  if (state.roomSlug && state.membership?.is_member) loadLinks();
});

function isUserTyping() {
  const el = document.activeElement;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function schedulePoll() {
  setTimeout(() => {
    if (!state.roomSlug || !state.membership?.is_member) return;
    if (!isUserTyping()) loadLinks();
    schedulePoll();
  }, 15000);
}

async function createRoom() {
  setNotice("");
  const name = els.roomNameInput?.value.trim() || undefined;
  try {
    const response = await api("/api/rooms", { method: "POST", body: { name } });
    localStorage.setItem(adminKeyStorageKey(response.slug), response.admin_key);
    location.href = `/room/${response.slug}`;
  } catch (error) {
    setNotice(error.message);
  }
}

async function submitLink(event) {
  event.preventDefault();
  const url = els.urlInput.value.trim();
  const tags = parseTagInput(els.tagsInput.value);
  const recommendationNote = normalizeRecommendationNote(els.recommendationInput.value);
  if (!url) return;

  setNotice("Parsing link...");
  try {
    const response = await api(`/api/rooms/${state.roomSlug}/links`, {
      method: "POST",
      body: { url, tags, recommendation_note: recommendationNote }
    });
    els.urlInput.value = "";
    els.tagsInput.value = "";
    els.recommendationInput.value = "";
    state.selectedTag = tags[0] || state.selectedTag;
    setNotice(response.duplicate ? "That URL was already shared in this room." : "Shared.");
    await loadLinks();
  } catch (error) {
    setNotice(error.message);
  }
}

async function loadLinks() {
  try {
    const response = await api(`/api/rooms/${state.roomSlug}/links?sort=${state.sort}`);
    const prev = linksFingerprint(state.links);
    const next = linksFingerprint(response.links);
    state.links = response.links;
    if (prev !== next) renderLinks();
  } catch (error) {
    setNotice(error.message);
  }
}

function linksFingerprint(links) {
  return links.map((l) => `${l.id}:${l.upvote_count}:${l.viewer_has_upvoted ? 1 : 0}:${l.reply_count}`).join(",");
}

async function toggleVote(linkId) {
  const current = state.links.find((l) => l.id === linkId);
  if (!current) return;

  const method = current.viewer_has_upvoted ? "DELETE" : "POST";
  const body = method === "POST" ? {} : undefined;
  const response = await api(`/api/rooms/${state.roomSlug}/links/${linkId}/vote`, { method, body });

  state.links = state.links.map((item) => item.id === linkId ? response.link : item);

  const voteBtn = document.querySelector(`.link-card[data-link-id="${linkId}"] .vote`);
  if (voteBtn) {
    voteBtn.textContent = `${response.link.upvote_count}`;
    voteBtn.classList.toggle("active", response.link.viewer_has_upvoted);
  }
}

async function deleteLink(link) {
  await api(`/api/rooms/${state.roomSlug}/links/${link.id}`, { method: "DELETE" });
  state.links = state.links.filter((item) => item.id !== link.id);
  renderLinks();
}

function renderLinks() {
  const visibleLinks = filteredLinks();
  renderTagFilters();
  els.empty.classList.toggle("hidden", visibleLinks.length > 0);
  els.empty.textContent = state.selectedTag
    ? `No links tagged "${state.selectedTag}" yet.`
    : "No links yet. Share the first article.";

  const expandedIds = new Set(state.expandedReplies);
  els.links.replaceChildren(...visibleLinks.map((link, i) => renderLink(link, i)));

  for (const linkId of expandedIds) {
    restoreReplies(linkId);
  }
}

function restoreReplies(linkId) {
  const section = document.querySelector(`.replies-section[data-link-id="${linkId}"]`);
  if (!section) return;
  state.expandedReplies.add(linkId);
  section.classList.remove("hidden");
  if (state.replies[linkId]) {
    renderReplySection({ id: linkId }, section);
  }
}

function renderLink(link, index) {
  const card = document.createElement("article");
  card.className = `link-card${link.image_url ? "" : " no-image"}`;
  card.dataset.linkId = link.id;
  card.style.setProperty("--index", index);

  const content = document.createElement("div");
  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = `${link.source_host} · ${relativeTime(link.created_at)}`;

  const title = document.createElement("a");
  title.className = "link-title";
  title.href = link.canonical_url;
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.textContent = link.title || link.canonical_url;

  content.append(meta, title);

  if (link.recommendation_note) {
    const recommendation = document.createElement("p");
    recommendation.className = "recommendation";
    recommendation.textContent = link.recommendation_note;
    content.append(recommendation);
  }

  if (link.tags?.length) {
    const tags = document.createElement("div");
    tags.className = "link-tags";
    for (const tagName of link.tags) {
      const tag = document.createElement("button");
      tag.className = "tag";
      tag.type = "button";
      tag.textContent = tagName;
      tag.addEventListener("click", () => {
        state.selectedTag = tagName;
        renderLinks();
      });
      tags.append(tag);
    }
    content.append(tags);
  }

  if (link.description) {
    const description = document.createElement("p");
    description.className = "description";
    description.textContent = link.description;
    content.append(description);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const vote = document.createElement("button");
  vote.className = `vote${link.viewer_has_upvoted ? " active" : ""}`;
  vote.type = "button";
  vote.textContent = `${link.upvote_count}`;
  vote.addEventListener("click", () => toggleVote(link.id));
  actions.append(vote);

  const replyBtn = document.createElement("button");
  replyBtn.className = "reply-toggle";
  replyBtn.type = "button";
  replyBtn.textContent = replyLabel(link.reply_count || 0);
  replyBtn.addEventListener("click", () => toggleReplies(link, card));
  actions.append(replyBtn);

  if (state.membership?.is_owner) {
    const remove = document.createElement("button");
    remove.className = "delete";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteLink(link));
    actions.append(remove);
  }

  content.append(actions);
  card.append(content);

  const replySection = document.createElement("div");
  replySection.className = "replies-section hidden";
  replySection.dataset.linkId = link.id;
  card.append(replySection);

  if (link.image_url) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = link.image_url;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      img.remove();
      card.classList.add("no-image");
    });
    card.append(img);
  }

  return card;
}

function renderTagFilters() {
  const tags = allTags();
  if (!tags.length) {
    state.selectedTag = null;
    els.tagFilters.classList.add("hidden");
    els.tagFilters.replaceChildren();
    return;
  }

  if (state.selectedTag && !tags.some((tag) => sameTag(tag, state.selectedTag))) {
    state.selectedTag = null;
  }

  const all = document.createElement("button");
  all.className = `tag-filter${state.selectedTag ? "" : " active"}`;
  all.dataset.filter = "all";
  all.type = "button";
  all.textContent = "All tags";
  all.addEventListener("click", () => {
    state.selectedTag = null;
    renderLinks();
  });

  const buttons = tags.map((tagName) => {
    const button = document.createElement("button");
    button.className = `tag-filter${sameTag(tagName, state.selectedTag) ? " active" : ""}`;
    button.type = "button";
    button.textContent = tagName;
    button.addEventListener("click", () => {
      state.selectedTag = tagName;
      renderLinks();
    });
    return button;
  });

  els.tagFilters.classList.remove("hidden");
  els.tagFilters.replaceChildren(all, ...buttons);
}

function filteredLinks() {
  if (!state.selectedTag) return state.links;
  return state.links.filter((link) => link.tags?.some((tag) => sameTag(tag, state.selectedTag)));
}

function allTags() {
  const tags = new Map();
  for (const link of state.links) {
    for (const tag of link.tags || []) {
      const key = tag.toLowerCase();
      if (!tags.has(key)) tags.set(key, tag);
    }
  }
  return [...tags.values()].sort((a, b) => a.localeCompare(b));
}

function parseTagInput(value) {
  const tags = [];
  const seen = new Set();
  for (const rawTag of value.split(",")) {
    const tag = rawTag.trim().replace(/^#+/, "").replace(/\s+/g, " ").slice(0, 32);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 8) break;
  }
  return tags;
}

function normalizeRecommendationNote(value) {
  const note = value.trim().replace(/\s+/g, " ").slice(0, 280);
  return note || null;
}

function sameTag(left, right) {
  return left?.toLowerCase() === right?.toLowerCase();
}

// ==========================================================================
// API (with auth)
// ==========================================================================

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.session?.token) {
    headers["authorization"] = `Bearer ${state.session.token}`;
  }
  let body;
  if (options.body) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { ...options, headers, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Session expired: clear and redirect to login
    if (response.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/register") {
      clearSession();
      showAuth();
    }
    throw new Error(data.error || "Request failed");
  }
  return data;
}

// ==========================================================================
// UI helpers
// ==========================================================================

function setRoomTitle(name) {
  els.roomTitle.textContent = name;
  els.roomTitle.dataset.name = name;
}

function startRenameRoom() {
  if (!state.membership?.is_owner) return;
  const current = els.roomTitle.dataset.name || els.roomTitle.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.value = current;
  input.maxLength = 64;
  input.className = "room-title-input";

  els.roomTitle.replaceChildren(input);
  els.roomTitle.classList.remove("editable");
  input.focus();
  input.select();

  async function commit() {
    const name = input.value.trim();
    input.replaceWith(document.createTextNode(name || current));
    els.roomTitle.classList.add("editable");
    if (!name || name === current) return;
    try {
      const room = await api(`/api/rooms/${state.roomSlug}`, {
        method: "PATCH",
        body: { name }
      });
      setRoomTitle(room.name || room.slug);
    } catch (error) {
      setNotice(error.message);
      setRoomTitle(current);
    }
  }

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      input.blur();
    } else if (event.key === "Escape") {
      input.value = current;
      input.blur();
    }
  });
}

function updateTabs() {
  for (const tab of els.tabs) {
    tab.classList.toggle("active", tab.dataset.sort === state.sort);
  }
}

function copyRoomLink() {
  navigator.clipboard.writeText(location.href);
  setNotice("Room link copied.");
}

function setNotice(message) {
  els.notice.textContent = message;
}

function roomSlugFromPath() {
  const match = location.pathname.match(/^\/room\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getOrCreate(key, create) {
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = create();
  localStorage.setItem(key, value);
  return value;
}

function adminKeyStorageKey(slug) {
  return `share_together_admin_key:${slug}`;
}

// ==========================================================================
// Replies (unchanged except auth in api)
// ==========================================================================

async function toggleReplies(link, card) {
  const section = card.querySelector(".replies-section");
  const toggleBtn = card.querySelector(".reply-toggle");

  if (state.expandedReplies.has(link.id)) {
    state.expandedReplies.delete(link.id);
    section.classList.add("hidden");
    return;
  }

  state.expandedReplies.add(link.id);
  section.classList.remove("hidden");

  if (!state.replies[link.id]) {
    section.replaceChildren(renderLoading());
    try {
      const data = await api(`/api/rooms/${state.roomSlug}/links/${link.id}/replies`);
      state.replies[link.id] = data.replies;
      link.reply_count = data.replies.length;
      toggleBtn.textContent = replyLabel(link.reply_count);
    } catch (error) {
      section.replaceChildren(renderReplyError(error.message));
      return;
    }
  }

  renderReplySection(link, section);
}

function renderLoading() {
  const el = document.createElement("p");
  el.className = "reply-loading";
  el.textContent = "Loading replies…";
  return el;
}

function renderReplyError(message) {
  const el = document.createElement("p");
  el.className = "reply-error";
  el.textContent = message;
  return el;
}

function renderReplySection(link, container) {
  container.replaceChildren();

  const replies = state.replies[link.id] || [];
  const tree = buildReplyTree(replies);

  if (tree.length === 0) {
    const empty = document.createElement("p");
    empty.className = "reply-empty";
    empty.textContent = "No replies yet. Start the discussion.";
    container.append(empty);
  } else {
    const list = document.createElement("div");
    list.className = "reply-thread";
    renderReplyTree(tree, list, 0);
    container.append(list);
  }

  renderReplyForm(link, null, container);
}

function buildReplyTree(replies) {
  const map = new Map();
  const roots = [];

  for (const reply of replies) {
    map.set(reply.id, { ...reply, children: [] });
  }

  for (const reply of map.values()) {
    if (reply.parent_id && map.has(reply.parent_id)) {
      map.get(reply.parent_id).children.push(reply);
    } else {
      roots.push(reply);
    }
  }

  return roots;
}

function renderReplyTree(replies, container, depth) {
  for (const reply of replies) {
    renderSingleReply(reply, container, depth);
  }
}

function renderSingleReply(reply, container, depth) {
  const wrapper = document.createElement("div");
  wrapper.className = "reply";
  wrapper.style.setProperty("--depth", Math.min(depth, 3));

  const body = document.createElement("div");
  body.className = "reply-body";

  const meta = document.createElement("div");
  meta.className = "reply-meta";

  const author = document.createElement("span");
  author.className = "reply-author";
  author.textContent = reply.author_name;

  const time = document.createElement("span");
  time.className = "reply-time";
  time.textContent = relativeTime(reply.created_at);

  meta.append(author, time);
  body.append(meta);

  const text = document.createElement("p");
  text.className = "reply-text";
  text.textContent = reply.body;
  body.append(text);

  const replyBtn = document.createElement("button");
  replyBtn.className = "reply-inline-btn";
  replyBtn.type = "button";
  replyBtn.textContent = "Reply";
  replyBtn.addEventListener("click", () => {
    const existingForm = wrapper.querySelector(".reply-form");
    if (existingForm) {
      existingForm.remove();
      return;
    }
    renderReplyFormInline(reply, wrapper);
  });
  body.append(replyBtn);

  if (state.membership?.is_owner) {
    const delBtn = document.createElement("button");
    delBtn.className = "reply-delete-btn";
    delBtn.type = "button";
    delBtn.textContent = "×";
    delBtn.title = "Delete reply";
    delBtn.addEventListener("click", () => deleteReply(reply, wrapper));
    body.append(delBtn);
  }

  wrapper.append(body);

  if (reply.children && reply.children.length > 0) {
    const nested = document.createElement("div");
    nested.className = "reply-children";
    for (const child of reply.children) {
      renderSingleReply(child, nested, depth + 1);
    }
    wrapper.append(nested);
  }

  container.append(wrapper);
}

function renderReplyForm(link, parentId, container) {
  const form = document.createElement("form");
  form.className = "reply-form";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.name = "author_name";
  nameInput.placeholder = "Your name (optional)";
  nameInput.maxLength = 32;

  const bodyInput = document.createElement("input");
  bodyInput.type = "text";
  bodyInput.name = "body";
  bodyInput.placeholder = parentId ? "Write a reply…" : "Write the first reply…";
  bodyInput.required = true;
  bodyInput.maxLength = 1000;

  const submitBtn = document.createElement("button");
  submitBtn.className = "primary";
  submitBtn.type = "submit";
  submitBtn.textContent = "Reply";

  form.append(nameInput, bodyInput, submitBtn);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitReply(link, parentId, nameInput.value.trim(), bodyInput.value.trim(), form, container);
  });

  container.append(form);
}

function renderReplyFormInline(parentReply, wrapper) {
  const form = document.createElement("form");
  form.className = "reply-form reply-form-inline";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.name = "author_name";
  nameInput.placeholder = "Your name (optional)";
  nameInput.maxLength = 32;

  const bodyInput = document.createElement("input");
  bodyInput.type = "text";
  bodyInput.name = "body";
  bodyInput.placeholder = `Reply to ${parentReply.author_name}…`;
  bodyInput.required = true;
  bodyInput.maxLength = 1000;

  const actions = document.createElement("div");
  actions.className = "reply-form-actions";

  const submitBtn = document.createElement("button");
  submitBtn.className = "primary";
  submitBtn.type = "submit";
  submitBtn.textContent = "Post";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "secondary";
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => form.remove());

  actions.append(submitBtn, cancelBtn);
  form.append(nameInput, bodyInput, actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const parentLink = state.links.find((l) => l.id === parentReply.link_id);
    if (!parentLink) return;
    submitReply(parentLink, parentReply.id, nameInput.value.trim(), bodyInput.value.trim(), form, wrapper);
  });

  wrapper.append(form);
  bodyInput.focus();
}

async function submitReply(link, parentId, authorName, body, form, container) {
  if (!body) return;

  try {
    const payload = { body };
    if (parentId) payload.parent_id = parentId;
    if (authorName) payload.author_name = authorName;

    await api(`/api/rooms/${state.roomSlug}/links/${link.id}/replies`, {
      method: "POST",
      body: payload
    });

    form.remove();
    delete state.replies[link.id];
    await loadRepliesForLink(link);

    const section = container.closest(".replies-section");
    if (section) renderReplySection(link, section);
    updateReplyToggle(link);
  } catch (error) {
    setNotice(error.message);
  }
}

function updateReplyToggle(link) {
  const toggleBtn = document
    .querySelector(`.replies-section[data-link-id="${link.id}"]`)
    ?.closest(".link-card")
    ?.querySelector(".reply-toggle");
  if (toggleBtn) {
    toggleBtn.textContent = replyLabel(link.reply_count || 0);
  }
}

async function loadRepliesForLink(link) {
  try {
    const data = await api(`/api/rooms/${state.roomSlug}/links/${link.id}/replies`);
    state.replies[link.id] = data.replies;
    link.reply_count = data.replies.length;
  } catch {
    // keep existing replies if fetch fails
  }
}

async function deleteReply(reply, wrapper) {
  try {
    await api(`/api/rooms/${state.roomSlug}/links/${reply.link_id}/replies/${reply.id}`, {
      method: "DELETE"
    });

    delete state.replies[reply.link_id];
    wrapper.remove();

    const link = state.links.find((l) => l.id === reply.link_id);
    if (link) {
      await loadRepliesForLink(link);
      const section = document.querySelector(`.replies-section[data-link-id="${link.id}"]`);
      if (section && state.expandedReplies.has(link.id)) {
        renderReplySection(link, section);
      }
      updateReplyToggle(link);
    }
  } catch (error) {
    setNotice(error.message);
  }
}

function replyLabel(count) {
  return `↩ ${count} comment${count === 1 ? "" : "s"}`;
}

function relativeTime(value) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
