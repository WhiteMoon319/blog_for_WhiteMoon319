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
  createPost,
  createPostWithTags,
  updatePostWithTags,
  createCollection,
  createCollectionWithTags,
  updateCollectionWithTags,
  deleteCollection,
  getPostById,
  getCollectionById,
  listPostVersions,
  getLatestPostVersion,
  listPostOwnTags,
  listCollectionTags,
  getTagByName,
  searchPublishedPosts,
  incrementViewCount,
  updatePost,
  deletePost,
  isValidTagName,
  parseTagsStrict,
} from '../src/lib/db/index.ts';
import { slugBase, slugWithSuffix, isValidSlug, SLUG_MAX } from '../src/lib/utils.ts';
import { makeTestDb } from './helpers/d1.ts';

const handle = await makeTestDb();
after(() => handle.dispose());
const db = handle.db;

test('原子写：创建文章 + 标签——slug 冲突时整批回滚，标签不落库', async () => {
  const a = await createPost(db, { title: '占位甲', slug: 'atomic-dup', content_md: '甲。' });
  assert.ok(a);

  await assert.rejects(
    () => createPostWithTags(db, { title: '占位乙', slug: 'atomic-dup', content_md: '乙。' }, ['原子试甲', '原子试乙']),
    /UNIQUE constraint failed/,
    'slug 冲突必须让整批失败',
  );
  assert.equal(await getTagByName(db, '原子试甲'), null, '主体回滚时标签不得残留');
  assert.equal(await getTagByName(db, '原子试乙'), null);
  assert.equal((await listPostOwnTags(db, a.id)).length, 0, '已有文章不受影响');
});

test('原子写：更新文章 + 标签——slug 冲突时正文/版本/旧标签全部保留', async () => {
  const p = await createPostWithTags(db, { title: '原子更新', slug: 'atomic-upd', content_md: '原文。' }, ['旧标甲']);
  assert.ok(p);
  assert.equal(await getLatestPostVersion(db, p.post.id), 1);

  await assert.rejects(
    () =>
      updatePostWithTags(db, p.post.id, { content_md: '改了不该生效。', slug: 'atomic-dup' }, ['新标乙'], '测试'),
    /UNIQUE constraint failed/,
    '更新阶段 slug 冲突必须让整批失败',
  );

  const row = await getPostById(db, p.post.id);
  assert.equal(row?.content_md, '原文。', '正文不得被部分写入');
  assert.equal(row?.slug, 'atomic-upd');
  assert.equal(await getLatestPostVersion(db, p.post.id), 1, '不得产生半截版本');
  assert.deepEqual(
    (await listPostOwnTags(db, p.post.id)).map((t) => t.name),
    ['旧标甲'],
    '旧标签不得被替换',
  );
  assert.equal(await getTagByName(db, '新标乙'), null, '失败批次不得创建新标签');
});

test('原子写：仅换标签不产生版本记录，且与主体变更同批', async () => {
  const p = await createPostWithTags(db, { title: '换标文', slug: 'atomic-tag', content_md: '正文。' }, ['换标甲']);
  assert.ok(p);

  const r = await updatePostWithTags(db, p.post.id, {}, ['换标乙'], '仅换标签');
  assert.ok(r !== null && r !== 'conflict');
  assert.equal(await getLatestPostVersion(db, p.post.id), 1, '仅换标签不应产生版本');
  assert.deepEqual(
    (await listPostOwnTags(db, p.post.id)).map((t) => t.name),
    ['换标乙'],
  );

  const r2 = await updatePostWithTags(db, p.post.id, { content_md: '改正文。' }, ['换标丙'], '改正文');
  assert.ok(r2 !== null && r2 !== 'conflict');
  assert.equal(await getLatestPostVersion(db, p.post.id), 2, '正文变更应留档');
  assert.deepEqual(
    (await listPostOwnTags(db, p.post.id)).map((t) => t.name),
    ['换标丙'],
    '标签替换与正文更新同批生效',
  );
});

test('原子写：创建/更新文集 + 标签——slug 冲突整批回滚', async () => {
  await createCollection(db, { title: '文集占位', slug: 'col-atomic-dup' });

  await assert.rejects(
    () => createCollectionWithTags(db, { title: '文集冲突', slug: 'col-atomic-dup' }, ['集标甲']),
    /UNIQUE constraint failed/,
  );
  assert.equal(await getTagByName(db, '集标甲'), null, '文集创建失败时标签不得残留');

  const col = await createCollectionWithTags(db, { title: '文集原子', slug: 'col-atomic' }, ['集标乙']);
  assert.ok(col);
  assert.deepEqual(
    (await listCollectionTags(db, col.collection.id)).map((t) => t.name),
    ['集标乙'],
  );

  await assert.rejects(
    () => updateCollectionWithTags(db, col.collection.id, { slug: 'col-atomic-dup' }, ['集标丙']),
    /UNIQUE constraint failed/,
    '文集更新 slug 冲突必须整批失败',
  );
  const after = await getCollectionById(db, col.collection.id);
  assert.equal(after?.slug, 'col-atomic', '文集主体不得被部分写入');
  assert.deepEqual(
    (await listCollectionTags(db, col.collection.id)).map((t) => t.name),
    ['集标乙'],
    '旧标签不得被替换',
  );
  assert.equal(await getTagByName(db, '集标丙'), null);

  const ok = await updateCollectionWithTags(db, col.collection.id, { summary: '改简介。' }, ['集标丁']);
  assert.ok(ok);
  assert.deepEqual(
    (await listCollectionTags(db, col.collection.id)).map((t) => t.name),
    ['集标丁'],
  );
});

test('标签严格解析：恰好 20 成功；21 个、非法字符、超长、空串、非字符串一律报错', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `标${i}`);
  const r20 = parseTagsStrict(twenty);
  assert.equal(r20.ok, true);
  assert.ok(r20.ok && r20.tags.length === 20);

  const r21 = parseTagsStrict([...twenty, '多一个']);
  assert.equal(r21.ok, false);
  assert.ok(!r21.ok && r21.error.includes('20'), '报错应说明上限');

  const illegal = parseTagsStrict(['a#b']);
  assert.equal(illegal.ok, false);
  const tooLong = parseTagsStrict(['x'.repeat(33)]);
  assert.equal(tooLong.ok, false);
  const empty = parseTagsStrict(['  ']);
  assert.equal(empty.ok, false);
  const nonString = parseTagsStrict(['甲', 42]);
  assert.equal(nonString.ok, false);
  const nonArray = parseTagsStrict('甲');
  assert.equal(nonArray.ok, false);

  const dedupe = parseTagsStrict([' 甲 ', '甲', ' 乙 ']);
  assert.ok(dedupe.ok && dedupe.ok && dedupe.tags.length === 2, '去重与空白归一化允许');

  assert.ok(isValidTagName('百分比十'));
  assert.ok(!isValidTagName('100%'));
});

test('slug 工具：超长截断 ≤63 无尾连字符，冲突后缀始终合法', () => {
  const long = slugBase('字'.repeat(200));
  assert.equal(long.length, SLUG_MAX);
  assert.ok(isValidSlug(long));

  const dashy = slugBase('a'.repeat(100) + '---');
  assert.ok(!dashy.endsWith('-'));
  assert.ok(dashy.length <= SLUG_MAX);
  assert.ok(isValidSlug(dashy));

  const base63 = 'x'.repeat(SLUG_MAX);
  assert.ok(isValidSlug(base63));
  assert.ok(isValidSlug(slugWithSuffix(base63, 2)), '63 字符基数加后缀仍合法');
  assert.equal(slugWithSuffix(base63, 2).length, SLUG_MAX);
  assert.equal(slugWithSuffix('slug', 123), 'slug-123', '多位数后缀直接拼接');
  assert.ok(isValidSlug(slugWithSuffix('y'.repeat(61) + '--', 2)), '带尾连字符的基数先清理再拼后缀');
});

test('删除文集：超 48 成员分批迁移 + 版本留档 + 账本清理 + slug 全部合法', async () => {
  const col = await createCollection(db, { title: '大部头', slug: 'bulk-col' });
  assert.ok(col);
  const members = Array.from({ length: 60 }, (_, i) => i);
  const ids: number[] = [];
  for (const i of members) {
    const p = await createPost(db, {
      title: `章节${i}`,
      slug: `bulk-ch-${i}`,
      collection_id: col.id,
      content_md: `正文 ${i}`,
      status: 'published',
    });
    assert.ok(p);
    ids.push(p.id);
  }
  const uncat = await createPost(db, { title: '冲突占位', slug: 'bulk-ch-5', content_md: '', status: 'published' });
  assert.ok(uncat, '未分类侧预置与成员同 slug 的文章');

  assert.equal(await deleteCollection(db, col.id), true);
  assert.equal(await getCollectionById(db, col.id), null, '文集应删除');
  const ledger = await db
    .prepare('SELECT COUNT(*) AS n FROM collection_deletes WHERE collection_id = ?')
    .bind(col.id)
    .first<{ n: number }>();
  assert.equal(ledger?.n, 0, '账本行应在完成时清除');

  const all = await db
    .prepare('SELECT id, slug, collection_id FROM posts WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...ids, uncat.id]))
    .all<{ id: number; slug: string; collection_id: number | null }>();
  const rows = all.results ?? [];
  assert.equal(rows.length, 61, '成员与占位全部保留');
  const slugs = new Set(rows.map((r) => r.slug));
  assert.equal(slugs.size, rows.length, '未分类 slug 全局唯一');
  for (const r of rows) {
    assert.equal(r.collection_id, null, '成员应转未分类');
    assert.ok(isValidSlug(r.slug), `迁移后 slug 必须合法：${r.slug}`);
    assert.ok(r.slug.length <= SLUG_MAX);
  }
  const keeper = rows.find((r) => r.id === uncat.id);
  assert.equal(keeper?.slug, 'bulk-ch-5', '较新的未分类占位保留原 slug');
  const loser = rows.find((r) => r.id === ids[5]);
  assert.equal(loser?.slug, 'bulk-ch-5-2', '与未分类冲突的成员获得确定性后缀 -2');
  const unaffected = rows.find((r) => r.id === ids[0]);
  assert.equal(unaffected?.slug, 'bulk-ch-0', '无冲突成员保留原 slug');

  const versions = await db
    .prepare(`SELECT post_id, message FROM post_versions WHERE message = '文集删除迁移'`)
    .all<{ post_id: number; message: string }>();
  assert.equal((versions.results ?? []).length, 60, '每个成员都应留迁移版本');
  const v1 = await listPostVersions(db, ids[0]);
  assert.equal(v1[0].version, 2, '迁移版本紧跟创建版本');
  assert.equal(v1[0].slug, unaffected?.slug, '无冲突成员的版本记录原 slug');
  assert.equal(v1[0].collection_id, null, '版本记录转未分类');
  const vLoser = await listPostVersions(db, ids[5]);
  assert.equal(vLoser[0].version, 2);
  assert.equal(vLoser[0].slug, loser?.slug, '冲突成员的版本记录新 slug');
  assert.equal(vLoser[0].collection_id, null);
});

test('删除文集：故障注入——成员迁移批次失败时整批回滚，恢复后幂等续跑', async () => {
  const col = await createCollection(db, { title: '注入集', slug: 'inj-col' });
  assert.ok(col);
  const ids: number[] = [];
  for (let i = 0; i < 60; i++) {
    const p = await createPost(db, {
      title: `注入章${i}`,
      slug: `inj-ch-${i}`,
      collection_id: col.id,
      content_md: '',
      status: 'published',
    });
    assert.ok(p);
    ids.push(p.id);
  }

  // 注入：任何「迁移到未分类」的 UPDATE 一律失败（模拟批次中途崩溃）
  await db
    .prepare(
      `CREATE TRIGGER inj_migrate BEFORE UPDATE ON posts
       WHEN new.collection_id IS NULL AND old.collection_id IS NOT NULL
       BEGIN SELECT RAISE(ABORT, 'simulated crash'); END`,
    )
    .run();
  try {
    await assert.rejects(() => deleteCollection(db, col.id), /simulated crash/);
  } finally {
    await db.prepare('DROP TRIGGER inj_migrate').run();
  }

  // 批次原子性：成员一个都不能被迁移
  const stuck = await db
    .prepare('SELECT COUNT(*) AS n FROM posts WHERE collection_id = ?')
    .bind(col.id)
    .first<{ n: number }>();
  assert.equal(stuck?.n, 60, '失败时整批回滚，成员全部仍在文集下');
  assert.ok(await getCollectionById(db, col.id), '文集仍在，可重试');

  // 恢复后重试：幂等续跑直到完成
  assert.equal(await deleteCollection(db, col.id), true);
  const remaining = await db
    .prepare('SELECT COUNT(*) AS n FROM posts WHERE collection_id = ?')
    .bind(col.id)
    .first<{ n: number }>();
  assert.equal(remaining?.n, 0, '重试后全部迁移');
  const done = await db
    .prepare('SELECT COUNT(*) AS n FROM posts WHERE id IN (SELECT value FROM json_each(?)) AND collection_id IS NULL')
    .bind(JSON.stringify(ids))
    .first<{ n: number }>();
  assert.equal(done?.n, 60, '60 篇全部转为未分类');
  const dup = await db
    .prepare('SELECT COUNT(*) AS n FROM (SELECT slug FROM posts WHERE collection_id IS NULL GROUP BY slug HAVING COUNT(*) > 1)')
    .first<{ n: number }>();
  assert.equal(dup?.n, 0, '迁移后未分类 slug 无重复');
});

test('删除文集：空集与小型集（≤48）走单事务尾批', async () => {
  const empty = await createCollection(db, { title: '空集', slug: 'empty-col' });
  assert.ok(empty);
  assert.equal(await deleteCollection(db, empty.id), true);

  const small = await createCollection(db, { title: '小集', slug: 'small-col' });
  assert.ok(small);
  for (let i = 0; i < 3; i++) {
    const p = await createPost(db, { title: `小章${i}`, slug: `small-ch-${i}`, collection_id: small.id, status: 'published' });
    assert.ok(p);
  }
  assert.equal(await deleteCollection(db, small.id), true);
  const leftover = await db
    .prepare('SELECT COUNT(*) AS n FROM posts WHERE collection_id = ?')
    .bind(small.id)
    .first<{ n: number }>();
  assert.equal(leftover?.n, 0);
});

test('FTS：更新触发器带 WHEN——view_count 不触发重建，内容变更仍同步', async () => {
  const trig = await db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'posts_fts_au'`)
    .first<{ sql: string }>();
  assert.ok(trig?.sql.includes('WHEN'), '触发器必须带 WHEN 子句');
  assert.ok(trig?.sql.includes('content_md'), 'WHEN 需覆盖正文列');
  assert.ok(!/WHEN\s*1/i.test(trig!.sql), '不得退化为无条件');

  const p = await createPost(db, {
    title: '木匣试炼',
    slug: `fts-when-${Date.now().toString(36)}`,
    content_md: '木匣里的秘密字码Z9',
    status: 'published',
  });
  assert.ok(p);

  const countInFts = async (term: string) => {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM posts_fts WHERE posts_fts MATCH ?`)
      .bind(`"${term}"`)
      .first<{ n: number }>();
    return row?.n ?? 0;
  };

  assert.ok((await countInFts('秘密字码')) >= 1, '创建后应入索引');
  for (let i = 0; i < 3; i++) await incrementViewCount(db, p.id);
  assert.ok((await countInFts('秘密字码')) >= 1, 'view_count 自增不应影响索引');

  await updatePost(db, p.id, { content_md: '换了新词Q7' });
  assert.equal(await countInFts('秘密字码'), 0, '旧词应随内容更新移出索引');
  assert.ok((await countInFts('新词Q7')) >= 1, '新词应入索引');

  const hits = await searchPublishedPosts(db, '新词Q7');
  assert.ok(hits.some((h) => h.id === p.id), '搜索能命中更新后的内容');

  await deletePost(db, p.id);
  assert.equal(await countInFts('新词Q7'), 0, '删除后索引同步清除');
});