import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_STATEMENTS = readFileSync(resolve('db/migrations/0001_init.sql'), 'utf8')
  .split('\n')
  .filter((line) => !/^\s*--/.test(line) && line.trim() !== '')
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

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
  for (const statement of MIGRATION_STATEMENTS) {
    await db.prepare(statement).run();
  }
  return { db, dispose: () => mf.dispose() };
}