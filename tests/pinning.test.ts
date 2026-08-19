import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, type TestDbHandle } from './helpers/d1.ts';
import {
  createPostWithTags,
  listPublishedPosts,
  updatePostWithTags,
  setPostsPinned,
  trashPosts,
} from '../src/lib/db/posts.ts';
import { getLatestPostVersion } from '../src/lib/db/versions.ts';
import { getPostById } from '../src/lib/db/index.ts';

let h: TestDbHandle;

before(async () => {
  h = await makeTestDb();
});

after(async () => {
  await h.dispose();
});

test('置顶：创建时可置顶，置顶查询只返回置顶文章', async () => {
  const a = await createPostWithTags(h.db, {
    title: '置顶甲',
    slug: 'pin-a',
    status: 'published',
    is_pinned: 1,
  }, []);
  const b = await createPostWithTags(h.db, {
    title: '未置顶乙',
    slug: 'pin-b',
    status: 'published',
    is_pinned: 0,
  }, []);
  assert.ok(a && b, '创建应成功');
  assert.equal(a.post.is_pinned, 1);

  const pinned = await listPublishedPosts(h.db, { pinned: true });
  assert.deepEqual(pinned.map((p) => p.slug), ['pin-a'], '仅返回置顶文章');
  const all = await listPublishedPosts(h.db);
  assert.equal(all.length, 2, '置顶不影响普通列表（不隐藏）');
});

test('置顶：更新切换 is_pinned 生效并留版', async () => {
  const created = await createPostWithTags(h.db, { title: '切换', slug: 'pin-toggle', status: 'published' }, []);
  assert.ok(created);
  const v0 = await getLatestPostVersion(h.db, created.post.id);
  const updated = await updatePostWithTags(h.db, created.post.id, { is_pinned: 1 }, null, '置顶', v0);
  assert.ok(updated && updated !== 'conflict');
  assert.equal(updated.post.is_pinned, 1);
  assert.equal(await getLatestPostVersion(h.db, created.post.id), v0 + 1, '置顶变更应留版本');
});

test('置顶：批量置顶幂等，回收站文章不参与', async () => {
  const created = await createPostWithTags(h.db, { title: '批量', slug: 'pin-batch', status: 'published' }, []);
  assert.ok(created);
  const { post } = created;

  assert.equal(await setPostsPinned(h.db, [post.id], true), 1, '首次置顶计数 1');
  assert.equal(await setPostsPinned(h.db, [post.id], true), 0, '重复置顶幂等');
  assert.equal((await getPostById(h.db, post.id))?.is_pinned, 1);

  await trashPosts(h.db, [post.id]);
  assert.equal(await setPostsPinned(h.db, [post.id], false), 0, '回收站文章不参与取消置顶');
  const trashed = await h.db
    .prepare('SELECT is_pinned FROM posts WHERE id = ?')
    .bind(post.id)
    .first<{ is_pinned: number }>();
  assert.equal(trashed?.is_pinned, 1, '回收站文章置顶状态保留');
});

test('置顶：取消置顶幂等', async () => {
  const created = await createPostWithTags(h.db, { title: '取消', slug: 'pin-off', status: 'published', is_pinned: 1 }, []);
  assert.ok(created);
  assert.equal(await setPostsPinned(h.db, [created.post.id], false), 1);
  assert.equal(await setPostsPinned(h.db, [created.post.id], false), 0);
  assert.equal((await getPostById(h.db, created.post.id))?.is_pinned, 0);
});