-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 本地 D1 整库重置（仅供 pnpm run cf:db:local 可重入使用）
-- 先删触发器与表，再清空 wrangler 的迁移记录表，随后可重新执行 migrations + seed
DROP TABLE IF EXISTS d1_migrations;
DROP TABLE IF EXISTS posts_fts;
DROP TABLE IF EXISTS post_versions;
DROP TABLE IF EXISTS post_tags;
DROP TABLE IF EXISTS collection_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS collections;
