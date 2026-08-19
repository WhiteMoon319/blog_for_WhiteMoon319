import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, type TestDbHandle } from './helpers/d1.ts';
import {
  createPostWithTags,
  listPublishedPosts,
  updatePostWithTags,
  updatePost,
  trashPosts,
} from '../src/lib/db/posts.ts';
import { publishDuePosts } from '../src/lib/db/scheduling.ts';
import { listPostVersions } from '../src/lib/db/versions.ts';

let h: TestDbHandle;

before(async () => {
  h = await makeTestDb();
});

after(async () => {
  await h.dispose();
});

const PAST = new Date(Date.now() - 3600_000).toISOString();
const FUTURE = new Date(Date.now() + 3600_000).toISOString();

test('定时：到期草稿被刊发，写入「定时刊发」版本并清空定时', async () => {
  const a = await createPostWithTags(h.db, {
    title: '定时甲',
    slug: 'sched-a',
    status: 'draft',
    scheduled_at: PAST,
  }, []);
  const b = await createPostWithTags(h.db, {
    title: '未定时乙',
    slug: 'sched-b',
    status: 'draft',
  }, []);
  assert.ok(a && b);

  const v0a = await listPostVersions(h.db, a.post.id);
  const result = await publishDuePosts(h.db, new Date());
  assert.deepEqual(result.ids, [a.post.id]);
  assert.equal(result.published, 1);

  const post = await h.db
    .prepare('SELECT status, scheduled_at FROM posts WHERE id = ?')
    .bind(a.post.id)
    .first<{ status: string; scheduled_at: string | null }>();
  assert.equal(post?.status, 'published');
  assert.equal(post?.scheduled_at, null, '刊发后定时值被清空');

  const versions = await listPostVersions(h.db, a.post.id);
  assert.equal(versions.length, v0a.length + 1, '刊发应留一条版本');
  assert.equal(versions[0]?.message, '定时刊发');
  assert.equal(versions[0]?.status, 'published');

  const bRow = await h.db
    .prepare('SELECT status FROM posts WHERE id = ?')
    .bind(b.post.id)
    .first<{ status: string }>();
  assert.equal(bRow?.status, 'draft', '未定时草稿不受影响');
});

test('定时：未来的定时不刊发，幂等（重复触发不重复留版）', async () => {
  const created = await createPostWithTags(h.db, {
    title: '定时丙',
    slug: 'sched-c',
    status: 'draft',
    scheduled_at: FUTURE,
  }, []);
  assert.ok(created);

  const r1 = await publishDuePosts(h.db, new Date());
  assert.equal(r1.published, 0, '未来定时不应刊发');

  const later = new Date(Date.now() + 2 * 3600_000);
  const r2 = await publishDuePosts(h.db, later);
  assert.equal(r2.published, 1, '越过时间点后应刊发');

  const r3 = await publishDuePosts(h.db, later);
  assert.equal(r3.published, 0, '重复触发幂等');
  const versions = await listPostVersions(h.db, created.post.id);
  assert.equal(versions.filter((v) => v.message === '定时刊发').length, 1, '只留一条定时刊发版本');
});

test('定时：回收站与非草稿不刊发', async () => {
  const trashed = await createPostWithTags(h.db, {
    title: '定时丁',
    slug: 'sched-d',
    status: 'draft',
    scheduled_at: PAST,
  }, []);
  const published = await createPostWithTags(h.db, {
    title: '定时戊',
    slug: 'sched-e',
    status: 'published',
    scheduled_at: PAST,
  }, []);
  assert.ok(trashed && published);
  await trashPosts(h.db, [trashed.post.id]);

  const result = await publishDuePosts(h.db, new Date());
  assert.deepEqual(result.ids, [], '回收站与已刊文章都不参与');

  const tRow = await h.db
    .prepare('SELECT status FROM posts WHERE id = ?')
    .bind(trashed.post.id)
    .first<{ status: string }>();
  assert.equal(tRow?.status, 'draft', '回收站文章状态不变');
});

test('定时：手动刊发清空 scheduled_at；改回草稿可重设定时', async () => {
  const created = await createPostWithTags(h.db, {
    title: '定时己',
    slug: 'sched-f',
    status: 'draft',
    scheduled_at: FUTURE,
  }, []);
  assert.ok(created);

  const updated = await updatePostWithTags(h.db, created.post.id, { status: 'published' }, null, '手动刊发', undefined);
  assert.ok(updated && updated !== 'conflict');
  const pRow = await h.db
    .prepare('SELECT scheduled_at FROM posts WHERE id = ?')
    .bind(created.post.id)
    .first<{ scheduled_at: string | null }>();
  assert.equal(pRow?.scheduled_at, null, '手动刊发应清空定时');

  await updatePostWithTags(h.db, created.post.id, { status: 'draft', scheduled_at: FUTURE }, null, '存回草稿', undefined);
  const dRow = await h.db
    .prepare('SELECT scheduled_at, status FROM posts WHERE id = ?')
    .bind(created.post.id)
    .first<{ scheduled_at: string | null; status: string }>();
  assert.equal(dRow?.status, 'draft');
  assert.equal(dRow?.scheduled_at, FUTURE, '草稿可重设定时');

  const viaUpdate = await updatePost(h.db, created.post.id, { scheduled_at: null }, undefined);
  assert.ok(viaUpdate && viaUpdate !== 'conflict');
  assert.equal(viaUpdate.scheduled_at, null, 'updatePost 显式传 null 可取消定时');
});

test('定时：上限 50 篇每轮', async () => {
  const ids: number[] = [];
  for (let i = 0; i < 55; i++) {
    const created = await createPostWithTags(h.db, {
      title: `定时批量${i}`,
      slug: `sched-batch-${i}`,
      status: 'draft',
      scheduled_at: PAST,
    }, []);
    assert.ok(created);
    ids.push(created.post.id);
  }
  const r1 = await publishDuePosts(h.db, new Date());
  assert.equal(r1.published, 50, '第一轮最多 50 篇');
  const r2 = await publishDuePosts(h.db, new Date());
  assert.equal(r2.published, 5, '剩余 5 篇下一轮刊发');
  const remain = await h.db
    .prepare("SELECT COUNT(*) AS n FROM posts WHERE scheduled_at IS NOT NULL AND status = 'draft' AND deleted_at IS NULL")
    .first<{ n: number }>();
  assert.equal(remain?.n, 0);
  const published = await listPublishedPosts(h.db);
  assert.ok(published.some((p) => p.slug === 'sched-batch-54'), '末篇已刊发');
});