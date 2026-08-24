-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, message)
SELECT id, 1, title, slug, collection_id, summary, content_md, cover_url, status, '创建'
FROM posts
WHERE id NOT IN (SELECT DISTINCT post_id FROM post_versions);