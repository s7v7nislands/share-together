import { signJwt, verifyJwt } from "./jwt.js";

const WECHAT_OAUTH_BASE = "https://open.weixin.qq.com/connect/qrconnect";
const WECHAT_API_BASE = "https://api.weixin.qq.com/sns";

const STATE_EXPIRY = 300;      // 5 minutes
const SESSION_EXPIRY = 604800; // 7 days

function redirect(url, status = 302) {
  return new Response(null, { status, headers: { Location: url } });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

// GET /api/auth/wechat/url
export async function handleWechatAuthUrl(env, url) {
  const returnUrl = url.searchParams.get("return_url") || "/";

  const stateJwt = await signJwt({ returnUrl }, env.JWT_SECRET, STATE_EXPIRY);
  const redirectUri = encodeURIComponent(`${url.origin}/api/auth/wechat/callback`);

  const authUrl =
    `${WECHAT_OAUTH_BASE}?appid=${env.WECHAT_APP_ID}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=snsapi_login` +
    `&state=${encodeURIComponent(stateJwt)}`;

  return json({ auth_url: authUrl });
}

// GET /api/auth/wechat/callback?code=xxx&state=yyy
export async function handleWechatCallback(env, request, url) {
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code) {
    return redirect(`/?error=${encodeURIComponent("Missing authorization code")}`);
  }

  // Verify state JWT -- mandatory for CSRF protection
  if (!stateParam) {
    return redirect(`/?error=${encodeURIComponent("Invalid state")}`);
  }
  const statePayload = await verifyJwt(stateParam, env.JWT_SECRET);
  if (!statePayload) {
    return redirect(`/?error=${encodeURIComponent("Invalid state")}`);
  }
  const returnUrl = statePayload.returnUrl || "/";

  // Exchange code for access_token
  let tokenResponse;
  try {
    const tokenUrl =
      `${WECHAT_API_BASE}/oauth2/access_token?appid=${env.WECHAT_APP_ID}` +
      `&secret=${env.WECHAT_APP_SECRET}&code=${code}&grant_type=authorization_code`;
    const res = await fetch(tokenUrl);
    tokenResponse = await res.json();
  } catch {
    return redirect(`${returnUrl}#error=${encodeURIComponent("WeChat API unavailable")}`);
  }

  if (tokenResponse.errcode) {
    console.error("WeChat token error:", { errcode: tokenResponse.errcode, errmsg: tokenResponse.errmsg });
    return redirect(`${returnUrl}#error=${encodeURIComponent(tokenResponse.errmsg || "WeChat auth failed")}`);
  }

  const { openid, access_token, unionid } = tokenResponse;

  // Get user info
  let nickname = null;
  let avatarUrl = null;
  try {
    const userUrl =
      `${WECHAT_API_BASE}/userinfo?access_token=${access_token}&openid=${openid}`;
    const userRes = await fetch(userUrl);
    const userInfo = await userRes.json();
    if (!userInfo.errcode) {
      nickname = userInfo.nickname || null;
      avatarUrl = userInfo.headimgurl || null;
    }
  } catch {
    // User info is best-effort; proceed without it
  }

  // Upsert user
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE wechat_openid = ?"
  ).bind(openid).first();

  let userId;
  if (existing) {
    userId = existing.id;
    await env.DB.prepare(
      "UPDATE users SET wechat_unionid = COALESCE(?, wechat_unionid), nickname = ?, avatar_url = ?, last_login_at = ? WHERE id = ?"
    ).bind(unionid || null, nickname, avatarUrl, now, userId).run();
  } else {
    userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, wechat_openid, wechat_unionid, nickname, avatar_url, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(userId, openid, unionid || null, nickname, avatarUrl, now, now).run();
  }

  // Sign session JWT
  const sessionJwt = await signJwt(
    { sub: userId, openid, nickname, avatar_url: avatarUrl },
    env.JWT_SECRET,
    SESSION_EXPIRY
  );

  return redirect(`${returnUrl}#token=${encodeURIComponent(sessionJwt)}`);
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
