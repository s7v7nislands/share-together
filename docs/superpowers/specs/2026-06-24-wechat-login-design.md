# WeChat Login Design

## Overview

Add WeChat Open Platform web login (QR code scan) to Share Together. Anonymous users can browse rooms and links, but posting links, voting, and replying require WeChat login. Logged-in users are identified by their WeChat nickname and avatar.

## Tech Stack Context

- Backend: Cloudflare Workers (vanilla JS, no framework)
- Database: Cloudflare D1 (SQLite)
- Frontend: Vanilla JS SPA, no build tool
- Auth: JWT signed with Web Crypto API (HMAC-SHA256)
- WeChat: Open Platform website application OAuth

## Architecture

```
User clicks "Login with WeChat"
  → GET /api/auth/wechat/url (get auth URL)
  → Redirect to WeChat OAuth (open.weixin.qq.com)
  → User scans QR code, authorizes
  → WeChat redirects to GET /api/auth/wechat/callback?code=xxx&state=yyy
  → Backend exchanges code for access_token + openid
  → Backend upserts user, signs JWT
  → 302 redirect to frontend with #token=<jwt> in URL fragment
  → Frontend stores JWT, uses for authenticated requests
```

## Database Changes

New migration `0006_users.sql`:

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

Existing tables are unchanged. For authenticated users, `links` voting and `replies` use `user.id` instead of anonymous `client_id`. The rate-limit buckets also switch to `user.id` for logged-in users.

## Backend API

### New Endpoints

**`GET /api/auth/wechat/url`**
- Reads optional `return_url` query param
- Generates `state` as a short-lived JWT (5 min exp) containing `{ returnUrl }`
- Returns `{ auth_url: "https://open.weixin.qq.com/connect/qrconnect?...&state=<state-jwt>" }`

**`GET /api/auth/wechat/callback?code=xxx&state=yyy`**
- Verifies the state JWT (signature + expiry check)
- Extracts `returnUrl` from state payload
- Calls WeChat `/sns/oauth2/access_token` → gets `openid`, `access_token`
- Calls WeChat `/sns/userinfo` → gets `nickname`, `headimgurl`
- Upserts into `users` table (on conflict by wechat_openid: update nickname, avatar_url, last_login_at)
- Signs session JWT with payload: `{ sub: user.id, openid, nickname, avatar_url, exp: now + 7 days }`
- 302 redirect to `{returnUrl}#token=<session-jwt>` (default returnUrl is `/`)

**`GET /api/auth/me`** (requires JWT)
- Parses Authorization header, verifies JWT
- Returns `{ id, nickname, avatar_url }`

### JWT Verification

JWT signed with HMAC-SHA256. Web Crypto API native implementation — no external dependencies.

```js
// Sign: header.payload.signature
// Verify: recompute signature, compare, check exp
```

### Endpoint Permission Changes

| Endpoint | Before | After |
|---|---|---|
| All GET endpoints | Public | Public (unchanged) |
| POST room | Public | Public (unchanged) |
| POST link | client_id required | JWT required (uses user.id) |
| POST/DELETE vote | client_id required | JWT required (uses user.id) |
| POST reply | client_id required | JWT required (uses user.id, author_name from WeChat nickname) |
| PATCH room, DELETE link/reply | admin_key required | admin_key required (unchanged) |

### New Environment Variables

```
WECHAT_APP_ID        — WeChat Open Platform AppID
WECHAT_APP_SECRET    — WeChat Open Platform AppSecret
JWT_SECRET           — Random signing key for JWT
```

## Frontend Changes

### State

Add to global `state`:
- `user: null | { id, nickname, avatar_url }`
- `authToken: null | string`

Both persist to localStorage.

### UI

- **Topbar**: Login button (unauthenticated) or avatar + nickname + logout (authenticated)
- **Write buttons** (submit link, vote, reply): visible but blocked with "Please login first" prompt when unauthenticated
- **Reply form**: `author_name` input hidden for authenticated users (auto-filled from WeChat nickname)

### API Helper

`api()` function auto-attaches `Authorization: Bearer <token>` header when `state.authToken` exists.

### OAuth Callback Handling

On page load, check `location.hash` for `#token=<jwt>`:
- Found: store token, call `/api/auth/me` for user info, clean URL
- Not found: restore from localStorage, call `/api/auth/me` to verify

## WeChat Open Platform Configuration

Before deploying, the following must be configured in the WeChat Open Platform dashboard (open.weixin.qq.com):
- Register a "Website Application" (网站应用)
- Set the OAuth redirect URI to `https://<domain>/api/auth/wechat/callback`
- Obtain AppID and AppSecret, configure as env vars

## Error Handling

- WeChat API failures → show user-friendly error, redirect to home
- JWT expired → clear stored token, prompt re-login
- JWT invalid/tampered → clear token, reject request
- State mismatch → 400 error, redirect to home

## Testing

- Unit tests for JWT sign/verify
- Integration tests for auth endpoints
- Manual testing: WeChat OAuth flow requires real AppID (can test with mock in dev)
