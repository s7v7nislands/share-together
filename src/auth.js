import { signJwt, verifyJwt } from "./jwt.js";

const WECHAT_API_BASE = "https://api.weixin.qq.com";
const POLL_EXPIRY_SECONDS = 300;    // 5 minutes
const SESSION_EXPIRY = 604800;      // 7 days

// Mini program access_token cache
let cachedAccessToken = null;
let accessTokenExpiresAt = 0;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function randomDigits(length) {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

// Fetch or reuse mini program access_token
async function getMiniAccessToken(env) {
  const now = Date.now();
  if (cachedAccessToken && now < accessTokenExpiresAt) {
    return cachedAccessToken;
  }
  const url =
    `${WECHAT_API_BASE}/cgi-bin/token?grant_type=client_credential` +
    `&appid=${env.WECHAT_MINI_APP_ID}&secret=${env.WECHAT_MINI_APP_SECRET}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.access_token) {
    cachedAccessToken = data.access_token;
    accessTokenExpiresAt = now + (data.expires_in - 300) * 1000;
    return cachedAccessToken;
  }
  console.error("Failed to get mini program access_token:", { errcode: data.errcode, errmsg: data.errmsg });
  throw new Error("Failed to get mini program access_token");
}

// POST /api/auth/wechat/start
export async function handleLoginStart(env) {
  const pollId = randomDigits(6);
  const verifyCode = randomDigits(6);
  const now = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO login_sessions (poll_id, verify_code, created_at) VALUES (?, ?, ?)"
  ).bind(pollId, verifyCode, now).run();

  // Generate mini program QR code with scene parameter
  let qrcode = null;
  try {
    const accessToken = await getMiniAccessToken(env);
    const wxUrl = `${WECHAT_API_BASE}/wxa/getwxacodeunlimit?access_token=${accessToken}`;
    const res = await fetch(wxUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scene: pollId,
        page: "pages/login/login",
        check_path: false,
        env_version: "release",
        width: 280
      })
    });
    if (res.ok) {
      const buffer = await res.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      qrcode = `data:image/png;base64,${base64}`;
    } else {
      // wxacode API returns error as JSON even with 200-ish status
      const errData = await res.json().catch(() => ({}));
      console.error("wxacode error:", errData);
    }
  } catch (e) {
    console.error("Failed to generate mini program code:", e.message);
    // Proceed without QR code — frontend will show verify_code only
  }

  return json({ poll_id: pollId, verify_code: verifyCode, qrcode });
}

// GET /api/auth/wechat/poll?poll_id=xxx
export async function handleLoginPoll(env, url) {
  const pollId = url.searchParams.get("poll_id");
  if (!pollId) {
    return json({ error: "Missing poll_id" }, 400);
  }

  const session = await env.DB.prepare(
    "SELECT session_jwt, created_at FROM login_sessions WHERE poll_id = ?"
  ).bind(pollId).first();

  if (!session) {
    return json({ error: "Invalid poll_id" }, 404);
  }

  if (session.session_jwt) {
    // Login complete — return token and clean up
    await env.DB.prepare(
      "DELETE FROM login_sessions WHERE poll_id = ?"
    ).bind(pollId).run();
    return json({ token: session.session_jwt });
  }

  // Check expiry
  const createdAt = new Date(session.created_at).getTime();
  if (Date.now() - createdAt > POLL_EXPIRY_SECONDS * 1000) {
    await env.DB.prepare(
      "DELETE FROM login_sessions WHERE poll_id = ?"
    ).bind(pollId).run();
    return json({ expired: true });
  }

  return json({ ready: false });
}

// POST /api/auth/wechat/mini-login  (called by mini program)
export async function handleMiniLogin(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const pollId = (body.poll_id || "").toString().trim();
  const code = (body.code || "").toString().trim();

  if (!pollId || !code) {
    return json({ error: "Missing poll_id or code" }, 400);
  }

  // Verify poll session exists and not expired
  const session = await env.DB.prepare(
    "SELECT created_at, session_jwt FROM login_sessions WHERE poll_id = ?"
  ).bind(pollId).first();

  if (!session) {
    return json({ error: "Invalid poll_id" }, 404);
  }

  if (session.session_jwt) {
    return json({ error: "Session already completed" }, 409);
  }

  const createdAt = new Date(session.created_at).getTime();
  if (Date.now() - createdAt > POLL_EXPIRY_SECONDS * 1000) {
    await env.DB.prepare(
      "DELETE FROM login_sessions WHERE poll_id = ?"
    ).bind(pollId).run();
    return json({ error: "Session expired" }, 410);
  }

  // Exchange code for openid via jscode2session
  let openid;
  try {
    const wxUrl =
      `${WECHAT_API_BASE}/sns/jscode2session?appid=${env.WECHAT_MINI_APP_ID}` +
      `&secret=${env.WECHAT_MINI_APP_SECRET}&js_code=${code}&grant_type=authorization_code`;
    const res = await fetch(wxUrl);
    const data = await res.json();
    if (data.errcode) {
      console.error("jscode2session error:", { errcode: data.errcode, errmsg: data.errmsg });
      return json({ error: "WeChat auth failed" }, 400);
    }
    openid = data.openid;
  } catch {
    return json({ error: "WeChat API unavailable" }, 502);
  }

  if (!openid) {
    return json({ error: "WeChat auth failed" }, 400);
  }

  // Upsert user — jscode2session only returns openid, no nickname/avatar
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE wechat_openid = ?"
  ).bind(openid).first();

  let userId;
  if (existing) {
    userId = existing.id;
    await env.DB.prepare(
      "UPDATE users SET last_login_at = ? WHERE id = ?"
    ).bind(now, userId).run();
  } else {
    userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, wechat_openid, wechat_unionid, nickname, avatar_url, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(userId, openid, null, null, null, now, now).run();
  }

  // Sign session JWT
  const sessionJwt = await signJwt(
    { sub: userId, openid, nickname: null, avatar_url: null },
    env.JWT_SECRET,
    SESSION_EXPIRY
  );

  // Store JWT in login session so web poll can retrieve it
  await env.DB.prepare(
    "UPDATE login_sessions SET session_jwt = ?, completed_at = ? WHERE poll_id = ?"
  ).bind(sessionJwt, now, pollId).run();

  return json({ ok: true });
}

// GET /api/auth/me
export async function handleAuthMe(request, env) {
  const user = await verifyAuth(request, env);
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }
  return json({
    id: user.sub,
    openid: user.openid,
    nickname: user.nickname,
    avatar_url: user.avatar_url
  });
}

// Verify JWT from Authorization header — returns payload or null
export async function verifyAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifyJwt(match[1], env.JWT_SECRET);
}
