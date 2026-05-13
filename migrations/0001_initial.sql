CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  admin_key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  image_url TEXT,
  source_host TEXT NOT NULL,
  metadata_status TEXT NOT NULL,
  upvote_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_links_room_canonical
  ON links(room_id, canonical_url);

CREATE INDEX IF NOT EXISTS idx_links_room_newest
  ON links(room_id, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_links_room_hot
  ON links(room_id, deleted_at, upvote_count DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (link_id) REFERENCES links(id),
  UNIQUE(link_id, voter_id)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
