-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 全文搜索：FTS5 外部内容表（trigram 分词，支持中文任意子串），触发器同步，替换 LIKE 全表扫
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title,
  summary,
  content_md,
  content='posts',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, summary, content_md)
  VALUES (new.id, new.title, new.summary, new.content_md);
END;

CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, summary, content_md)
  VALUES ('delete', old.id, old.title, old.summary, old.content_md);
END;

CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, summary, content_md)
  VALUES ('delete', old.id, old.title, old.summary, old.content_md);
  INSERT INTO posts_fts(rowid, title, summary, content_md)
  VALUES (new.id, new.title, new.summary, new.content_md);
END;

INSERT INTO posts_fts(posts_fts) VALUES('rebuild');