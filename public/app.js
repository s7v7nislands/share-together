// ── State ──────────────────────────────────────────────────────────────────
const state = {
  roomSlug: roomSlugFromPath(),
  sort: "newest",
  selectedTag: null,
  links: [],
  clientId: getOrCreate("share_together_client_id", () => crypto.randomUUID()),
  adminKey: null,
  // edit modal
  editingLink: null,
  // expanded comment sections
  expandedComments: new Set(),
  // comment data cache: linkId -> [{comment}]
  commentCache: {}
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const els = {
  home: document.querySelector("#home"),
  room: document.querySelector("#room"),
  createRoom: document.querySelector("#create-room"),
  homeCreateRoom: document.querySelector("#home-create-room"),
  copyRoom: document.querySelector("#copy-room"),
  roomTitle: document.querySelector("#room-title"),
  form: document.querySelector("#submit-link"),
  urlInput: document.querySelector("#url-input"),
  tagsInput: document.querySelector("#tags-input"),
  recommendationInput: document.querySelector("#recommendation-input"),
  notice: document.querySelector("#notice"),
  tabs: document.querySelectorAll(".tab"),
  tagFilters: document.querySelector("#tag-filters"),
  links: document.querySelector("#links"),
  empty: document.querySelector("#empty"),
  // edit modal
  editModal: document.querySelector("#edit-modal"),
  editTagsInput: document.querySelector("#edit-tags-input"),
  editNoteInput: document.querySelector("#edit-note-input"),
  editSave: document.querySelector("#edit-save"),
  editCancel: document.querySelector("#edit-cancel")
};

// ── Bootstrap ──────────────────────────────────────────────────────────────
els.createRoom.addEventListener("click", createRoom);
els.homeCreateRoom.addEventListener("click", createRoom);
els.copyRoom.addEventListener("click", copyRoomLink);
els.form.addEventListener("submit", submitLink);
els.editSave.addEventListener("click", saveEdit);
els.editCancel.addEventListener("click", closeEditModal);
els.editModal.addEventListener("click", (e) => { if (e.target === els.editModal) closeEditModal(); });

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

// ── Room actions ───────────────────────────────────────────────────────────
async function createRoom() {
  setNotice("");
  const response = await api("/api/rooms", { method: "POST" });
  localStorage.setItem(adminKeyStorageKey(response.slug), response.admin_key);
  location.href = `/room/${response.slug}`;
}

async function submitLink(event) {
  event.preventDefault();
  const url = els.urlInput.value.trim();
  const tags = parseTagInput(els.tagsInput.value);
  const recommendationNote = normalizeRecommendationNote(els.recommendationInput.value);
  if (!url) return;

  setNotice("正在解析链接…");
  try {
    const response = await api(`/api/rooms/${state.roomSlug}/links`, {
      method: "POST",
      body: { url, tags, recommendation_note: recommendationNote, client_id: state.clientId }
    });
    els.urlInput.value = "";
    els.tagsInput.value = "";
    els.recommendationInput.value = "";
    state.selectedTag = tags[0] || state.selectedTag;
    setNotice(response.duplicate ? "该链接已在房间中分享过了。" : "分享成功！");
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

// ── Edit modal ─────────────────────────────────────────────────────────────
function openEditModal(link) {
  state.editingLink = link;
  els.editTagsInput.value = link.tags?.join(", ") || "";
  els.editNoteInput.value = link.recommendation_note || "";
  els.editModal.classList.remove("hidden");
  els.editTagsInput.focus();
}

function closeEditModal() {
  state.editingLink = null;
  els.editModal.classList.add("hidden");
}

async function saveEdit() {
  if (!state.editingLink) return;
  const link = state.editingLink;
  const tags = parseTagInput(els.editTagsInput.value);
  const recommendationNote = normalizeRecommendationNote(els.editNoteInput.value);
  try {
    const response = await api(`/api/rooms/${state.roomSlug}/links/${link.id}`, {
      method: "PATCH",
      body: { tags, recommendation_note: recommendationNote, client_id: state.clientId }
    });
    state.links = state.links.map((item) => item.id === link.id ? response.link : item);
    closeEditModal();
    renderLinks();
  } catch (error) {
    setNotice(error.message);
    closeEditModal();
  }
}

// ── Comments ───────────────────────────────────────────────────────────────
async function toggleComments(linkId) {
  const wasExpanded = state.expandedComments.has(linkId);
  if (wasExpanded) {
    state.expandedComments.delete(linkId);
    renderLinks();
    return;
  }
  state.expandedComments.add(linkId);
  await loadComments(linkId);
}

async function loadComments(linkId) {
  try {
    const response = await api(`/api/rooms/${state.roomSlug}/links/${linkId}/comments`);
    state.commentCache[linkId] = response.comments;
    renderLinks();
  } catch (error) {
    setNotice(error.message);
  }
}

async function submitComment(linkId, content, parentId, attachments) {
  if (!content.trim() && attachments.length === 0) return;
  try {
    const response = await api(`/api/rooms/${state.roomSlug}/links/${linkId}/comments`, {
      method: "POST",
      body: {
        content,
        parent_id: parentId || null,
        attachments,
        client_id: state.clientId
      }
    });
    // Refresh comment list
    await loadComments(linkId);
    // Update comment count in link
    const link = state.links.find((l) => l.id === linkId);
    if (link) {
      link.comment_count = (link.comment_count || 0) + 1;
    }
    return response.comment;
  } catch (error) {
    setNotice(error.message);
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderLinks() {
  const visibleLinks = filteredLinks();
  renderTagFilters();
  els.empty.classList.toggle("hidden", visibleLinks.length > 0);
  els.empty.textContent = state.selectedTag
    ? `没有带有"${state.selectedTag}"标签的链接。`
    : "还没有链接，来分享第一篇吧。";
  els.links.replaceChildren(...visibleLinks.map(renderLink));
}

function renderLink(link) {
  const card = document.createElement("article");
  card.className = `link-card${link.image_url ? "" : " no-image"}`;
  card.dataset.linkId = link.id;

  const content = document.createElement("div");
  content.className = "link-content";

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

  // Actions row
  const actions = document.createElement("div");
  actions.className = "actions";

  const vote = document.createElement("button");
  vote.className = `vote${link.viewer_has_upvoted ? " active" : ""}`;
  vote.type = "button";
  vote.textContent = `▲ ${link.upvote_count}`;
  vote.addEventListener("click", () => toggleVote(link));
  actions.append(vote);

  // Comment toggle button
  const commentToggle = document.createElement("button");
  commentToggle.className = `comment-toggle${state.expandedComments.has(link.id) ? " active" : ""}`;
  commentToggle.type = "button";
  const commentCount = link.comment_count || 0;
  commentToggle.textContent = commentCount > 0 ? `💬 ${commentCount}` : "💬 评论";
  commentToggle.addEventListener("click", () => toggleComments(link.id));
  actions.append(commentToggle);

  // Edit button (all users can edit tags/notes)
  const editBtn = document.createElement("button");
  editBtn.className = "edit-btn";
  editBtn.type = "button";
  editBtn.textContent = "✏️ 编辑";
  editBtn.addEventListener("click", () => openEditModal(link));
  actions.append(editBtn);

  if (state.adminKey) {
    const remove = document.createElement("button");
    remove.className = "delete";
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", () => deleteLink(link));
    actions.append(remove);
  }

  content.append(actions);

  // Comment section (expanded)
  if (state.expandedComments.has(link.id)) {
    const commentSection = renderCommentSection(link.id);
    content.append(commentSection);
  }

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

function renderCommentSection(linkId) {
  const section = document.createElement("div");
  section.className = "comment-section";

  const comments = state.commentCache[linkId] || [];

  // Comment list
  if (comments.length > 0) {
    const list = document.createElement("div");
    list.className = "comment-list";
    for (const comment of comments) {
      list.append(renderComment(comment, linkId, 0));
    }
    section.append(list);
  }

  // New top-level comment form
  section.append(renderCommentForm(linkId, null, "写评论…"));

  return section;
}

function renderComment(comment, linkId, depth) {
  const wrapper = document.createElement("div");
  wrapper.className = `comment-wrapper depth-${Math.min(depth, 3)}`;

  const body = document.createElement("div");
  body.className = "comment-body";

  const meta = document.createElement("span");
  meta.className = "comment-meta";
  meta.textContent = `匿名用户 · ${relativeTime(comment.created_at)}`;
  body.append(meta);

  const contentEl = document.createElement("div");
  contentEl.className = "comment-content";
  contentEl.textContent = comment.content;
  body.append(contentEl);

  // Render attachments
  if (comment.attachments?.length) {
    const attachArea = document.createElement("div");
    attachArea.className = "comment-attachments";
    for (const att of comment.attachments) {
      if (att.type === "image") {
        const img = document.createElement("img");
        img.className = "comment-image";
        img.src = att.content;
        img.alt = att.name || "图片";
        img.loading = "lazy";
        attachArea.append(img);
      } else if (att.type === "markdown") {
        const mdBlock = document.createElement("details");
        mdBlock.className = "comment-md-block";
        const summary = document.createElement("summary");
        summary.textContent = `📄 ${att.name || "Markdown 文件"}`;
        const pre = document.createElement("pre");
        pre.className = "comment-md-content";
        pre.textContent = att.content;
        mdBlock.append(summary, pre);
        attachArea.append(mdBlock);
      }
    }
    body.append(attachArea);
  }

  const replyBtn = document.createElement("button");
  replyBtn.className = "reply-btn";
  replyBtn.type = "button";
  replyBtn.textContent = "回复";
  replyBtn.addEventListener("click", () => {
    const existing = wrapper.querySelector(".reply-form-container");
    if (existing) { existing.remove(); return; }
    const formContainer = document.createElement("div");
    formContainer.className = "reply-form-container";
    formContainer.append(renderCommentForm(linkId, comment.id, "回复这条评论…"));
    wrapper.append(formContainer);
  });
  body.append(replyBtn);

  wrapper.append(body);

  // Nested replies
  if (comment.replies?.length) {
    const repliesEl = document.createElement("div");
    repliesEl.className = "comment-replies";
    for (const reply of comment.replies) {
      repliesEl.append(renderComment(reply, linkId, depth + 1));
    }
    wrapper.append(repliesEl);
  }

  return wrapper;
}

function renderCommentForm(linkId, parentId, placeholder) {
  const form = document.createElement("div");
  form.className = "comment-form";

  const textarea = document.createElement("textarea");
  textarea.className = "comment-textarea";
  textarea.placeholder = placeholder;
  textarea.rows = 2;
  form.append(textarea);

  // Attachment toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "comment-toolbar";

  const imageBtn = document.createElement("button");
  imageBtn.type = "button";
  imageBtn.className = "attach-btn";
  imageBtn.textContent = "🖼 图片";
  imageBtn.title = "粘贴或上传图片（≤300KB）";

  const imageInput = document.createElement("input");
  imageInput.type = "file";
  imageInput.accept = "image/*";
  imageInput.style.display = "none";
  imageInput.multiple = false;

  const mdBtn = document.createElement("button");
  mdBtn.type = "button";
  mdBtn.className = "attach-btn";
  mdBtn.textContent = "📄 MD文件";
  mdBtn.title = "上传 Markdown 文件（≤50KB）";

  const mdInput = document.createElement("input");
  mdInput.type = "file";
  mdInput.accept = ".md,.markdown,text/markdown";
  mdInput.style.display = "none";
  mdInput.multiple = false;

  // Pending attachments for this form
  const pendingAttachments = [];

  const attachPreview = document.createElement("div");
  attachPreview.className = "attach-preview";

  function refreshAttachPreview() {
    attachPreview.replaceChildren();
    for (let i = 0; i < pendingAttachments.length; i++) {
      const att = pendingAttachments[i];
      const chip = document.createElement("span");
      chip.className = "attach-chip";
      chip.textContent = att.type === "image" ? `🖼 ${att.name}` : `📄 ${att.name}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "attach-chip-remove";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        pendingAttachments.splice(i, 1);
        refreshAttachPreview();
      });
      chip.append(remove);
      attachPreview.append(chip);
    }
  }

  imageBtn.addEventListener("click", () => imageInput.click());
  imageInput.addEventListener("change", async () => {
    const file = imageInput.files[0];
    if (!file) return;
    if (file.size > 300 * 1024) { setNotice("图片不能超过 300KB"); return; }
    const content = await fileToBase64(file);
    if (pendingAttachments.length >= 4) { setNotice("最多附加 4 个附件"); return; }
    pendingAttachments.push({ type: "image", name: file.name, content });
    refreshAttachPreview();
    imageInput.value = "";
  });

  mdBtn.addEventListener("click", () => mdInput.click());
  mdInput.addEventListener("change", async () => {
    const file = mdInput.files[0];
    if (!file) return;
    if (file.size > 50 * 1024) { setNotice("Markdown 文件不能超过 50KB"); return; }
    const content = await file.text();
    if (pendingAttachments.length >= 4) { setNotice("最多附加 4 个附件"); return; }
    pendingAttachments.push({ type: "markdown", name: file.name, content });
    refreshAttachPreview();
    mdInput.value = "";
  });

  // Paste image support
  textarea.addEventListener("paste", async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > 300 * 1024) { setNotice("粘贴的图片不能超过 300KB"); continue; }
        if (pendingAttachments.length >= 4) { setNotice("最多附加 4 个附件"); continue; }
        const content = await fileToBase64(file);
        pendingAttachments.push({ type: "image", name: `paste-${Date.now()}.png`, content });
        refreshAttachPreview();
      }
    }
  });

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "primary comment-submit";
  submitBtn.textContent = "发送";
  submitBtn.addEventListener("click", async () => {
    const content = textarea.value.trim();
    if (!content && pendingAttachments.length === 0) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "发送中…";
    await submitComment(linkId, content, parentId, [...pendingAttachments]);
    textarea.value = "";
    pendingAttachments.length = 0;
    refreshAttachPreview();
    submitBtn.disabled = false;
    submitBtn.textContent = "发送";
    // If this was a reply form, close it
    const container = form.closest(".reply-form-container");
    if (container) container.remove();
  });

  toolbar.append(imageBtn, imageInput, mdBtn, mdInput, submitBtn);
  form.append(toolbar, attachPreview);

  return form;
}

// ── Tag filters & utils ────────────────────────────────────────────────────
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
  all.textContent = "全部";
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

// ── API & misc ─────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body;
  if (options.body) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { ...options, headers, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
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
  setNotice("房间链接已复制到剪贴板。");
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
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
