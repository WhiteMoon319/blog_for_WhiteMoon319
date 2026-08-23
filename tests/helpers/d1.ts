// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Miniflare } from 'miniflare';
import { migrationStatements } from './sql.ts';

export interface TestDbHandle {
  db: D1Database;
  dispose: () => Promise<void>;
}

export async function makeTestDb(): Promise<TestDbHandle> {
  const mf = new Miniflare({
    workers: [
      {
        config: {
          type: 'worker',
          name: 'test-worker',
          compatibilityDate: '2025-08-01',
          manifest: {
            mainModule: 'index.mjs',
            modules: {
              'index.mjs': { type: 'esm', contents: 'export default { fetch() {} }' },
            },
          },
          env: { DB: { type: 'd1', id: 'test-db' } },
        },
      },
    ],
  });
  const db = await mf.getD1Database('DB');
  for (const statement of migrationStatements()) {
    await db.prepare(statement).run();
  }
  return { db, dispose: () => mf.dispose() };
}
