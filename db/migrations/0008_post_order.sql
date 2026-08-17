-- 文集内文章排序方向：'asc' 旧在前（小说连载顺读），'desc' 新在前（博客默认）
ALTER TABLE collections ADD COLUMN post_order TEXT NOT NULL DEFAULT 'desc';