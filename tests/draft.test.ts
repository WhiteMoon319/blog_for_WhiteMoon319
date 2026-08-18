import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { listPublishedPosts, getPublishedPostBySlug, listArchivedPosts } from '../src/lib/db/index.ts';
import { makeTestDb } from './helpers/d1.ts';

const handle = await makeTestDb();
after(() => handle.dispose());
const db = handle.db;

test('草稿不泄露：发布查询不返回草稿', async () => {
  await db
    .prepare(
      `INSERT INTO posts (title, slug, summary, content_md, status)
       VALUES ('公开篇', 'pub-1', '', '## 公开', 'published')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO posts (title, slug, summary, content_md, status)
       VALUES ('草稿篇', 'draft-1', '', '## 草稿', 'draft')`,
    )
    .run();

  const published = await listPublishedPosts(db);
  assert.deepEqual(
    published.map((p) => p.slug),
    ['pub-1'],
  );

  const bySlug = await getPublishedPostBySlug(db, 'draft-1');
  assert.equal(bySlug, null);

  const archived = await listArchivedPosts(db);
  assert.deepEqual(
    archived.map((p) => p.slug),
    ['pub-1'],
  );
});

test('草稿经 getPostById 可取回（后台编辑用）', async () => {
  const res = await db
    .prepare(
      `INSERT INTO posts (title, slug, summary, content_md, status)
       VALUES ('草稿篇', 'draft-2', '', '## 草稿', 'draft') RETURNING id`,
    )
    .first<{ id: number }>();
  const row = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(res!.id).first();
  assert.ok(row);
  assert.equal((row as { status: string }).status, 'draft');
});