-- Users: manual username + password accounts
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Sessions: opaque bearer tokens, SHA-256 hashed
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

-- Room membership: user must be a member to view/participate
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Join requests: pending approval by room owner
CREATE TABLE IF NOT EXISTS room_join_requests (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_pending
  ON room_join_requests(room_id, user_id) WHERE status = 'pending';

-- Existing tables: add user_id for attribution (nullable for old data)
ALTER TABLE rooms ADD COLUMN owner_id TEXT REFERENCES users(id);
ALTER TABLE links ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE votes ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE replies ADD COLUMN user_id TEXT REFERENCES users(id);
