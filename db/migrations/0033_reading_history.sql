-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 登录用户浏览历史（阅读进度恢复）
CREATE TABLE IF NOT EXISTS reading_history (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scroll_pct INTEGER NOT NULL DEFAULT 0 CHECK (scroll_pct BETWEEN -1 AND 100),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reading_history_user_time ON reading_history (user_id, updated_at DESC);
