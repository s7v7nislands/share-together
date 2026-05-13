const state = {
  roomSlug: roomSlugFromPath(),
  sort: "newest",
  links: [],
  clientId: getOrCreate("share_together_client_id", () => crypto.randomUUID()),
  adminKey: null
};

const els = {
  home: document.querySelector("#home"),
  room: document.querySelector("#room"),
  createRoom: document.querySelector("#create-room"),
  homeCreateRoom: document.querySelector("#home-create-room"),
  copyRoom: document.querySelector("#copy-room"),
  roomTitle: document.querySelector("#room-title"),
  form: document.querySelector("#submit-link"),
  urlInput: document.querySelector("#url-input"),
  notice: document.querySelector("#notice"),
  tabs: document.querySelectorAll(".tab"),
  links: document.querySelector("#links"),
  empty: document.querySelector("#empty")
};

els.createRoom.addEventListener("click", createRoom);
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
  if (state.roomSlug) loadLinks();
});

if (state.roomSlug) {
  showRoom(state.roomSlug);
  loadLinks();
  setInterval(loadLinks, 15000);
} else {
  showHome();
}

async function createRoom() {
  setNotice("");
  const response = await api("/api/rooms", { method: "POST" });
  localStorage.setItem(adminKeyStorageKey(response.slug), response.admin_key);
  location.href = `/room/${response.slug}`;
}

async function submitLink(event) {
  event.preventDefault();
  const url = els.urlInput.value.trim();
  if (!url) return;

  setNotice("Parsing link...");
  try {
    const response = await api(`/api/rooms/${state.roomSlug}/links`, {
      method: "POST",
      body: { url, client_id: state.clientId }
    });
    els.urlInput.value = "";
    setNotice(response.duplicate ? "That URL was already shared in this room." : "Shared.");
    await loadLinks();
  } catch (error) {
    setNotice(error.message);
  }
}

async function loadLinks() {
  try {
    const response = await api(`/api/rooms/${state.roomSlug}/links?sort=${state.sort}&client_id=${encodeURIComponent(state.clientId)}`);
    state.links = response.links;
    renderLinks();
  } catch (error) {
    setNotice(error.message);
  }
}

async function toggleVote(link) {
  const method = link.viewer_has_upvoted ? "DELETE" : "POST";
  const query = method === "DELETE" ? `?client_id=${encodeURIComponent(state.clientId)}` : "";
  const body = method === "POST" ? { client_id: state.clientId } : undefined;
  const response = await api(`/api/rooms/${state.roomSlug}/links/${link.id}/vote${query}`, { method, body });
  state.links = state.links.map((item) => item.id === link.id ? response.link : item);
  renderLinks();
}

async function deleteLink(link) {
  if (!state.adminKey) return;
  await api(`/api/rooms/${state.roomSlug}/links/${link.id}`, {
    method: "DELETE",
    headers: { "x-admin-key": state.adminKey }
  });
  state.links = state.links.filter((item) => item.id !== link.id);
  renderLinks();
}

function renderLinks() {
  els.empty.classList.toggle("hidden", state.links.length > 0);
  els.links.replaceChildren(...state.links.map(renderLink));
}

function renderLink(link) {
  const card = document.createElement("article");
  card.className = `link-card${link.image_url ? "" : " no-image"}`;

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
  vote.textContent = `▲ ${link.upvote_count}`;
  vote.addEventListener("click", () => toggleVote(link));
  actions.append(vote);

  if (state.adminKey) {
    const remove = document.createElement("button");
    remove.className = "delete";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteLink(link));
    actions.append(remove);
  }

  content.append(actions);
  card.append(content);

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

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body;
  if (options.body) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { ...options, headers, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showHome() {
  els.home.classList.remove("hidden");
  els.room.classList.add("hidden");
}

function showRoom(slug) {
  state.adminKey = localStorage.getItem(adminKeyStorageKey(slug));
  els.home.classList.add("hidden");
  els.room.classList.remove("hidden");
  els.roomTitle.textContent = slug;
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
