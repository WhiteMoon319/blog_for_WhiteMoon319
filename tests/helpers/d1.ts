// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// 测试用内存数据库
// ============================================================================
//
// 原来用 miniflare 起一个 D1。Node 后端已移除 miniflare，
// 改为直接用 server/d1.mjs 的 NodeD1Database（node:sqlite 内存库）。
//
// 与生产路径一致（同一份兼容层），所以单测覆盖的就是线上真实实现。

import { DatabaseSync } from 'node:sqlite';
import { NodeD1Database } from '../../server/d1.mjs';
import { migrationStatements } from './sql.ts';

export interface TestDbHandle {
  db: NodeD1Database;
  dispose: () => Promise<void>;
}

export async function makeTestDb(): Promise<TestDbHandle> {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = new NodeD1Database(sqlite, 'test-db');

  for (const statement of migrationStatements()) {
    await db.prepare(statement).run();
  }

  return {
    db,
    dispose: async () => {
      db.close();
    },
  };
}
