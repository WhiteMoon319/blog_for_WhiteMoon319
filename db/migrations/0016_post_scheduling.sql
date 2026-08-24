-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- Phase 3B：定时发布（scheduled_at）
-- 统一 ISO 8601 UTC 存储；仅在草稿时有意义，到点由 cron 轮询发布（每 5 分钟）
ALTER TABLE posts ADD COLUMN scheduled_at TEXT;
CREATE INDEX idx_posts_scheduled ON posts(scheduled_at) WHERE scheduled_at IS NOT NULL;