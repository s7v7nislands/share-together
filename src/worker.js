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

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (request.method === "GET" && roomMatch) {
    const room = await findRoom(env, roomMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);
    return json({ slug: room.slug });
  }

  const linksMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/links$/);
  if (request.method === "GET" && linksMatch) {
    const room = await findRoom(env, linksMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const sort = url.searchParams.get("sort") === "hot" ? "hot" : "newest";
    const voterId = sanitizeClientId(url.searchParams.get("client_id"));
    const order = sort === "hot" ? "upvote_count DESC, created_at DESC" : "created_at DESC";
    const rows = await env.DB.prepare(
      `SELECT links.*, votes.id AS viewer_vote_id,
              (SELECT COUNT(*) FROM replies WHERE replies.link_id = links.id AND replies.deleted_at IS NULL) AS reply_count
       FROM links
       LEFT JOIN votes ON votes.link_id = links.id AND votes.voter_id = ?
       WHERE links.room_id = ? AND links.deleted_at IS NULL
       ORDER BY ${order}
       LIMIT 100`
    ).bind(voterId || "", room.id).all();

    return json({ links: rows.results.map(serializeLink) });
  }

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

    return json({ link: serializeLink({ ...link, upvote_count: 0, created_at: now, viewer_vote_id: null }), duplicate: false }, 201);
  }

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
    return json({ link: serializeLink(updated) });
  }

  const deleteMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/links\/([^/]+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    const room = await findRoom(env, deleteMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const adminKey = request.headers.get("x-admin-key") || "";
    if (!adminKey || await sha256(adminKey) !== room.admin_key_hash) {
      return json({ error: "Forbidden" }, 403);
    }

    await env.DB.prepare(
      "UPDATE links SET deleted_at = ? WHERE id = ? AND room_id = ?"
    ).bind(new Date().toISOString(), deleteMatch[2], room.id).run();
    return json({ ok: true });
  }

  // --- Replies ---

  const repliesMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/links\/([^/]+)\/replies$/);
  if (repliesMatch && request.method === "GET") {
    const room = await findRoom(env, repliesMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const link = await env.DB.prepare(
      "SELECT id FROM links WHERE id = ? AND room_id = ? AND deleted_at IS NULL"
    ).bind(repliesMatch[2], room.id).first();
    if (!link) return json({ error: "Link not found" }, 404);

    const rows = await env.DB.prepare(
      "SELECT * FROM replies WHERE link_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 200"
    ).bind(link.id).all();

    return json({ replies: rows.results.map(serializeReply) });
  }

  if (repliesMatch && request.method === "POST") {
    const room = await findRoom(env, repliesMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const link = await env.DB.prepare(
      "SELECT id FROM links WHERE id = ? AND room_id = ? AND deleted_at IS NULL"
    ).bind(repliesMatch[2], room.id).first();
    if (!link) return json({ error: "Link not found" }, 404);

    const body = await readJson(request);
    const clientId = sanitizeClientId(body.client_id);
    if (!clientId) return json({ error: "Missing client_id" }, 400);

    await rateLimit(env, `client:${clientId}:reply`, 20, 60);
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

    const authorName = normalizeAuthorName(body.author_name, clientId);
    const now = new Date().toISOString();
    const reply = {
      id: crypto.randomUUID(),
      room_id: room.id,
      link_id: link.id,
      parent_id: parentId,
      client_id: clientId,
      author_name: authorName,
      body: replyBody,
      depth
    };

    await env.DB.prepare(
      "INSERT INTO replies (id, room_id, link_id, parent_id, client_id, author_name, body, depth, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(reply.id, reply.room_id, reply.link_id, reply.parent_id, reply.client_id, reply.author_name, reply.body, reply.depth, now).run();

    await touchRoom(env, room.id);

    return json({ reply: serializeReply({ ...reply, created_at: now, deleted_at: null }) }, 201);
  }

  const replyDeleteMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/links\/([^/]+)\/replies\/([^/]+)$/);
  if (request.method === "DELETE" && replyDeleteMatch) {
    const room = await findRoom(env, replyDeleteMatch[1]);
    if (!room) return json({ error: "Room not found" }, 404);

    const adminKey = request.headers.get("x-admin-key") || "";
    if (!adminKey || await sha256(adminKey) !== room.admin_key_hash) {
      return json({ error: "Forbidden" }, 403);
    }

    const reply = await env.DB.prepare(
      "SELECT id FROM replies WHERE id = ? AND link_id = ? AND room_id = ? AND deleted_at IS NULL"
    ).bind(replyDeleteMatch[3], replyDeleteMatch[2], room.id).first();
    if (!reply) return json({ error: "Reply not found" }, 404);

    await env.DB.prepare(
      "UPDATE replies SET deleted_at = ? WHERE id = ?"
    ).bind(new Date().toISOString(), reply.id).run();

    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

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
    upvote_count: link.upvote_count || 0,
    reply_count: link.reply_count || 0,
    created_at: link.created_at,
    viewer_has_upvoted: Boolean(link.viewer_vote_id)
  };
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

export function normalizeAuthorName(value, clientId) {
  if (typeof value === "string" && value.trim()) {
    return value.trim().replace(/\s+/g, " ").slice(0, 32);
  }
  return `anon-${clientId.slice(0, 6)}`;
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
