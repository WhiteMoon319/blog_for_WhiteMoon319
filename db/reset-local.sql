-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 本地 D1 整库重置（仅供 pnpm run cf:db:local 可重入使用）
-- 先删触发器与表，再清空 wrangler 的迁移记录表，随后可重新执行 migrations + seed
-- 注意：删除顺序必须按外键约束从依赖到被依赖
DROP TABLE IF EXISTS d1_migrations;
DROP TABLE IF EXISTS email_verifications;
DROP TABLE IF EXISTS comment_likes;
DROP TABLE IF EXISTS post_likes;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS posts_fts;
DROP TABLE IF EXISTS post_versions;
DROP TABLE IF EXISTS post_tags;
DROP TABLE IF EXISTS collection_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS collection_deletes;
DROP TABLE IF EXISTS daily_view_ips;
DROP TABLE IF EXISTS daily_views;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS ai_credentials;
DROP TABLE IF EXISTS pages;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS admin_credentials;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS collections;