import { fetchMetadata } from "./metadata.js";
import { assertPublicHttpUrl, getSourceHost, normalizeUrl } from "./url-utils.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }

      const wantsHtml = request.headers.get("accept")?.includes("text/html");
      const isSpaRoute = wantsHtml && !url.pathname.split("/").pop().includes(".");
      if (isSpaRoute && url.pathname !== "/") {
        return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
      }

      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404 || !wantsHtml) {
        return assetResponse;
      }

      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    } catch (error) {
      console.error(error);
      return json({ error: error.message || "Unexpected error" }, error.status || 500);
    }
  }
};

async function handleApi(request, env, url) {
  // --- Auth routes: no authentication required ---

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    return handleRegister(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    return handleLogin(request, env);
  }

  // --- All remaining routes require authentication ---
  const user = await authenticate(env, request);
  if (!user) return json({ error: "Authentication required" }, 401);

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    return handleLogout(request, env, user);
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    return json({ user });
  }

  // --- Rooms ---

  if (request.method === "GET" && url.pathname === "/api/rooms") {
    const rows = await env.DB.prepare(
      `SELECT r.slug, r.name, r.created_at, r.last_active_at, rm.role
       FROM rooms r
       JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ?
       ORDER BY r.last_active_at DESC LIMIT 50`
    ).bind(user.id).all();
    return json({ rooms: rows.results });
  }

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    await rateLimit(env, `user:${user.id}:create-room`, 10, 3600);
    const body = await readJson(request).catch(() => ({}));
    const name = normalizeRoomName(body.name);
    const now = new Date().toISOString();
    const room = {
      id: crypto.randomUUID(),
      slug: `room-${randomToken(8)}`,
      adminKey: randomToken(32),
      name
    };
    const adminHash = await sha256(room.adminKey);

    await env.DB.prepare(
      "INSERT INTO rooms (id, slug, admin_key_hash, name, owner_id, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(room.id, room.slug, adminHash, room.name, user.id, now, now).run();

    await env.DB.prepare(
      "INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)"
    ).bind(room.id, user.id, now).run();

    return json({ slug: room.slug, name: room.name, admin_key: room.adminKey });
  }

  // --- Room sub-routes ---

  const roomRoute = url.pathname.match(/^\/api\/rooms\/([^/]+)(\/.*)?$/);
  if (roomRoute) {
    const slug = roomRoute[1];
    const sub = roomRoute[2] || "";
    const room = await findRoom(env, slug);
    if (!room) return json({ error: "Room not found" }, 404);

    // Room-level routes
    if (sub === "") {
      if (request.method === "GET") return handleGetRoom(env, room, user);
      if (request.method === "PATCH") return handleRenameRoom(request, env, room, user);
      return json({ error: "Not found" }, 404);
    }

    if (sub === "/claim" && request.method === "POST") {
      return handleClaimRoom(request, env, room, user);
    }

    if (sub === "/join" && request.method === "POST") {
      return handleJoinRequest(request, env, room, user);
    }

    if (sub === "/requests" && request.method === "GET") {
      return handleListJoinRequests(env, room, user);
    }

    const requestAction = sub.match(/^\/requests\/([^/]+)\/(approve|reject)$/);
    if (requestAction && request.method === "POST") {
      return handleJoinRequestAction(env, room, requestAction[1], requestAction[2], user);
    }

    // Link routes (require membership)
    if (sub === "/links") {
      const membership = await requireMembership(env, room.id, user.id);
      if (!membership) return json({ error: "You must be a member of this room" }, 403);

      if (request.method === "GET") return handleListLinks(request, env, room, user);
      if (request.method === "POST") return handleSubmitLink(request, env, room, user);
      return json({ error: "Not found" }, 404);
    }

    const linkDelete = sub.match(/^\/links\/([^/]+)$/);
    if (linkDelete && request.method === "DELETE") {
      return handleDeleteLink(request, env, room, linkDelete[1], user);
    }

    const voteMatch = sub.match(/^\/links\/([^/]+)\/vote$/);
    if (voteMatch && (request.method === "POST" || request.method === "DELETE")) {
      const membership = await requireMembership(env, room.id, user.id);
      if (!membership) return json({ error: "You must be a member of this room" }, 403);
      return handleVote(request, env, room, voteMatch[1], user);
    }

    const repliesMatch = sub.match(/^\/links\/([^/]+)\/replies$/);
    if (repliesMatch) {
      const membership = await requireMembership(env, room.id, user.id);
      if (!membership) return json({ error: "You must be a member of this room" }, 403);

      if (request.method === "GET") return handleListReplies(env, room, repliesMatch[1]);
      if (request.method === "POST") return handleCreateReply(request, env, room, repliesMatch[1], user);
      return json({ error: "Not found" }, 404);
    }

    const replyDelete = sub.match(/^\/links\/([^/]+)\/replies\/([^/]+)$/);
    if (replyDelete && request.method === "DELETE") {
      return handleDeleteReply(request, env, room, replyDelete[1], replyDelete[2], user);
    }

    return json({ error: "Not found" }, 404);
  }

  return json({ error: "Not found" }, 404);
}

// ============================================================================
// Auth handlers
// ============================================================================

async function handleRegister(request, env) {
  const ip = clientIp(request);
  await rateLimit(env, `register:ip:${ip}`, 5, 300);

  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  if (!username) {
    return json({ error: "Username must be 1-32 chars: letters, numbers, underscores, hyphens" }, 400);
  }

  if (!validatePassword(body.password)) {
    return json({ error: "Password must be at least 8 characters with at least one letter and one number" }, 400);
  }

  if (body.password !== body.confirm_password) {
    return json({ error: "Passwords do not match" }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) return json({ error: "Username already taken" }, 409);

  const passwordHash = await hashPassword(body.password);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)"
  ).bind(userId, username, passwordHash, now).run();

  const session = await createSession(env, userId);
  return json({ user: { id: userId, username }, session }, 201);
}

async function handleLogin(request, env) {
  const ip = clientIp(request);
  await rateLimit(env, `login:ip:${ip}`, 10, 300);

  const body = await readJson(request);
  const username = (body.username || "").trim();
  if (!username) return json({ error: "Username is required" }, 400);

  const user = await env.DB.prepare(
    "SELECT id, username, password_hash FROM users WHERE username = ?"
  ).bind(username).first();

  if (!user || !(await verifyPassword(body.password || "", user.password_hash))) {
    return json({ error: "Invalid username or password" }, 401);
  }

  const session = await createSession(env, user.id);
  return json({ user: { id: user.id, username: user.username }, session });
}

async function handleLogout(request, env, user) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) {
    const tokenHash = await sha256(match[1]);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  return json({ ok: true });
}

// ============================================================================
// Room handlers
// ============================================================================

async function handleGetRoom(env, room, user) {
  const membership = await getMembership(env, room.id, user.id);
  return json({
    slug: room.slug,
    name: room.name,
    owner_id: room.owner_id,
    membership
  });
}

async function handleRenameRoom(request, env, room, user) {
  const authorized = await isRoomOwner(env, room.id, user.id) ||
    await checkAdminKey(request, room.admin_key_hash);
  if (!authorized) return json({ error: "Forbidden" }, 403);

  const body = await readJson(request);
  const name = normalizeRoomName(body.name);

  await env.DB.prepare("UPDATE rooms SET name = ? WHERE id = ?").bind(name, room.id).run();
  return json({ slug: room.slug, name });
}

async function handleClaimRoom(request, env, room, user) {
  if (room.owner_id) return json({ error: "Room already has an owner" }, 409);

  const body = await readJson(request);
  const adminKey = body.admin_key || "";
  if (!adminKey || await sha256(adminKey) !== room.admin_key_hash) {
    return json({ error: "Invalid admin key" }, 403);
  }

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE rooms SET owner_id = ? WHERE id = ?").bind(user.id, room.id).run();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)"
  ).bind(room.id, user.id, now).run();

  return json({ slug: room.slug, name: room.name, ownership: "claimed" });
}

async function handleJoinRequest(request, env, room, user) {
  const membership = await env.DB.prepare(
    "SELECT role FROM room_members WHERE room_id = ? AND user_id = ?"
  ).bind(room.id, user.id).first();
  if (membership) return json({ error: "Already a member of this room" }, 409);

  const pending = await env.DB.prepare(
    "SELECT id FROM room_join_requests WHERE room_id = ? AND user_id = ? AND status = 'pending'"
  ).bind(room.id, user.id).first();
  if (pending) return json({ error: "Join request already pending" }, 409);

  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO room_join_requests (id, room_id, user_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
  ).bind(crypto.randomUUID(), room.id, user.id, now).run();

  return json({ status: "pending" }, 201);
}

async function handleListJoinRequests(env, room, user) {
  if (!await isRoomOwner(env, room.id, user.id)) {
    return json({ error: "Forbidden" }, 403);
  }

  const rows = await env.DB.prepare(
    `SELECT jr.id, jr.room_id, jr.user_id, u.username, jr.status, jr.created_at
     FROM room_join_requests jr
     JOIN users u ON u.id = jr.user_id
     WHERE jr.room_id = ? AND jr.status = 'pending'
     ORDER BY jr.created_at ASC`
  ).bind(room.id).all();

  return json({ requests: rows.results });
}

async function handleJoinRequestAction(env, room, requestId, action, user) {
  if (!await isRoomOwner(env, room.id, user.id)) {
    return json({ error: "Forbidden" }, 403);
  }

  const joinReq = await env.DB.prepare(
    "SELECT * FROM room_join_requests WHERE id = ? AND room_id = ? AND status = 'pending'"
  ).bind(requestId, room.id).first();
  if (!joinReq) return json({ error: "Request not found" }, 404);

  const now = new Date().toISOString();

  if (action === "approve") {
    await env.DB.prepare(
      "UPDATE room_join_requests SET status = 'approved' WHERE id = ?"
    ).bind(requestId).run();

    await env.DB.prepare(
      "INSERT OR IGNORE INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)"
    ).bind(room.id, joinReq.user_id, now).run();
  } else {
    await env.DB.prepare(
      "UPDATE room_join_requests SET status = 'rejected' WHERE id = ?"
    ).bind(requestId).run();
  }

  return json({ status: action === "approve" ? "approved" : "rejected" });
}

// ============================================================================
// Link handlers
// ============================================================================

async function handleListLinks(request, env, room, user) {
  const url = new URL(request.url);
  const sort = url.searchParams.get("sort") === "hot" ? "hot" : "newest";
  const order = sort === "hot" ? "upvote_count DESC, created_at DESC" : "created_at DESC";
  const rows = await env.DB.prepare(
    `SELECT links.*, votes.id AS viewer_vote_id,
            (SELECT COUNT(*) FROM replies WHERE replies.link_id = links.id AND replies.deleted_at IS NULL) AS reply_count
     FROM links
     LEFT JOIN votes ON votes.link_id = links.id AND votes.user_id = ?
     WHERE links.room_id = ? AND links.deleted_at IS NULL
     ORDER BY ${order}
     LIMIT 100`
  ).bind(user.id, room.id).all();

  return json({ links: rows.results.map(serializeLink) });
}

async function handleSubmitLink(request, env, room, user) {
  await rateLimit(env, `user:${user.id}:submit`, 3, 60);
  await rateLimit(env, `ip:${clientIp(request)}:submit`, 10, 60);
  await rateLimit(env, `room:${room.id}:submit-day`, 500, 86400);

  const body = await readJson(request);
  const canonicalUrl = normalizeUrl(body.url || "");
  assertPublicHttpUrl(canonicalUrl);
  const sourceHost = getSourceHost(canonicalUrl);
  const tags = normalizeTags(body.tags);
  const recommendationNote = normalizeRecommendationNote(body.recommendation_note);
  const aiSummary = normalizeAiSummary(body.ai_summary);

  const existing = await env.DB.prepare(
    "SELECT * FROM links WHERE room_id = ? AND canonical_url = ? AND deleted_at IS NULL"
  ).bind(room.id, canonicalUrl).first();
  if (existing) {
    return json({ link: serializeLink(existing), duplicate: true });
  }

  const metadata = await fetchMetadata(canonicalUrl);
  const now = new Date().toISOString();
  const link = {
    id: crypto.randomUUID(),
    original_url: body.url,
    canonical_url: canonicalUrl,
    title: metadata.title || null,
    description: metadata.description || null,
    image_url: metadata.image_url || null,
    source_host: sourceHost,
    metadata_status: metadata.status,
    tags: JSON.stringify(tags),
    recommendation_note: recommendationNote,
    ai_summary: aiSummary
  };

  await env.DB.prepare(
    `INSERT INTO links
     (id, room_id, user_id, original_url, canonical_url, title, description, image_url, source_host, metadata_status, tags, recommendation_note, ai_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    link.id,
    room.id,
    user.id,
    link.original_url,
    link.canonical_url,
    link.title,
    link.description,
    link.image_url,
    link.source_host,
    link.metadata_status,
    link.tags,
    link.recommendation_note,
    link.ai_summary,
    now
  ).run();
  await touchRoom(env, room.id);

  return json({ link: serializeLink({ ...link, upvote_count: 0, created_at: now, viewer_vote_id: null }), duplicate: false }, 201);
}

async function handleDeleteLink(request, env, room, linkId, user) {
  const authorized = await isRoomOwner(env, room.id, user.id) ||
    await checkAdminKey(request, room.admin_key_hash);
  if (!authorized) return json({ error: "Forbidden" }, 403);

  const link = await env.DB.prepare(
    "SELECT id FROM links WHERE id = ? AND room_id = ? AND deleted_at IS NULL"
  ).bind(linkId, room.id).first();
  if (!link) return json({ error: "Link not found" }, 404);

  await env.DB.prepare(
    "UPDATE links SET deleted_at = ? WHERE id = ? AND room_id = ?"
  ).bind(new Date().toISOString(), linkId, room.id).run();
  return json({ ok: true });
}

// ============================================================================
// Vote handlers
// ============================================================================

async function handleVote(request, env, room, linkId, user) {
  const link = await env.DB.prepare(
    "SELECT id, upvote_count FROM links WHERE id = ? AND room_id = ? AND deleted_at IS NULL"
  ).bind(linkId, room.id).first();
  if (!link) return json({ error: "Link not found" }, 404);

  if (request.method === "POST") {
    await rateLimit(env, `user:${user.id}:vote`, 60, 60);
    const voteId = crypto.randomUUID();
    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO votes (id, room_id, link_id, voter_id, user_id, value, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
    ).bind(voteId, room.id, linkId, user.id, user.id, now).run();
    if (result.meta.changes) {
      await env.DB.prepare("UPDATE links SET upvote_count = upvote_count + 1 WHERE id = ?").bind(link.id).run();
    }
  } else {
    const result = await env.DB.prepare(
      "DELETE FROM votes WHERE link_id = ? AND user_id = ?"
    ).bind(link.id, user.id).run();
    if (result.meta.changes) {
      await env.DB.prepare("UPDATE links SET upvote_count = MAX(0, upvote_count - 1) WHERE id = ?").bind(link.id).run();
    }
  }

  const updated = await env.DB.prepare(
    `SELECT links.*, votes.id AS viewer_vote_id
     FROM links
     LEFT JOIN votes ON votes.link_id = links.id AND votes.user_id = ?
     WHERE links.id = ?`
  ).bind(user.id, link.id).first();
  return json({ link: serializeLink(updated) });
}

// ============================================================================
// Reply handlers
// ============================================================================

async function handleListReplies(env, room, linkId) {
  const link = await env.DB.prepare(
    "SELECT id FROM links WHERE id = ? AND room_id = ? AND deleted_at IS NULL"
  ).bind(linkId, room.id).first();
  if (!link) return json({ error: "Link not found" }, 404);

  const rows = await env.DB.prepare(
    "SELECT * FROM replies WHERE link_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 200"
  ).bind(link.id).all();

  return json({ replies: rows.results.map(serializeReply) });
}

async function handleCreateReply(request, env, room, linkId, user) {
  const link = await env.DB.prepare(
    "SELECT id FROM links WHERE id = ? AND room_id = ? AND deleted_at IS NULL"
  ).bind(linkId, room.id).first();
  if (!link) return json({ error: "Link not found" }, 404);

  const body = await readJson(request);

  await rateLimit(env, `user:${user.id}:reply`, 20, 60);
  await rateLimit(env, `ip:${clientIp(request)}:reply`, 30, 60);
  await rateLimit(env, `link:${link.id}:reply-day`, 300, 86400);

  const replyBody = normalizeReplyBody(body.body);
  if (!replyBody) return json({ error: "Reply body is required" }, 400);

  let parentId = null;
  let depth = 0;
  if (body.parent_id) {
    const parent = await env.DB.prepare(
      "SELECT id, depth FROM replies WHERE id = ? AND link_id = ? AND deleted_at IS NULL"
    ).bind(body.parent_id, link.id).first();
    if (!parent) return json({ error: "Parent reply not found" }, 400);
    if ((parent.depth || 0) >= 3) {
      return json({ error: "Maximum nesting depth reached" }, 400);
    }
    parentId = parent.id;
    depth = (parent.depth || 0) + 1;
  }

  const authorName = normalizeAuthorName(body.author_name, user.id);
  const now = new Date().toISOString();
  const reply = {
    id: crypto.randomUUID(),
    room_id: room.id,
    link_id: link.id,
    parent_id: parentId,
    client_id: user.id,
    author_name: authorName,
    body: replyBody,
    depth
  };

  await env.DB.prepare(
    "INSERT INTO replies (id, room_id, link_id, parent_id, client_id, user_id, author_name, body, depth, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(reply.id, reply.room_id, reply.link_id, reply.parent_id, reply.client_id, user.id, reply.author_name, reply.body, reply.depth, now).run();

  await touchRoom(env, room.id);

  return json({ reply: serializeReply({ ...reply, created_at: now, deleted_at: null }) }, 201);
}

async function handleDeleteReply(request, env, room, linkId, replyId, user) {
  const authorized = await isRoomOwner(env, room.id, user.id) ||
    await checkAdminKey(request, room.admin_key_hash);
  if (!authorized) return json({ error: "Forbidden" }, 403);

  const reply = await env.DB.prepare(
    "SELECT id FROM replies WHERE id = ? AND link_id = ? AND room_id = ? AND deleted_at IS NULL"
  ).bind(replyId, linkId, room.id).first();
  if (!reply) return json({ error: "Reply not found" }, 404);

  await env.DB.prepare(
    "UPDATE replies SET deleted_at = ? WHERE id = ?"
  ).bind(new Date().toISOString(), reply.id).run();

  return json({ ok: true });
}

// ============================================================================
// Auth helpers
// ============================================================================

async function authenticate(env, request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const tokenHash = await sha256(match[1]);
  const session = await env.DB.prepare(
    `SELECT u.id, u.username
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(tokenHash, new Date().toISOString()).first();

  if (!session) return null;

  // Extend session by 7 days
  const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "UPDATE sessions SET expires_at = ? WHERE token_hash = ?"
  ).bind(newExpiry, tokenHash).run();

  return session;
}

async function createSession(env, userId) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), userId, tokenHash, now, expires).run();

  return { token, expires_at: expires };
}

async function checkAdminKey(request, adminKeyHash) {
  const adminKey = request.headers.get("x-admin-key") || "";
  return adminKey && await sha256(adminKey) === adminKeyHash;
}

// ============================================================================
// Membership helpers
// ============================================================================

async function requireMembership(env, roomId, userId) {
  const member = await env.DB.prepare(
    "SELECT role FROM room_members WHERE room_id = ? AND user_id = ?"
  ).bind(roomId, userId).first();
  return member || null;
}

async function isRoomOwner(env, roomId, userId) {
  const member = await requireMembership(env, roomId, userId);
  return member?.role === "owner";
}

async function getMembership(env, roomId, userId) {
  const member = await env.DB.prepare(
    "SELECT role FROM room_members WHERE room_id = ? AND user_id = ?"
  ).bind(roomId, userId).first();

  const pendingReq = await env.DB.prepare(
    "SELECT status FROM room_join_requests WHERE room_id = ? AND user_id = ? AND status = 'pending'"
  ).bind(roomId, userId).first();

  return {
    is_member: !!member,
    is_owner: member?.role === "owner",
    pending_join: !!pendingReq
  };
}

// ============================================================================
// Password hashing (PBKDF2)
// ============================================================================

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  const newHashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return newHashHex === hashHex;
}

export function validatePassword(value) {
  if (typeof value !== "string") return false;
  return value.length >= 8 && /[a-zA-Z]/.test(value) && /[0-9]/.test(value);
}

export function normalizeUsername(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").slice(0, 32);
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return null;
  return name;
}

// ============================================================================
// Existing helpers (mostly unchanged)
// ============================================================================

async function findRoom(env, slug) {
  return env.DB.prepare("SELECT * FROM rooms WHERE slug = ?").bind(slug).first();
}

async function touchRoom(env, roomId) {
  return env.DB.prepare("UPDATE rooms SET last_active_at = ? WHERE id = ?").bind(new Date().toISOString(), roomId).run();
}

async function rateLimit(env, bucket, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const current = await env.DB.prepare("SELECT count, reset_at FROM rate_limits WHERE bucket = ?").bind(bucket).first();
  if (!current || current.reset_at <= now) {
    await env.DB.prepare("INSERT OR REPLACE INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?)").bind(bucket, now + windowSeconds).run();
    return;
  }
  if (current.count >= limit) {
    throw new HttpError("Rate limit exceeded", 429);
  }
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket = ?").bind(bucket).run();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError("Invalid JSON", 400);
  }
}

function serializeLink(link) {
  return {
    id: link.id,
    original_url: link.original_url,
    canonical_url: link.canonical_url,
    title: link.title,
    description: link.description,
    image_url: link.image_url,
    source_host: link.source_host,
    metadata_status: link.metadata_status,
    tags: parseTags(link.tags),
    recommendation_note: link.recommendation_note || null,
    ai_summary: link.ai_summary || null,
    upvote_count: link.upvote_count || 0,
    reply_count: link.reply_count || 0,
    created_at: link.created_at,
    viewer_has_upvoted: Boolean(link.viewer_vote_id)
  };
}

export function normalizeRoomName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").slice(0, 64);
  return name || null;
}

export function normalizeTags(value) {
  const rawTags = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  const seen = new Set();
  const tags = [];
  for (const rawTag of rawTags) {
    if (typeof rawTag !== "string") continue;
    const tag = rawTag.trim().replace(/^#+/, "").replace(/\s+/g, " ").slice(0, 32);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 8) break;
  }
  return tags;
}

export function parseTags(value) {
  if (!value) return [];
  try {
    const tags = JSON.parse(value);
    return Array.isArray(tags) ? normalizeTags(tags) : [];
  } catch {
    return [];
  }
}

export function normalizeRecommendationNote(value) {
  if (typeof value !== "string") return null;
  const note = value.trim().replace(/\s+/g, " ").slice(0, 280);
  return note || null;
}

export function normalizeAiSummary(value) {
  if (typeof value !== "string") return null;
  const summary = value.trim().replace(/\s+/g, " ").slice(0, 1000);
  return summary || null;
}

function serializeReply(reply) {
  return {
    id: reply.id,
    link_id: reply.link_id,
    parent_id: reply.parent_id || null,
    client_id: reply.client_id,
    author_name: reply.author_name || "anon",
    body: reply.body,
    depth: reply.depth || 0,
    created_at: reply.created_at
  };
}

export function normalizeReplyBody(value) {
  if (typeof value !== "string") return null;
  const body = value.trim().replace(/\s+/g, " ").slice(0, 1000);
  return body || null;
}

export function normalizeAuthorName(value, userId) {
  if (typeof value === "string" && value.trim()) {
    return value.trim().replace(/\s+/g, " ").slice(0, 32);
  }
  return `anon-${userId.slice(0, 6)}`;
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

function randomToken(bytes) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
