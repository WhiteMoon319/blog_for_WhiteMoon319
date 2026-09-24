-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later
-- 文集作者化 + 公用/私有 + 协作者：
--   * created_by：文集归属人（归属人即署名作者）
--   * is_public：公用文集任何作者可写入；私有文集仅归属人/协作者/管理员可写入
--   * collection_collaborators：归属人手动拉入的协作者
--   * collection_invites：其他作者申请协作，归属人同意后成为协作者
--
-- 回填口径：既有文集归到库中最早的管理员，并一律设为"公用"，
-- 以免新规则切断历史协作（作者本就可往管理员的文集里投稿）；
-- 若库中无管理员（异常库），created_by 留空，留给后台补配。

ALTER TABLE collections ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE collections ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;

UPDATE collections
   SET created_by = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)
 WHERE created_by IS NULL;

UPDATE collections SET is_public = 1;

CREATE INDEX IF NOT EXISTS idx_collections_created_by ON collections(created_by);

CREATE TABLE IF NOT EXISTS collection_collaborators (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_collaborators_user ON collection_collaborators(user_id);

-- 协作申请：同一 (文集, 用户) 只保留一条记录，重复申请幂等更新 message/时间
CREATE TABLE IF NOT EXISTS collection_invites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  message       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at    TEXT,
  UNIQUE (collection_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_invites_status ON collection_invites(collection_id, status);
CREATE INDEX IF NOT EXISTS idx_collection_invites_user ON collection_invites(user_id, status);
