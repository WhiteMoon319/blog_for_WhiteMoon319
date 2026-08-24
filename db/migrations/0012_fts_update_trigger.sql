-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 全文索引更新触发器重构：WHEN 子句限定仅 title/summary/content_md 变化才同步 FTS。
-- 此前 view_count 每次自增都会触发 delete+rebuild 两写，属写放大；阅读量不在检索列中，无需重建。
DROP TRIGGER IF EXISTS posts_fts_au;

CREATE TRIGGER posts_fts_au AFTER UPDATE ON posts
WHEN old.title IS NOT new.title
  OR old.summary IS NOT new.summary
  OR old.content_md IS NOT new.content_md
BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, summary, content_md)
  VALUES ('delete', old.id, old.title, old.summary, old.content_md);
  INSERT INTO posts_fts(rowid, title, summary, content_md)
  VALUES (new.id, new.title, new.summary, new.content_md);
END;
