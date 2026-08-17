import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// 按语句拆分迁移 SQL：触发器（BEGIN…END）体内含分号，需跟踪深度，不能简单按 ; 切
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let depth = 0;
  for (const line of sql.split(/\r?\n/)) {
    if (/^\s*--/.test(line) || line.trim() === '') continue;
    current += `${line}\n`;
    depth += (line.match(/\bBEGIN\b/gi) ?? []).length - (line.match(/\bEND\b/gi) ?? []).length;
    if (depth <= 0 && current.includes(';')) {
      statements.push(current.trim().replace(/;\s*$/, ''));
      current = '';
      depth = 0;
    }
  }
  if (current.trim()) statements.push(current.trim().replace(/;\s*$/, ''));
  return statements;
}

const MIGRATION_STATEMENTS = readdirSync(resolve('db/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .flatMap((file) => splitStatements(readFileSync(resolve('db/migrations', file), 'utf8')));

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