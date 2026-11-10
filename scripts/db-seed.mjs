// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// 种子数据执行器
// ============================================================================
//
// 把 db/seed.sql 灌进数据库（示例文集 / 文章 / 管理员账号）。
// 只在初始化本地开发环境时用；生产导入请走 server/cf-import.mjs。
//
// 与 applyDump 一样不包事务：seed.sql 自身如果带 BEGIN/COMMIT 会冲突，
// 这里检测一下，没有才补一个外层事务。

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * 执行 seed.sql
 *
 * @param {DatabaseSync} sqlite
 * @param {{ verbose?: boolean }} [options]
 */
export function runSeed(sqlite, options = {}) {
  const seedPath = join(ROOT, 'db', 'seed.sql');
  if (!existsSync(seedPath)) {
    return { skipped: true, reason: 'db/seed.sql 不存在' };
  }

  const sql = readFileSync(seedPath, 'utf8');
  if (!sql.trim()) return { skipped: true, reason: 'seed.sql 为空' };

  // seed.sql 自己带事务时不要再套，否则 SQLite 报 "transaction within a transaction"
  const hasOwnTransaction = /\bBEGIN\b/i.test(sql);

  if (hasOwnTransaction) {
    sqlite.exec(sql);
  } else {
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(sql);
      sqlite.exec('COMMIT');
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // 回滚失败不掩盖原始错误
      }
      throw err;
    }
  }

  if (options.verbose) console.log('[seed] 已执行 db/seed.sql');
  return { skipped: false };
}

// ---- CLI：node scripts/db-seed.mjs ----
if (import.meta.filename === process.argv[1]) {
  const dbPath = process.env.BLOG_DB_PATH ?? join(ROOT, 'data', 'blog.db');
  if (!existsSync(dbPath)) {
    console.error(`数据库不存在：${dbPath}\n请先运行 node server/migrate.mjs`);
    process.exit(1);
  }
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  try {
    const res = runSeed(sqlite, { verbose: true });
    if (res.skipped) console.log(`[seed] 跳过：${res.reason}`);
    else console.log('[seed] 完成');
  } catch (err) {
    console.error('[seed] 失败：', err.message);
    process.exitCode = 1;
  } finally {
    sqlite.close();
  }
}
