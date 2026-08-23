-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- =============================================
-- 博客表结构 v1
-- 文集 / 文章
-- =============================================

-- 文集（合集）
CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,            -- 文集名
  slug        TEXT UNIQUE NOT NULL,     -- URL 标识
  summary     TEXT DEFAULT '',          -- 简介
  theme_color TEXT DEFAULT '#c23a30',   -- 主题色 --pc
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- 文章
CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  summary       TEXT DEFAULT '',        -- 摘要（列表卡显示）
  content_md    TEXT DEFAULT '',        -- Markdown 源文
  cover_url     TEXT DEFAULT '',        -- R2 封面
  status        TEXT DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_collection ON posts(collection_id);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(status, created_at);