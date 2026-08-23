-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- slug 唯一性从「全局」改为「文集内唯一」：UNIQUE(slug) → UNIQUE(collection_id, slug)
-- SQLite 无法修改约束，需重建表并迁移数据
CREATE TABLE posts_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL,
  summary       TEXT DEFAULT '',
  content_md    TEXT DEFAULT '',
  cover_url     TEXT DEFAULT '',
  status        TEXT DEFAULT 'draft' CHECK (status IN ('draft','published')),
  view_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now')),
  UNIQUE (collection_id, slug)
);

INSERT INTO posts_new (id, collection_id, title, slug, summary, content_md, cover_url, status, view_count, created_at, updated_at)
  SELECT id, collection_id, title, slug, summary, content_md, cover_url, status, view_count, created_at, updated_at FROM posts;

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

CREATE INDEX IF NOT EXISTS idx_posts_collection ON posts(collection_id);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(status, created_at);