-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- Phase 2：文章自定义 SEO 关键词（meta_keywords）
-- 纯展示字段，无查询索引需求（关键词检索走搜索页，不针对该列建索引）
ALTER TABLE posts ADD COLUMN meta_keywords TEXT NOT NULL DEFAULT '';
-- 版本快照同步收录关键词，回滚时一并恢复，避免「只改关键词也留版」却不完整
ALTER TABLE post_versions ADD COLUMN meta_keywords TEXT NOT NULL DEFAULT '';