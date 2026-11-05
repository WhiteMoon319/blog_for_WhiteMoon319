// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// 迁移执行器：把 db/migrations/*.sql 应用到本地 SQLite
// ============================================================================
//
// 原项目用 `wrangler d1 migrations apply`，D1 自己在 _cf_KV 里记录已应用版本。
// Node 后端要自己实现等价功能，用一张 d1_migrations 表记住已应用的迁移，
// 语义与 D1 保持一致（按文件名字典序、每个文件一个事务、失败即停）。
//
// 已应用的迁移不会重复执行，所以这个脚本可以幂等运行。

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'db', 'migrations');

/** D1 用这张表记录已应用迁移，这里保持一致以便将来回溯/导出 */
const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE NOT NULL,
  applied_at TEXT DEFAULT (datetime('now'))
);
`;

/**
 * 列出迁移文件（按文件名升序，与 D1 一致）
 * @returns {string[]}
 */
function listMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) {
    throw new Error(`迁移目录不存在：${MIGRATIONS_DIR}`);
  }
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * 执行全部未应用的迁移。
 *
 * @param {DatabaseSync} sqlite 已打开的连接
 * @param {{ verbose?: boolean }} [options]
 * @returns {{ applied: string[], skipped: number }}
 */
export function runMigrations(sqlite, options = {}) {
  const verbose = options.verbose ?? false;
  sqlite.exec(MIGRATIONS_TABLE);

  const applied = new Set(
    sqlite
      .prepare('SELECT name FROM d1_migrations')
      .all()
      .map((r) => r.name),
  );

  const files = listMigrations();
  const newlyApplied = [];
  let skipped = 0;

  for (const file of files) {
    if (applied.has(file)) {
      skipped += 1;
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    if (verbose) console.log(`[migrate] 应用 ${file}`);

    // 每个迁移文件一个事务：失败整文件回滚，不会留下半截 schema
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(sql);
      sqlite.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(file);
      sqlite.exec('COMMIT');
      newlyApplied.push(file);
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // 回滚失败不掩盖原始错误
      }
      throw new Error(`迁移 ${file} 失败：${err.message}`, { cause: err });
    }
  }

  return { applied: newlyApplied, skipped };
}

/**
 * 计算迁移目录的指纹，用于判断 schema 是否过期。
 * @returns {string}
 */
export function migrationsFingerprint() {
  const h = createHash('sha256');
  for (const file of listMigrations()) {
    h.update(file);
    h.update(readFileSync(join(MIGRATIONS_DIR, file)));
  }
  return h.digest('hex').slice(0, 16);
}

// ---- CLI：node server/migrate.mjs [--verbose] ----
if (import.meta.filename === process.argv[1]) {
  const dbPath = process.env.BLOG_DB_PATH ?? join(ROOT, 'data', 'blog.db');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(ROOT, 'data'), { recursive: true });

  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');

  try {
    const result = runMigrations(sqlite, { verbose: process.argv.includes('--verbose') });
    console.log(`[migrate] 完成：新应用 ${result.applied.length} 个，跳过 ${result.skipped} 个`);
    if (result.applied.length > 0) {
      for (const f of result.applied) console.log(`  + ${f}`);
    }
  } catch (err) {
    console.error('[migrate] 失败：', err.message);
    process.exitCode = 1;
  } finally {
    sqlite.close();
  }
}

export { MIGRATIONS_DIR };
