-- Phase 3B：定时发布（scheduled_at）
-- 统一 ISO 8601 UTC 存储；仅在草稿时有意义，到点由 cron 轮询发布（每 5 分钟）
ALTER TABLE posts ADD COLUMN scheduled_at TEXT;
CREATE INDEX idx_posts_scheduled ON posts(scheduled_at) WHERE scheduled_at IS NOT NULL;