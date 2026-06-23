CREATE TABLE IF NOT EXISTS replies (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  parent_id TEXT,
  client_id TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT 'anon',
  body TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (link_id) REFERENCES links(id),
  FOREIGN KEY (parent_id) REFERENCES replies(id)
);

CREATE INDEX IF NOT EXISTS idx_replies_link_thread
  ON replies(link_id, deleted_at, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_replies_parent
  ON replies(parent_id, deleted_at);
