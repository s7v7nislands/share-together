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
  // POST /api/rooms — create room
  if (request.method === "POST" && url.pathname === "/api/rooms") {
    await rateLimit(env, `ip:${clientIp(request)}:create-room`, 10, 60);
    const now = new Date().toISOString();
    const room = {
      id: crypto.randomUUID(),
      slug: `room-${randomToken(8)}`,
      adminKey: randomToken(32)
    };
    const adminHash = await sha256(room.adminKey);

    await env.DB.prepare(
      "INSERT INTO rooms (id, slug, admin_key_hash, created_at, last_active_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(room.id, room.slug, adminHash, now, now).run();

    return json({ slug: room.slug, admin_key: room.adminKey });
  }

  // GET /api/rooms/:slug — verify room
  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (request.method === "GET" && roomMatch) {
    const room = await findRoom(env, roomMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);
    return json({ slug: room.slug });
  }

  // GET /api/rooms/:slug/links — list links
  const linksMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/links$/);
  if (request.method === "GET" && linksMatch) {
    const room = await findRoom(env, linksMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const sort = url.searchParams.get("sort") === "hot" ? "hot" : "newest";
    const voterId = sanitizeClientId(url.searchParams.get("client_id"));
    const order = sort === "hot" ? "upvote_count DESC, created_at DESC" : "created_at DESC";
    const rows = await env.DB.prepare(
      `SELECT links.*, votes.id AS viewer_vote_id
       FROM links
       LEFT JOIN votes ON votes.link_id = links.id AND votes.voter_id = ?
       WHERE links.room_id = ? AND links.deleted_at IS NULL
       ORDER BY ${order}
       LIMIT 100`
    ).bind(voterId || "", room.id).all();

    // Attach comment counts
    const linkIds = rows.results.map((r) => r.id);
    const commentCounts = {};
    if (linkIds.length > 0) {
      const placeholders = linkIds.map(() => "?").join(",");
      const counts = await env.DB.prepare(
        `SELECT link_id, COUNT(*) AS cnt FROM comments WHERE link_id IN (${placeholders}) AND deleted_at IS NULL GROUP BY link_id`
      ).bind(...linkIds).all();
      for (const row of counts.results) {
        commentCounts[row.link_id] = row.cnt;
      }
    }

    return json({ links: rows.results.map((l) => serializeLink(l, commentCounts[l.id] || 0)) });
  }

  // POST /api/rooms/:slug/links — submit link
  if (request.method === "POST" && linksMatch) {
    const room = await findRoom(env, linksMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const body = await readJson(request);
    const clientId = sanitizeClientId(body.client_id);
    if (!clientId) return json({ error: "Missing client_id" }, 400);

    await rateLimit(env, `client:${clientId}:submit`, 3, 60);
    await rateLimit(env, `ip:${clientIp(request)}:submit`, 10, 60);
    await rateLimit(env, `room:${room.id}:submit-day`, 500, 86400);

    const canonicalUrl = normalizeUrl(body.url || "");
    assertPublicHttpUrl(canonicalUrl);
    const sourceHost = getSourceHost(canonicalUrl);
    const tags = normalizeTags(body.tags);
    const recommendationNote = normalizeRecommendationNote(body.recommendation_note);

    const existing = await env.DB.prepare(
      "SELECT * FROM links WHERE room_id = ? AND canonical_url = ? AND deleted_at IS NULL"
    ).bind(room.id, canonicalUrl).first();
    if (existing) {
      return json({ link: serializeLink(existing, 0), duplicate: true });
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
      recommendation_note: recommendationNote
    };

    await env.DB.prepare(
      `INSERT INTO links
       (id, room_id, original_url, canonical_url, title, description, image_url, source_host, metadata_status, tags, recommendation_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      link.id,
      room.id,
      link.original_url,
      link.canonical_url,
      link.title,
      link.description,
      link.image_url,
      link.source_host,
      link.metadata_status,
      link.tags,
      link.recommendation_note,
      now
    ).run();
    await touchRoom(env, room.id);

    return json({ link: serializeLink({ ...link, upvote_count: 0, created_at: now, viewer_vote_id: null }, 0), duplicate: false }, 201);
  }

  // PATCH /api/rooms/:slug/links/:id — update tags and/or recommendation_note
  const linkMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/links\/([^/]+)$/);
  if (request.method === "PATCH" && linkMatch) {
    const room = await findRoom(env, linkMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const link = await env.DB.prepare(
      "SELECT * FROM links WHERE id = ? AND room_id = ? AND deleted_at IS NULL"
    ).bind(linkMatch[2], room.id).first();
    if (!link) return json({ error: "Link not found" }, 404);

    const body = await readJson(request);
    const clientId = sanitizeClientId(body.client_id);
    if (!clientId) return json({ error: "Missing client_id" }, 400);

    await rateLimit(env, `client:${clientId}:patch`, 10, 60);

    const updates = {};
    if (body.tags !== undefined) {
      updates.tags = JSON.stringify(normalizeTags(body.tags));
    }
    if (body.recommendation_note !== undefined) {
      updates.recommendation_note = normalizeRecommendationNote(body.recommendation_note);
    }

    if (Object.keys(updates).length === 0) {
      return json({ error: "Nothing to update" }, 400);
    }

    const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
    const values = Object.values(updates);
    await env.DB.prepare(
      `UPDATE links SET ${setClauses} WHERE id = ?`
    ).bind(...values, link.id).run();

    const updated = await env.DB.prepare("SELECT * FROM links WHERE id = ?").bind(link.id).first();
    const commentCount = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM comments WHERE link_id = ? AND deleted_at IS NULL"
    ).bind(link.id).first();
    return json({ link: serializeLink(updated, commentCount?.cnt || 0) });
  }

  // DELETE /api/rooms/:slug/links/:id — admin soft-delete link
  if (request.method === "DELETE" && linkMatch) {
    const room = await findRoom(env, linkMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const adminKey = request.headers.get("x-admin-key") || "";
    if (!adminKey || await sha256(adminKey) !== room.admin_key_hash) {
      return json({ error: "Forbidden" }, 403);
    }

    await env.DB.prepare(
      "UPDATE links SET deleted_at = ? WHERE id = ? AND room_id = ?"
    ).bind(new Date().toISOString(), linkMatch[2], room.id).run();
    return json({ ok: true });
  }

  // Vote routes: POST/DELETE /api/rooms/:slug/links/:id/vote
  const voteMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/links\/([^/]+)\/vote$/);
  if (voteMatch && (request.method === "POST" || request.method === "DELETE")) {
    const room = await findRoom(env, voteMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const body = request.method === "POST" ? await readJson(request) : {};
    const clientId = sanitizeClientId(body.client_id || url.searchParams.get("client_id"));
    if (!clientId) return json({ error: "Missing client_id" }, 400);
    await rateLimit(env, `client:${clientId}:vote`, 60, 60);

    const link = await env.DB.prepare(
      "SELECT id, upvote_count FROM links WHERE id = ? AND room_id = ? AND deleted_at IS NULL"
    ).bind(voteMatch[2], room.id).first();
    if (!link) return json({ error: "Link not found" }, 404);

    if (request.method === "POST") {
      const voteId = crypto.randomUUID();
      const result = await env.DB.prepare(
        "INSERT OR IGNORE INTO votes (id, room_id, link_id, voter_id, value, created_at) VALUES (?, ?, ?, ?, 1, ?)"
      ).bind(voteId, room.id, link.id, clientId, new Date().toISOString()).run();
      if (result.meta.changes) {
        await env.DB.prepare("UPDATE links SET upvote_count = upvote_count + 1 WHERE id = ?").bind(link.id).run();
      }
    } else {
      const result = await env.DB.prepare(
        "DELETE FROM votes WHERE link_id = ? AND voter_id = ?"
      ).bind(link.id, clientId).run();
      if (result.meta.changes) {
        await env.DB.prepare("UPDATE links SET upvote_count = MAX(0, upvote_count - 1) WHERE id = ?").bind(link.id).run();
      }
    }

    const updated = await env.DB.prepare(
      `SELECT links.*, votes.id AS viewer_vote_id
       FROM links
       LEFT JOIN votes ON votes.link_id = links.id AND votes.voter_id = ?
       WHERE links.id = ?`
    ).bind(clientId, link.id).first();
    const commentCount = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM comments WHERE link_id = ? AND deleted_at IS NULL"
    ).bind(link.id).first();
    return json({ link: serializeLink(updated, commentCount?.cnt || 0) });
  }

  // GET /api/rooms/:slug/links/:id/comments — list comments for a link (tree)
  const commentsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/links\/([^/]+)\/comments$/);
  if (request.method === "GET" && commentsMatch) {
    const room = await findRoom(env, commentsMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const link = await env.DB.prepare(
      "SELECT id FROM links WHERE id = ? AND room_id = ? AND deleted_at IS NULL"
    ).bind(commentsMatch[2], room.id).first();
    if (!link) return json({ error: "Link not found" }, 404);

    const rows = await env.DB.prepare(
      "SELECT * FROM comments WHERE link_id = ? AND deleted_at IS NULL ORDER BY created_at ASC"
    ).bind(link.id).all();

    return json({ comments: buildCommentTree(rows.results.map(serializeComment)) });
  }

  // POST /api/rooms/:slug/links/:id/comments — add comment
  if (request.method === "POST" && commentsMatch) {
    const room = await findRoom(env, commentsMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const link = await env.DB.prepare(
      "SELECT id FROM links WHERE id = ? AND room_id = ? AND deleted_at IS NULL"
    ).bind(commentsMatch[2], room.id).first();
    if (!link) return json({ error: "Link not found" }, 404);

    const body = await readJson(request);
    const clientId = sanitizeClientId(body.client_id);
    if (!clientId) return json({ error: "Missing client_id" }, 400);

    await rateLimit(env, `client:${clientId}:comment`, 10, 60);
    await rateLimit(env, `ip:${clientIp(request)}:comment`, 20, 60);

    const content = normalizeCommentContent(body.content);
    if (!content) return json({ error: "Comment content is required" }, 400);

    // Validate parent_id if provided
    let parentId = null;
    if (body.parent_id) {
      const parent = await env.DB.prepare(
        "SELECT id FROM comments WHERE id = ? AND link_id = ? AND deleted_at IS NULL"
      ).bind(body.parent_id, link.id).first();
      if (!parent) return json({ error: "Parent comment not found" }, 404);
      parentId = parent.id;
    }

    // Validate and sanitize attachments
    const attachments = normalizeAttachments(body.attachments);

    const now = new Date().toISOString();
    const comment = {
      id: crypto.randomUUID(),
      room_id: room.id,
      link_id: link.id,
      parent_id: parentId,
      author_id: clientId,
      content,
      attachments: JSON.stringify(attachments),
      created_at: now
    };

    await env.DB.prepare(
      `INSERT INTO comments (id, room_id, link_id, parent_id, author_id, content, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      comment.id,
      comment.room_id,
      comment.link_id,
      comment.parent_id,
      comment.author_id,
      comment.content,
      comment.attachments,
      comment.created_at
    ).run();
    await touchRoom(env, room.id);

    return json({ comment: serializeComment(comment) }, 201);
  }

  // DELETE /api/rooms/:slug/links/:id/comments/:cid — admin soft-delete comment
  const deleteCommentMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/links\/([^/]+)\/comments\/([^/]+)$/);
  if (request.method === "DELETE" && deleteCommentMatch) {
    const room = await findRoom(env, deleteCommentMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const adminKey = request.headers.get("x-admin-key") || "";
    if (!adminKey || await sha256(adminKey) !== room.admin_key_hash) {
      return json({ error: "Forbidden" }, 403);
    }

    await env.DB.prepare(
      "UPDATE comments SET deleted_at = ? WHERE id = ? AND room_id = ?"
    ).bind(new Date().toISOString(), deleteCommentMatch[3], room.id).run();
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function serializeLink(link, commentCount = 0) {
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
    upvote_count: link.upvote_count || 0,
    created_at: link.created_at,
    viewer_has_upvoted: Boolean(link.viewer_vote_id),
    comment_count: commentCount
  };
}

function serializeComment(comment) {
  return {
    id: comment.id,
    link_id: comment.link_id,
    parent_id: comment.parent_id || null,
    author_id: comment.author_id,
    content: comment.content,
    attachments: parseAttachments(comment.attachments),
    created_at: comment.created_at,
    replies: []
  };
}

/** Build a nested tree from a flat list (sorted by created_at ASC) */
function buildCommentTree(comments) {
  const map = new Map();
  const roots = [];
  for (const c of comments) {
    map.set(c.id, c);
  }
  for (const c of comments) {
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id).replies.push(c);
    } else {
      roots.push(c);
    }
  }
  return roots;
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

function normalizeCommentContent(value) {
  if (typeof value !== "string") return null;
  const content = value.trim().slice(0, 2000);
  return content || null;
}

/**
 * Normalize attachments array.
 * Each attachment: { type: 'image' | 'markdown', name: string, content: string }
 * - image: content is base64 data URL (≤ 300KB after base64)
 * - markdown: content is raw markdown text (≤ 50KB)
 * Max 4 attachments per comment.
 */
function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (result.length >= 4) break;
    if (!item || typeof item !== "object") continue;
    const type = item.type === "markdown" ? "markdown" : "image";
    const name = typeof item.name === "string" ? item.name.slice(0, 128) : "";
    const content = typeof item.content === "string" ? item.content : "";
    if (!content) continue;
    // Size guard
    if (type === "image" && content.length > 400000) continue;   // ~300KB base64
    if (type === "markdown" && content.length > 51200) continue; // 50KB
    result.push({ type, name, content });
  }
  return result;
}

function parseAttachments(value) {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function sanitizeClientId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : null;
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
