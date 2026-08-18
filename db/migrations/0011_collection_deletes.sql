-- 文集删除账本：大批量成员迁移（转未分类 + slug 重排 + 版本留档）的进度标记。
-- 每批成员迁移与游标前进同事务提交；进程中途失败后重试删除时，
-- 未迁移成员仍挂在文集下（已迁移者以新 slug 进入占用集），可从当前状态幂等续跑。
CREATE TABLE IF NOT EXISTS collection_deletes (
  collection_id INTEGER PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
  migrated_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
