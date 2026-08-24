-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- Phase 1A 回收站：文章软删除
-- 删除 = 置 deleted_at；恢复 = 清空；purge 才硬删。
-- 索引服务于回收站列表查询（deleted_at IS NOT NULL），公开查询过滤 IS NULL 走全表扫描即可。
ALTER TABLE posts ADD COLUMN deleted_at TEXT NULL;
CREATE INDEX idx_posts_trash ON posts(deleted_at) WHERE deleted_at IS NOT NULL;
