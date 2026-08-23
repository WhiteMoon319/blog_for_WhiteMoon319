-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 快速查找最近全量快照：latestFullVersion 查询 (post_id, base_version IS NULL, version DESC)
CREATE INDEX idx_post_versions_base ON post_versions(post_id, base_version, version DESC);