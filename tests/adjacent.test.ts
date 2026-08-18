import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { getAdjacentPosts, type PostRow } from '../src/lib/db/index.ts';
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

async function insertIn(db: D1Database, title: string, createdAt: string, collectionId: number | null): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO posts (collection_id, title, slug, summary, content_md, status, created_at, updated_at)
       VALUES (?, ?, ?, '', '', 'published', ?, ?) RETURNING id`,
    )
    .bind(collectionId, title, title.toLowerCase().replace(/\s+/g, '-'), createdAt, createdAt)
    .first<{ id: number }>();
  return res!.id;
}

test('相邻文章：文集内优先，组内没有才跨文集回退', async () => {
  const col = await db
    .prepare(`INSERT INTO collections (title, slug, summary, theme_color, sort_order) VALUES ('A 集', 'col-a', '', '#c23a30', 1) RETURNING id`)
    .first<{ id: number }>();
  const colId = col!.id;
  const colT = await db
    .prepare(`INSERT INTO collections (title, slug, summary, theme_color, sort_order) VALUES ('T 集', 'col-t', '', '#c23a30', 2) RETURNING id`)
    .first<{ id: number }>();
  const colTId = colT!.id;
  // 时间线：A1(t1) < A2(t2) < T(t3, 另一文集) < A3(t4)
  const a1 = await insertIn(db, 'A 一', '2026-02-01 00:00:00', colId);
  const a2 = await insertIn(db, 'A 二', '2026-02-02 00:00:00', colId);
  const t = await insertIn(db, 'T 他组', '2026-02-03 00:00:00', colTId);
  const a3 = await insertIn(db, 'A 三', '2026-02-04 00:00:00', colId);

  const get = async (id: number) => (await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>())!;

  const { prev: pA2, next: nA2 } = await getAdjacentPosts(db, await get(a2));
  assert.equal(pA2?.id, a1, 'A2 的上一篇应为同文集 A1');
  assert.equal(nA2?.id, a3, 'A2 的下一篇应为同文集 A3，而非时间上更近的 T');

  const { prev: pT, next: nT } = await getAdjacentPosts(db, await get(t));
  assert.equal(pT?.id, a2, 'T 所在组无其他文章，应回退为 A2');
  assert.equal(nT?.id, a3, 'T 所在组无其他文章，应回退为 A3');
});

test('相邻文章：未分类自成一组（collection_id 为 NULL）', async () => {
  const col = await db
    .prepare(`INSERT INTO collections (title, slug, summary, theme_color, sort_order) VALUES ('E 集', 'col-e', '', '#c23a30', 2) RETURNING id`)
    .first<{ id: number }>();
  const colId = col!.id;
  // 时间线：U1(t1, 未分类) < E1(t2, E 集) < U2(t3, 未分类) < E2(t4, E 集)
  const u1 = await insertIn(db, 'U 一', '2026-03-01 00:00:00', null);
  const e1 = await insertIn(db, 'E 一', '2026-03-02 00:00:00', colId);
  const u2 = await insertIn(db, 'U 二', '2026-03-03 00:00:00', null);
  const e2 = await insertIn(db, 'E 二', '2026-03-04 00:00:00', colId);

  const get = async (id: number) => (await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>())!;

  const { prev: pU2, next: nU2 } = await getAdjacentPosts(db, await get(u2));
  assert.equal(pU2?.id, u1, 'U2 的上一篇应为未分类 U1，而非更近的 E1');
  assert.equal(nU2?.id, e2, 'U2 之后无未分类文章，应回退为 E2');
});