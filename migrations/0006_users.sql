CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wechat_openid TEXT NOT NULL UNIQUE,
  wechat_unionid TEXT,
  nickname TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);
