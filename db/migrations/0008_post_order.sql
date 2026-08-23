-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 文集内文章排序方向：'asc' 旧在前（小说连载顺读），'desc' 新在前（博客默认）
ALTER TABLE collections ADD COLUMN post_order TEXT NOT NULL DEFAULT 'desc';