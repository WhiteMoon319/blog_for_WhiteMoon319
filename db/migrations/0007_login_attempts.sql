-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 登录限流：以 D1 原子单语句 upsert 实现计数（取代 KV 的非原子 get→put）。
-- 并发请求由 SQLite 写事务串行化，不会丢失计数更新。
CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  window_end   INTEGER NOT NULL
);
