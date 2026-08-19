-- Phase 3A：文章置顶（is_pinned）
-- 首页置顶区查询：WHERE deleted_at IS NULL AND is_pinned = 1 ORDER BY created_at DESC, id DESC LIMIT N
-- 等值前缀（deleted_at、is_pinned）+ created_at 倒序范围，正好命中该索引
ALTER TABLE posts ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_posts_pinned ON posts(deleted_at, is_pinned, created_at DESC);