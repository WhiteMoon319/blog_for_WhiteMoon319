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
