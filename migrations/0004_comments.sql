-- Migration 0004: Add comments table for link discussions
-- Supports: top-level comments, nested replies (via parent_id), attachments (images/markdown)

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  parent_id TEXT,                   -- NULL = top-level comment; non-NULL = reply to another comment
  author_id TEXT NOT NULL,          -- anonymous client_id (UUID stored in browser localStorage)
  content TEXT NOT NULL,            -- comment body (plain text or Markdown)
  attachments TEXT NOT NULL DEFAULT '[]',  -- JSON array: [{type:'image'|'markdown', name:string, content:string}]
  created_at TEXT NOT NULL,
  deleted_at TEXT,                  -- soft delete
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (link_id) REFERENCES links(id),
  FOREIGN KEY (parent_id) REFERENCES comments(id)
);

CREATE INDEX IF NOT EXISTS idx_comments_link
  ON comments(link_id, deleted_at, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments(parent_id, deleted_at, created_at ASC);
