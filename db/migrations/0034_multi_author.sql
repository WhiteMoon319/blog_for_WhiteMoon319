-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 多作者体系：文章署名关联表、文章归属人、作者简介、版本署名快照
--
-- 设计要点：
--   post_authors 记录对外署名（有序，第一位为主作者），posts.created_by 记录归属人（决定编辑权），两者解耦。
--   作者身份复用统一 users 表，不新建作者表。

CREATE TABLE IF NOT EXISTS post_authors (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_authors_user ON post_authors(user_id, sort_order);

ALTER TABLE posts ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
-- 署名快照：版本回滚时按此恢复署名；历史版本留空数组（空数组视为"不覆盖"，保留当前署名）
ALTER TABLE post_versions ADD COLUMN authors TEXT NOT NULL DEFAULT '[]';

-- 回填既有文章归属与署名：统一落到库中最早的管理员名下（0027 已保证存在）
UPDATE posts
SET created_by = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)
WHERE created_by IS NULL;

INSERT OR IGNORE INTO post_authors (post_id, user_id, sort_order)
SELECT id, created_by, 0 FROM posts WHERE created_by IS NOT NULL;
