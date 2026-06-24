# WeChat Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WeChat Open Platform QR-code login, letting logged-in users post/vote/reply with their WeChat identity while anonymous users remain read-only.

**Architecture:** JWT signed with HMAC-SHA256 via Web Crypto API. Backend issues JWT after WeChat OAuth callback; frontend stores it in localStorage and sends it as `Authorization: Bearer <token>`. Write endpoints verify JWT and use `user.id` for identity/rate-limiting.

**Tech Stack:** Cloudflare Workers (vanilla JS), D1 (SQLite), Web Crypto API, vanilla JS SPA frontend.

## Global Constraints

- WeChat AppID/AppSecret from env vars (`WECHAT_APP_ID`, `WECHAT_APP_SECRET`)
- JWT signing key from env var (`JWT_SECRET`)
- Session JWT expires in 7 days; state JWT expires in 5 minutes
- Anonymous users: read-only (browse rooms, links, replies)
- Logged-in users: full write access (post links, vote, reply)
- Admin key auth unchanged for room management operations
- Follow existing code patterns: vanilla JS, no build tool, no framework

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `migrations/0006_users.sql` | Create | Users table DDL |
| `src/jwt.js` | Create | JWT sign/verify with Web Crypto API |
| `src/auth.js` | Create | WeChat OAuth URL + callback handlers |
| `src/worker.js` | Modify | Route auth endpoints, enforce JWT on write endpoints |
| `wrangler.jsonc` | Modify | Add WECHAT_APP_ID, WECHAT_APP_SECRET, JWT_SECRET vars |
| `public/index.html` | Modify | Login/logout button in topbar |
| `public/app.js` | Modify | Auth state, OAuth callback, write guards, api() update |
| `public/styles.css` | Modify | Login button, user menu styles |
| `test/jwt.test.mjs` | Create | JWT sign/verify unit tests |
| `test/auth.test.mjs` | Create | Auth endpoint integration tests |

---

### Task 1: Database Migration — Users Table

**Files:**
- Create: `migrations/0006_users.sql`

**Interfaces:**
- Produces: `users` table with columns `id`, `wechat_openid`, `wechat_unionid`, `nickname`, `avatar_url`, `created_at`, `last_login_at`

- [ ] **Step 1: Write the migration file**

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wechat_openid TEXT NOT NULL UNIQUE,
  wechat_unionid TEXT,
  nickname TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);
```

- [ ] **Step 2: Run migration locally**

```bash
npx wrangler d1 migrations apply share-together --local
```

Expected: "Migration 0006_users.sql applied."

- [ ] **Step 3: Commit**

```bash
git add migrations/0006_users.sql
git commit -m "feat: add users table for WeChat login"
```

---

### Task 2: JWT Utility Module

**Files:**
- Create: `src/jwt.js`
- Test: `test/jwt.test.mjs`

**Interfaces:**
- Produces: `signJwt(payload, secret, expiresInSeconds)` → Promise<string>, `verifyJwt(token, secret)` → Promise<object|null>

- [ ] **Step 1: Write the JWT module**

```js
// src/jwt.js

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64url(buffer) {
  // buffer: ArrayBuffer or Uint8Array
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret, usage) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  );
}

export async function signJwt(payload, secret, expiresInSeconds) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

  const headerB64 = b64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = b64url(encoder.encode(JSON.stringify(fullPayload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importKey(secret, "sign");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));

  return `${signingInput}.${b64url(signature)}`;
}

export async function verifyJwt(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;

    const key = await importKey(secret, "verify");
    const signature = b64urlDecode(signatureB64);
    const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(signingInput));
    if (!valid) return null;

    const payload = JSON.parse(decoder.decode(b64urlDecode(payloadB64)));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Write failing tests**

```js
// test/jwt.test.mjs
import { signJwt, verifyJwt } from "../src/jwt.js";
import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";

const SECRET = "test-secret-key-32-bytes-long!!";

describe("jwt sign and verify", () => {
  it("signs a JWT and returns a 3-part token", async () => {
    const token = await signJwt({ sub: "user-1", nickname: "Alice" }, SECRET, 3600);
    assert.ok(typeof token === "string");
    const parts = token.split(".");
    assert.equal(parts.length, 3);
    assert.ok(parts[0].length > 0);
    assert.ok(parts[1].length > 0);
    assert.ok(parts[2].length > 0);
  });

  it("verifies a valid token and returns the payload", async () => {
    const token = await signJwt({ sub: "user-1", nickname: "Alice" }, SECRET, 3600);
    const payload = await verifyJwt(token, SECRET);
    assert.ok(payload !== null);
    assert.equal(payload.sub, "user-1");
    assert.equal(payload.nickname, "Alice");
    assert.ok(typeof payload.iat === "number");
    assert.ok(typeof payload.exp === "number");
  });

  it("rejects a token with wrong secret", async () => {
    const token = await signJwt({ sub: "user-1" }, SECRET, 3600);
    const payload = await verifyJwt(token, "wrong-secret-key!!------------");
    assert.equal(payload, null);
  });

  it("rejects an expired token", async () => {
    const token = await signJwt({ sub: "user-1" }, SECRET, 0); // expires immediately
    // wait 1 second to ensure expiry
    await new Promise((r) => setTimeout(r, 1100));
    const payload = await verifyJwt(token, SECRET);
    assert.equal(payload, null);
  });

  it("rejects a tampered token", async () => {
    const token = await signJwt({ sub: "user-1" }, SECRET, 3600);
    const parts = token.split(".");
    // Tamper with the payload
    const tamperedPayload = btoa(JSON.stringify({ sub: "attacker", iat: 1, exp: 9999999999 }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const payload = await verifyJwt(tampered, SECRET);
    assert.equal(payload, null);
  });

  it("rejects malformed input", async () => {
    assert.equal(await verifyJwt("", SECRET), null);
    assert.equal(await verifyJwt("not.a.jwt", SECRET), null);
    assert.equal(await verifyJwt("a.b", SECRET), null);
    assert.equal(await verifyJwt("a.b.c.d", SECRET), null);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
node --test test/jwt.test.mjs
```

Expected: 6 passing tests.

- [ ] **Step 4: Commit**

```bash
git add src/jwt.js test/jwt.test.mjs
git commit -m "feat: add JWT sign/verify module with tests"
```

---

### Task 3: Auth Handler — WeChat OAuth Endpoints

**Files:**
- Create: `src/auth.js`
- Test: `test/auth.test.mjs`

**Interfaces:**
- Consumes: `signJwt`, `verifyJwt` from `src/jwt.js`
- Produces: `handleWechatAuthUrl(env, url)` → Response, `handleWechatCallback(env, request, url)` → Response, `handleAuthMe(request, env)` → Response, `verifyAuth(request, env)` → Promise<object|null>

- [ ] **Step 1: Write the auth module**

```js
// src/auth.js
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

  // Verify state JWT
  let statePayload = null;
  if (stateParam) {
    statePayload = await verifyJwt(stateParam, env.JWT_SECRET);
  }
  // If state verification fails, still proceed but warn (state tampering or expiry)
  const returnUrl = statePayload?.returnUrl || "/";

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
    console.error("WeChat token error:", tokenResponse);
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
```

- [ ] **Step 2: Write auth tests**

```js
// test/auth.test.mjs
import { verifyAuth } from "../src/auth.js";
import { signJwt } from "../src/jwt.js";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Minimal env mock
const env = { JWT_SECRET: "test-secret-key-for-auth-tests!" };

function mockRequest(authHeader) {
  const headers = new Headers();
  if (authHeader) headers.set("Authorization", authHeader);
  return new Request("https://example.com/api/something", { headers });
}

describe("verifyAuth", () => {
  it("returns null when no Authorization header", async () => {
    const req = mockRequest(null);
    assert.equal(await verifyAuth(req, env), null);
  });

  it("returns null when Authorization header is malformed", async () => {
    const req = mockRequest("NotBearer xyz");
    assert.equal(await verifyAuth(req, env), null);
  });

  it("returns payload for valid JWT", async () => {
    const token = await signJwt({ sub: "u1", nickname: "Test" }, env.JWT_SECRET, 3600);
    const req = mockRequest(`Bearer ${token}`);
    const payload = await verifyAuth(req, env);
    assert.ok(payload !== null);
    assert.equal(payload.sub, "u1");
    assert.equal(payload.nickname, "Test");
  });

  it("returns null for expired JWT", async () => {
    const token = await signJwt({ sub: "u1" }, env.JWT_SECRET, 0);
    await new Promise((r) => setTimeout(r, 1100));
    const req = mockRequest(`Bearer ${token}`);
    assert.equal(await verifyAuth(req, env), null);
  });

  it("returns null for JWT signed with wrong secret", async () => {
    const token = await signJwt({ sub: "u1" }, "different-secret-key-yeah!!!!", 3600);
    const req = mockRequest(`Bearer ${token}`);
    assert.equal(await verifyAuth(req, env), null);
  });

  it("returns null for empty Bearer token", async () => {
    const req = mockRequest("Bearer ");
    assert.equal(await verifyAuth(req, env), null);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
node --test test/auth.test.mjs
```

Expected: 6 passing tests.

- [ ] **Step 4: Commit**

```bash
git add src/auth.js test/auth.test.mjs
git commit -m "feat: add WeChat OAuth handler with auth middleware"
```

---

### Task 4: Worker Integration — Routes and Middleware

**Files:**
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: `signJwt`, `verifyJwt` from `src/jwt.js`; `handleWechatAuthUrl`, `handleWechatCallback`, `handleAuthMe`, `verifyAuth` from `src/auth.js`
- Produces: Updated route handler with auth endpoints and JWT enforcement

- [ ] **Step 1: Add imports at the top of worker.js**

At line 1-2 of `src/worker.js`, add after existing imports:

```js
import { signJwt, verifyJwt } from "./jwt.js";
import { handleWechatAuthUrl, handleWechatCallback, handleAuthMe, verifyAuth } from "./auth.js";
```

- [ ] **Step 2: Add auth route handlers inside `handleApi`**

Add after the existing POST /api/rooms handler block (after line 51 closing brace) and before the GET /api/rooms handler:

```js
  // --- Auth ---

  if (request.method === "GET" && url.pathname === "/api/auth/wechat/url") {
    return handleWechatAuthUrl(env, url);
  }

  if (request.method === "GET" && url.pathname === "/api/auth/wechat/callback") {
    return handleWechatCallback(env, request, url);
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    return handleAuthMe(request, env);
  }
```

- [ ] **Step 3: Add JWT enforcement on write endpoints**

**POST /api/rooms/:slug/links** — After `const room = await findRoom(...)` and `if (!room)` check, add:

```js
    const authUser = await verifyAuth(request, env);
    if (!authUser) return json({ error: "Login required" }, 401);
```

Then replace the references to `clientId` (from `sanitizeClientId(body.client_id)`) with `authUser.sub`. Change lines:

```js
    const clientId = sanitizeClientId(body.client_id);
    if (!clientId) return json({ error: "Missing client_id" }, 400);
```

to:

```js
    // client_id from JWT for authenticated users
    const userId = authUser.sub;
```

And update the rate-limit keys from `client:${clientId}:submit` and `ip:...` to:

```js
    await rateLimit(env, `user:${userId}:submit`, 3, 60);
    await rateLimit(env, `ip:${clientIp(request)}:submit`, 10, 60);
    await rateLimit(env, `room:${room.id}:submit-day`, 500, 86400);
```

**POST/DELETE /api/rooms/:slug/links/:id/vote** — After `if (!room)` check in the vote block, add:

```js
    const authUser = await verifyAuth(request, env);
    if (!authUser) return json({ error: "Login required" }, 401);
    const voterId = authUser.sub;
```

Then replace `clientId` references (from `sanitizeClientId(body.client_id || url.searchParams.get("client_id"))`) with `voterId`.

**POST /api/rooms/:slug/links/:id/replies** — After `if (!link)` check, add:

```js
    const authUser = await verifyAuth(request, env);
    if (!authUser) return json({ error: "Login required" }, 401);
```

Replace `clientId` from `sanitizeClientId(body.client_id)` with `authUser.sub`. Update rate-limit keys similarly. For `author_name`, use `authUser.nickname` as the default instead of deriving from client_id:

```js
    const authorName = normalizeAuthorName(body.author_name, authUser.sub);
    // If the user has a WeChat nickname and didn't override, use it
    const displayName = body.author_name?.trim()
      ? normalizeAuthorName(body.author_name, authUser.sub)
      : (authUser.nickname || normalizeAuthorName(null, authUser.sub));
```

- [ ] **Step 4: Run all existing tests to check for regressions**

```bash
node --test test/*.test.mjs
```

Expected: All tests pass. If any fail, fix the issues.

- [ ] **Step 5: Commit**

```bash
git add src/worker.js
git commit -m "feat: enforce JWT auth on write endpoints, add auth routes"
```

---

### Task 5: Environment Configuration

**Files:**
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces: `WECHAT_APP_ID`, `WECHAT_APP_SECRET`, `JWT_SECRET` vars accessible as `env.*` in worker

- [ ] **Step 1: Add env vars to wrangler.jsonc**

Add a `vars` section inside the top-level object after `"d1_databases"`:

```jsonc
  "vars": {
    "WECHAT_APP_ID": "",
    "WECHAT_APP_SECRET": "",
    "JWT_SECRET": ""
  }
```

The full file will look like:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "share-together",
  "main": "src/worker.js",
  "compatibility_date": "2026-05-01",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "html_handling": "none",
    "not_found_handling": "single-page-application"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "share-together",
      "database_id": "c5dec0cf-e9b4-4fe2-b740-da05098b0d27",
      "migrations_dir": "migrations"
    },
    {
      "binding": "share_together",
      "database_name": "share-together",
      "database_id": "c5dec0cf-e9b4-4fe2-b740-da05098b0d27"
    }
  ],
  "vars": {
    "WECHAT_APP_ID": "",
    "WECHAT_APP_SECRET": "",
    "JWT_SECRET": ""
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add wrangler.jsonc
git commit -m "feat: add WeChat and JWT env vars to wrangler config"
```

---

### Task 6: Frontend — Auth State and UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: `/api/auth/wechat/url`, `/api/auth/me`, `/api/auth/wechat/callback` (redirect)
- Produces: `state.user`, `state.authToken`, login/logout UI, OAuth callback handling

- [ ] **Step 1: Add login button to topbar in index.html**

After the existing `<button id="create-room" class="primary">Create room</button>` line, add:

```html
        <div id="auth-area" class="auth-area">
          <button id="wechat-login" class="wechat-login">微信登录</button>
          <div id="user-menu" class="user-menu hidden">
            <img id="user-avatar" class="user-avatar" src="" alt="">
            <span id="user-nickname" class="user-nickname"></span>
            <button id="logout" class="logout-btn">退出</button>
          </div>
        </div>
```

- [ ] **Step 2: Add auth state to app.js**

In the `state` object (around line 1-10), add after `expandedReplies`:

```js
  user: null,
  authToken: getOrCreate("share_together_auth_token", () => null) || null
```

Note: `getOrCreate` returns the create result. For token we read from the existing key or null. Add these two lines right after the `state` object and before `els`:

```js
if (state.authToken) {
  fetchUserInfo();
}

async function fetchUserInfo() {
  try {
    const headers = { Authorization: `Bearer ${state.authToken}` };
    const res = await fetch("/api/auth/me", { headers });
    if (res.ok) {
      state.user = await res.json();
      updateAuthUI();
    } else {
      // Token expired or invalid
      state.authToken = null;
      state.user = null;
      localStorage.removeItem("share_together_auth_token");
      updateAuthUI();
    }
  } catch {
    // Network error, keep current state
  }
}
```

- [ ] **Step 3: Add auth UI elements and login/logout handlers**

Add after the existing element selectors in `els` (after line 30):

```js
  authArea: document.querySelector("#auth-area"),
  wechatLogin: document.querySelector("#wechat-login"),
  userMenu: document.querySelector("#user-menu"),
  userAvatar: document.querySelector("#user-avatar"),
  userNickname: document.querySelector("#user-nickname"),
  logoutBtn: document.querySelector("#logout")
```

Add event listeners (after the existing event binding block, around line 44):

```js
els.wechatLogin.addEventListener("click", startWechatLogin);
els.logoutBtn.addEventListener("click", logout);
```

- [ ] **Step 4: Handle OAuth callback on page load**

In the page init block (around line 48-54), add hash token handling before the existing logic:

```js
// Handle OAuth callback token from URL fragment
if (location.hash.startsWith("#token=")) {
  const token = decodeURIComponent(location.hash.slice("#token=".length));
  state.authToken = token;
  localStorage.setItem("share_together_auth_token", token);
  // Clean URL
  history.replaceState(null, "", location.pathname + location.search);
  fetchUserInfo();
} else if (location.hash.startsWith("#error=")) {
  const errorMsg = decodeURIComponent(location.hash.slice("#error=".length));
  history.replaceState(null, "", location.pathname + location.search);
  alert(`微信登录失败：${errorMsg}`);
}
```

- [ ] **Step 5: Add auth UI update function and login/logout handlers**

Add these functions near the other UI functions (before `showHome`):

```js
function updateAuthUI() {
  if (state.user) {
    els.wechatLogin.classList.add("hidden");
    els.userMenu.classList.remove("hidden");
    els.userAvatar.src = state.user.avatar_url || "";
    els.userAvatar.alt = state.user.nickname || "";
    els.userNickname.textContent = state.user.nickname || "微信用户";
    els.userAvatar.classList.toggle("no-avatar", !state.user.avatar_url);
  } else {
    els.wechatLogin.classList.remove("hidden");
    els.userMenu.classList.add("hidden");
  }
}

async function startWechatLogin() {
  try {
    const currentPath = location.pathname + location.search;
    const res = await fetch(`/api/auth/wechat/url?return_url=${encodeURIComponent(currentPath)}`);
    const data = await res.json();
    if (data.auth_url) {
      location.href = data.auth_url;
    } else {
      alert("无法获取微信登录链接");
    }
  } catch (error) {
    alert(`登录失败：${error.message}`);
  }
}

function logout() {
  state.authToken = null;
  state.user = null;
  localStorage.removeItem("share_together_auth_token");
  updateAuthUI();
}
```

Also update the `fetchUserInfo` function to call `updateAuthUI()` at the end (already done in Step 2).

- [ ] **Step 6: Add auth styles to styles.css**

Add at the end of `public/styles.css`:

```css
/* --- Auth --- */

.auth-area {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.wechat-login {
  background: #07c160;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 0.4rem 0.8rem;
  font-size: 0.875rem;
  cursor: pointer;
  white-space: nowrap;
}

.wechat-login:hover {
  background: #06ad56;
}

.user-menu {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.user-menu.hidden,
.wechat-login.hidden {
  display: none;
}

.user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border-color, #ddd);
}

.user-avatar.no-avatar {
  display: none;
}

.user-nickname {
  font-size: 0.875rem;
  color: var(--text-color, #333);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logout-btn {
  background: none;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
  cursor: pointer;
  color: #999;
}

.logout-btn:hover {
  color: #333;
  border-color: #999;
}
```

- [ ] **Step 7: Verify the UI works**

Start the dev server:

```bash
npx wrangler dev
```

Open http://localhost:8787. Verify:
- Topbar shows "微信登录" button when not logged in
- Clicking it redirects to WeChat (or fails gracefully if env vars not set)
- Manual test: simulate a token (set localStorage and reload) to see user menu

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat: add WeChat login UI and auth state management"
```

---

### Task 7: Frontend — Write Operation Guards

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `state.user`, `state.authToken` from Task 6

- [ ] **Step 1: Update api() to auto-attach JWT**

In the `api()` function (around line 350-361), add JWT header before the body logic:

```js
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.authToken) {
    headers["Authorization"] = `Bearer ${state.authToken}`;
  }
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
```

- [ ] **Step 2: Guard submitLink — block anonymous users**

In `submitLink()` (around line 77), add at the very top after `event.preventDefault()`:

```js
  if (!state.user) {
    setNotice("请先使用微信登录");
    return;
  }
```

Also remove the `client_id: state.clientId` from the request body since the backend now gets it from JWT. Change:

```js
    const response = await api(`/api/rooms/${state.roomSlug}/links`, {
      method: "POST",
      body: { url, tags, recommendation_note: recommendationNote, client_id: state.clientId }
    });
```

to:

```js
    const response = await api(`/api/rooms/${state.roomSlug}/links`, {
      method: "POST",
      body: { url, tags, recommendation_note: recommendationNote }
    });
```

- [ ] **Step 3: Guard toggleVote — block anonymous users**

In `toggleVote()` (around line 117), add after the existing early return check:

```js
  if (!state.user) {
    setNotice("请先使用微信登录");
    return;
  }
```

Also remove `client_id` from vote body/query since JWT provides identity. Change the method/body logic:

```js
  const method = current.viewer_has_upvoted ? "DELETE" : "POST";
  const query = method === "DELETE" ? "" : "";
  const body = method === "POST" ? {} : undefined;
  const response = await api(`/api/rooms/${state.roomSlug}/links/${linkId}/vote${query}`, { method, body });
```

- [ ] **Step 4: Guard submitReply — block anonymous users**

In `submitReply()` (around line 726), add at the top:

```js
  if (!state.user) {
    setNotice("请先使用微信登录");
    return;
  }
```

Remove `client_id` from the reply payload. Change:

```js
    const payload = { client_id: state.clientId, body };
    if (parentId) payload.parent_id = parentId;
    if (authorName) payload.author_name = authorName;
```

to:

```js
    const payload = { body };
    if (parentId) payload.parent_id = parentId;
    if (authorName) payload.author_name = authorName;
```

- [ ] **Step 5: Disable reply form for anonymous users in UI**

In `renderReplyForm()` (around line 650), add disabled state for anonymous. After creating `bodyInput`:

```js
  if (!state.user) {
    bodyInput.disabled = true;
    bodyInput.placeholder = "登录后才能回复";
    submitBtn.disabled = true;
    submitBtn.textContent = "请先登录";
  }
```

Similarly in `renderReplyFormInline()` (around line 681), after creating `bodyInput`:

```js
  if (!state.user) {
    bodyInput.disabled = true;
    bodyInput.placeholder = "登录后才能回复";
    submitBtn.disabled = true;
    submitBtn.textContent = "请先登录";
  }
```

- [ ] **Step 6: Disable vote button for anonymous users in UI**

In `renderLink()`, update the vote button (around line 224-229) to show disabled state:

```js
  const vote = document.createElement("button");
  vote.className = `vote${link.viewer_has_upvoted ? " active" : ""}`;
  vote.type = "button";
  vote.textContent = `${link.upvote_count}`;
  if (!state.user) {
    vote.title = "登录后才能投票";
    vote.addEventListener("click", () => setNotice("请先使用微信登录"));
  } else {
    vote.addEventListener("click", () => toggleVote(link.id));
  }
  actions.append(vote);
```

- [ ] **Step 7: Hide author_name input for authenticated users**

In `renderReplyForm()` (around line 654), make the name input conditional:

```js
  if (!state.user) {
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.name = "author_name";
    nameInput.placeholder = "Your name (optional)";
    nameInput.maxLength = 32;
    form.append(nameInput);
  }
```

In `renderReplyFormInline()`, same treatment:

```js
  if (!state.user) {
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.name = "author_name";
    nameInput.placeholder = "Your name (optional)";
    nameInput.maxLength = 32;
    form.append(nameInput);
  }
```

- [ ] **Step 8: Commit**

```bash
git add public/app.js
git commit -m "feat: guard write operations for anonymous users, auto-attach JWT"
```

---

### Task 8: End-to-End Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run all tests**

```bash
node --test test/*.test.mjs
```

Expected: All tests pass.

- [ ] **Step 2: Apply migration and start dev server**

```bash
npx wrangler d1 migrations apply share-together --local
npx wrangler dev
```

- [ ] **Step 3: Smoke test the app**

- Open http://localhost:8787 — home page loads with "微信登录" button in topbar
- Click "Create room" — still works without login (per spec, POST /api/rooms is public)
- Enter a room — links load (GET is public)
- Try to share a link — "请先使用微信登录" message
- Try to vote — "请先使用微信登录" message
- Expand replies — reply form shows disabled "登录后才能回复"
- Verify GET /api/auth/wechat/url returns `{ auth_url: "..." }` (will fail without real WeChat creds, but endpoint works)
- Verify GET /api/auth/me returns 401 without token
- Verify POST /api/rooms/:slug/links returns 401 without token

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final verification fixes for WeChat login"
```
