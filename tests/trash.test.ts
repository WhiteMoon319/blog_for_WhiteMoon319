// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPostWithTags,
  createCollection,
  trashPosts,
  restorePosts,
  purgePosts,
  getPostById,
  getPublishedPostBySlug,
  getPublishedPostBySlugAny,
  getPublishedPostInCollection,
  listPublishedPosts,
  countPublishedPosts,
  listArchivedPosts,
  countArchivedPosts,
  listPosts,
  listPostVersions,
  listPostOwnTags,
  listAllTagCounts,
  getTagsUnion,
  getAdjacentPosts,
  incrementViewCount,
  searchPublishedPosts,
  getCollectionById,
} from '../src/lib/db/index.ts';
import { makeTestDb } from './helpers/d1.ts';

const handle = await makeTestDb();
after(() => handle.dispose());
const db = handle.db;

async function seedPublished(slug: string, title = slug) {
  const r = await createPostWithTags(db, {
    collection_id: null,
    title,
    slug,
    summary: `${title} 摘要`,
    content_md: `${title} 正文内容`,
    status: 'published',
  }, ['甲', '乙']);
  assert.ok(r, `seed ${slug} 创建失败`);
  return r;
}

test('回收站：trash 后公开全链路不可见', async () => {
  const { post } = await seedPublished('trash-hidden');
  await trashPosts(db, [post.id]);

  assert.equal(await getPostById(db, post.id), null, 'getPostById 应 404');
  assert.equal(await getPublishedPostBySlug(db, post.slug), null, '未分类按 slug 应 404');
  assert.equal(await getPublishedPostBySlugAny(db, post.slug), null, '任意文集按 slug 应 404');
  assert.equal(await listPublishedPosts(db, {}).then((r) => r.length), 0, '首页列表应不含');
  assert.equal(await countPublishedPosts(db), 0, '计数应不含');
  assert.equal(await countArchivedPosts(db), 0, '归档计数应不含');
  assert.equal((await listArchivedPosts(db, { limit: 10 })).length, 0, '归档列表应不含');
  assert.equal((await listPosts(db, { status: 'all' })).length, 0, 'status=all 应不含回收站');
  assert.equal((await listPosts(db, { trashOnly: true })).length, 1, '回收站视图应含 1 篇');
  assert.equal((await searchPublishedPosts(db, '正文内容')).length, 0, 'LIKE 分支应不含');
  assert.equal((await searchPublishedPosts(db, '正文内容')).length, 0, 'FTS 分支应不含');

  const tags = await listAllTagCounts(db);
  assert.equal(tags.find((t) => t.name === '甲')?.posts ?? 0, 0, '标签计数应不含回收站文章');
  const union = await getTagsUnion(db, ['甲']);
  assert.equal(union.collections.length, 0);
  assert.equal(union.posts.length, 0, '标签聚合列表应不含');

  const other = await seedPublished('trash-adjacent-prev');
  const nav = await getAdjacentPosts(db, other.post);
  assert.equal(nav.prev, null, '相邻导航应跳过回收站文章（回收站文章在 prev 方向）');
  assert.equal(nav.next, null, 'other 已是末篇，无后续');
  assert.ok(other.post.id > 0);
});

test('回收站：trash/restore 留档版本消息且幂等', async () => {
  const { post } = await seedPublished('trash-versions');

  assert.equal(await trashPosts(db, [post.id]), 1, '首次 trash 计入 1');
  assert.equal(await trashPosts(db, [post.id]), 0, '重复 trash 幂等，不计');
  let versions = await listPostVersions(db, post.id);
  assert.equal(versions[0].message, '移入回收站', '最新版本应留档移入回收站');

  assert.equal(await restorePosts(db, [post.id]), 1, '恢复计入 1');
  assert.equal(await restorePosts(db, [post.id]), 0, '重复恢复幂等，不计');
  versions = await listPostVersions(db, post.id);
  assert.equal(versions[0].message, '恢复', '最新版本应留档恢复');

  const back = await getPostById(db, post.id);
  assert.ok(back, '恢复后应可见');
  assert.equal(back.slug, post.slug, '恢复保持原 slug');
  assert.equal(back.status, 'published', '恢复保持原状态');
  assert.equal(back.collection_id, null, '恢复保持原文集');
});

test('回收站：slug 槽位在回收期间仍被占用', async () => {
  const { post } = await seedPublished('trash-slot');
  await trashPosts(db, [post.id]);
  await assert.rejects(
    () =>
      createPostWithTags(
        db,
        { collection_id: null, title: '占位冲突', slug: 'trash-slot', summary: '', content_md: '', status: 'draft' },
        [],
      ),
    /UNIQUE constraint failed/,
    '回收期间同 slug 应仍冲突',
  );
  await restorePosts(db, [post.id]);
});

test('回收站：恢复保留阅读量与标签', async () => {
  const { post } = await seedPublished('trash-views');
  await incrementViewCount(db, post.id);
  await trashPosts(db, [post.id]);
  await restorePosts(db, [post.id]);

  const back = await getPostById(db, post.id);
  assert.equal(back?.view_count, 1, '阅读量在回收期间保留');
  assert.equal((await listPostOwnTags(db, post.id)).length, 2, '标签关联保留');
});

test('回收站：purge 仅作用于回收站文章，且彻底清除', async () => {
  const leftovers = await listPosts(db, { trashOnly: true });
  if (leftovers.length > 0) await purgePosts(db, leftovers.map((p) => p.id));
  const live = await seedPublished('trash-purge-live');
  const dead = await seedPublished('trash-purge-dead');
  await trashPosts(db, [dead.post.id]);

  assert.equal(await purgePosts(db, [live.post.id]), 0, '非回收站文章 purge 不计且不删');
  assert.ok(await getPostById(db, live.post.id), '非回收站文章应原样保留');

  assert.equal(await purgePosts(db, [dead.post.id]), 1, '回收站文章 purge 计入 1');
  assert.equal(await purgePosts(db, [dead.post.id]), 0, '重复 purge 幂等');
  assert.equal(await getPostById(db, dead.post.id), null, 'purge 后应彻底消失');
  assert.equal(await getPublishedPostBySlug(db, dead.post.slug), null);
  assert.equal((await listPosts(db, { trashOnly: true })).length, 0, '回收站应清空');
  assert.equal((await listPostVersions(db, dead.post.id)).length, 0, '版本应随 CASCADE 清除');
  assert.equal((await searchPublishedPosts(db, 'trash-purge-dead 正文内容')).length, 0, 'purge 后 FTS/LIKE 应无残留');
  assert.equal((await listPostOwnTags(db, dead.post.id)).length, 0, '标签关联应随 CASCADE 清除');
});

test('回收站：批量按 50 上限分块，计数正确', async () => {
  const leftovers = await listPosts(db, { trashOnly: true });
  if (leftovers.length > 0) await purgePosts(db, leftovers.map((p) => p.id));
  const ids: number[] = [];
  for (let i = 0; i < 50; i++) {
    const { post } = await seedPublished(`trash-batch-${i}`);
    ids.push(post.id);
  }
  assert.equal(await trashPosts(db, ids), 50, '50 篇整批移入');
  assert.equal(await trashPosts(db, ids), 0, '重复整批幂等');
  assert.equal((await listPosts(db, { trashOnly: true })).length, 50);

  assert.equal(await restorePosts(db, ids), 50);
  assert.equal(await purgePosts(db, ids), 0, '恢复后 purge 不计');
  assert.equal(await trashPosts(db, ids), 50);
  assert.equal(await purgePosts(db, ids), 50, '再次移入后可整批焚毁');
  assert.equal((await listPosts(db, { trashOnly: true })).length, 0, '焚毁后回收站清空');
});

test('回收站：含不存在 id 的混合批量按实际存在计数', async () => {
  const { post } = await seedPublished('trash-mixed');
  const count = await trashPosts(db, [post.id, 999999]);
  assert.equal(count, 1, '仅存在的 1 篇计入');
  assert.equal(await trashPosts(db, [999999]), 0, '全部不存在计 0');
});

test('回收站：文集内文章 trash/restore 不改变文集归属', async () => {
  const col = await createCollection(db, {
    title: '回收站文集',
    slug: 'trash-col',
    summary: '测试',
    theme_color: '#000000',
    sort_order: 0,
    post_order: 'desc',
  });
  assert.ok(col, '文集创建失败');
  const r = await createPostWithTags(
    db,
    {
      collection_id: col.id,
      title: '文集内回收',
      slug: 'trash-in-col',
      summary: 's',
      content_md: 'c',
      status: 'published',
    },
    [],
  );
  assert.ok(r, '文集内文章创建失败');
  const { post } = r;
  await trashPosts(db, [post.id]);
  assert.equal(await getPublishedPostInCollection(db, col.id, post.slug), null);
  assert.equal((await listPublishedPosts(db, { collectionId: col.id })).length, 0);
  assert.equal(await countPublishedPosts(db, { collectionId: col.id }), 0);

  await restorePosts(db, [post.id]);
  assert.ok(await getPublishedPostInCollection(db, col.id, post.slug), '恢复后文集路径应可见');
  const col2 = await getCollectionById(db, col.id);
  assert.ok(col2, '文集本身不受影响');
});
