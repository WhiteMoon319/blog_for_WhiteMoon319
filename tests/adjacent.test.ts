import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { getAdjacentPosts, type PostRow } from '../src/lib/db.ts';
import { makeTestDb } from './helpers/d1.ts';

const handle = await makeTestDb();
after(() => handle.dispose());
const db = handle.db;

async function insert(db: D1Database, title: string, createdAt: string): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO posts (title, slug, summary, content_md, status, created_at, updated_at)
       VALUES (?, ?, '', '', 'published', ?, ?) RETURNING id`,
    )
    .bind(title, title.toLowerCase().replace(/\s+/g, '-'), createdAt, createdAt)
    .first<{ id: number }>();
  return res!.id;
}

test('同秒文章：prev/next 以 id 决胜序', async () => {
  const t = '2026-01-01 00:00:00';
  const a = await insert(db, '第一篇', t);
  const b = await insert(db, '第二篇', t);
  const c = await insert(db, '第三篇', t);

  const mid = (await db.prepare('SELECT * FROM posts WHERE id = ?').bind(b).first<PostRow>())!;
  const { prev, next } = await getAdjacentPosts(db, mid);

  assert.ok(prev, '应存在上一篇');
  assert.ok(next, '应存在下一篇');
  assert.equal(prev.id, a);
  assert.equal(next.id, c);

  const first = (await db.prepare('SELECT * FROM posts WHERE id = ?').bind(a).first<PostRow>())!;
  const { prev: p0 } = await getAdjacentPosts(db, first);
  assert.equal(p0, null);
});