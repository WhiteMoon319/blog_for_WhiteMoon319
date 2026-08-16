-- 登录限流：以 D1 原子单语句 upsert 实现计数（取代 KV 的非原子 get→put）。
-- 并发请求由 SQLite 写事务串行化，不会丢失计数更新。
CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  window_end   INTEGER NOT NULL
);
