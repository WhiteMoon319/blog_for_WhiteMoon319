-- 标签系统：tags + collection_tags（文集标签）+ post_tags（文章自有标签）
-- 文章有效标签 = 文集标签 ∪ 自身标签（查询时计算，不落地复制，避免同步漂移）
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,      -- 中文可直接作为 URL 段
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_tags (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, tag_id)
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_tags_tag ON collection_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id);