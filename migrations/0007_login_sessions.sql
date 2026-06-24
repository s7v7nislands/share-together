CREATE TABLE IF NOT EXISTS login_sessions (
  poll_id TEXT PRIMARY KEY,
  verify_code TEXT NOT NULL,
  session_jwt TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
