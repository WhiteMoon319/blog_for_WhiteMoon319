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
  createUser,
  banUser,
  getUserById,
  setUserRole,
  filterSignableAuthorIds,
  createPost,
  createPostWithTags,
  updatePostWithTags,
  setPostAuthors,
  listPostAuthors,
  listAuthorsForPosts,
  getPostAuthorIds,
  getAuthorByUsername,
  listAuthors,
  searchAuthors,
  countPublishedPostsByAuthor,
  listPublishedPostsByAuthor,
  getLatestPostVersion,
  getPostVersion,
} from '../src/lib/db/index.ts';
import { makeTestDb } from './helpers/d1.ts';
import { parseAuthorIds, MAX_POST_AUTHORS } from '../src/lib/api/validate.ts';

const handle = await makeTestDb();
after(() => handle.dispose());
const db = handle.db;

async function mkUser(
  username: string,
  role: 'reader' | 'author' | 'admin' = 'author',
  displayName = username,
  bio = '',
) {
  const u = await createUser(db, {
    username,
    email: `${username}@example.com`,
    password_hash: 'x',
    display_name: displayName,
    role,
  });
  assert.ok(u, `创建用户 ${username} 失败`);
  if (bio) await db.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(bio, u.id).run();
  return u;
}

test('迁移 0034：post_authors 表与 created_by / bio / authors 列齐备', async () => {
  const table = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'post_authors'`)
    .first<{ name: string }>();
  assert.ok(table, 'post_authors 表应存在');

  const postCols = await db.prepare(`SELECT name FROM pragma_table_info('posts')`).all<{ name: string }>();
  assert.ok(postCols.results?.some((c) => c.name === 'created_by'), 'posts.created_by 应存在');

  const userCols = await db.prepare(`SELECT name FROM pragma_table_info('users')`).all<{ name: string }>();
  assert.ok(userCols.results?.some((c) => c.name === 'bio'), 'users.bio 应存在');

  const versionCols = await db.prepare(`SELECT name FROM pragma_table_info('post_versions')`).all<{ name: string }>();
  assert.ok(versionCols.results?.some((c) => c.name === 'authors'), 'post_versions.authors 应存在');
});

test('迁移回填：历史文章补归属到管理员并生成署名（可重复执行）', async () => {
  const admin = await db
    .prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`)
    .first<{ id: number }>();
  assert.ok(admin, '迁移 0027 应已种下管理员');

  // 模拟迁移前的历史文章：不带 created_by
  await db.prepare(`INSERT INTO posts (title, slug, status) VALUES ('历史文', 'legacy-1', 'published')`).run();

  // 与 0034 迁移内完全一致的回填语句
  await db
    .prepare(`UPDATE posts SET created_by = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1) WHERE created_by IS NULL`)
    .run();
  await db
    .prepare(`INSERT OR IGNORE INTO post_authors (post_id, user_id, sort_order) SELECT id, created_by, 0 FROM posts WHERE created_by IS NOT NULL`)
    .run();

  const row = await db.prepare(`SELECT id, created_by FROM posts WHERE slug = 'legacy-1'`).first<{ id: number; created_by: number }>();
  assert.equal(row?.created_by, admin.id, '历史文章应归到管理员名下');
  assert.deepEqual(await getPostAuthorIds(db, row!.id), [admin.id], '历史文章应生成管理员署名');
});

test('署名：多作者按传入顺序持久化，重复 id 去重', async () => {
  const a = await mkUser('writera', 'author', '甲');
  const b = await mkUser('writerb', 'author', '乙');
  const post = await createPost(db, { title: '合著', slug: 'co-1', status: 'published' });
  assert.ok(post);

  await setPostAuthors(db, post.id, [b.id, a.id, b.id]);
  assert.deepEqual(await getPostAuthorIds(db, post.id), [b.id, a.id], '去重且保持传入顺序');

  const authors = await listPostAuthors(db, post.id);
  assert.deepEqual(authors.map((x) => x.username), ['writerb', 'writera'], '第一位即主作者');
  assert.equal(authors[0].display_name, '乙', '带出笔名');

  await setPostAuthors(db, post.id, []);
  assert.deepEqual(await listPostAuthors(db, post.id), [], '整体替换可清空署名');
});

test('批量署名：一次取回多篇，未署名文章不出现在结果里', async () => {
  const a = await mkUser('batcha', 'author', '批甲');
  const b = await mkUser('batchb', 'author', '批乙');
  const p1 = await createPost(db, { title: '批一', slug: 'batch-co-1', status: 'published' });
  const p2 = await createPost(db, { title: '批二', slug: 'batch-co-2', status: 'published' });
  const p3 = await createPost(db, { title: '批三', slug: 'batch-co-3', status: 'published' });
  assert.ok(p1 && p2 && p3);

  await setPostAuthors(db, p1.id, [a.id, b.id]);
  await setPostAuthors(db, p2.id, [a.id]);

  const map = await listAuthorsForPosts(db, [p1.id, p2.id, p3.id]);
  assert.equal(map.get(p1.id)?.length, 2);
  assert.equal(map.get(p2.id)?.length, 1);
  assert.equal(map.has(p3.id), false, '无署名文章不进 map');

  assert.equal((await listAuthorsForPosts(db, [])).size, 0, '空输入不查库');
});

test('作者口径：读者与封禁用户既无作者页也不可被搜到', async () => {
  await mkUser('plainreader', 'reader', '普通读者');
  const banned = await mkUser('bannedwriter', 'author', '封禁作者', '写过几篇');
  await banUser(db, banned.id);

  assert.equal(await getAuthorByUsername(db, 'plainreader'), null, '读者不算作者');
  assert.equal(await getAuthorByUsername(db, 'bannedwriter'), null, '封禁后作者页失效');
  assert.equal((await searchAuthors(db, '普通读者')).length, 0, '读者不进搜索');
  assert.equal((await searchAuthors(db, '封禁作者')).length, 0, '封禁作者不进搜索');

  const active = await mkUser('activewriter', 'author', '在册作者');
  const hit = await getAuthorByUsername(db, 'ActiveWriter');
  assert.equal(hit?.id, active.id, '用户名大小写归一');
});

test('搜索作者：命中用户名 / 笔名 / 简介，并统计已发布篇数', async () => {
  const u = await mkUser('cloudpoet', 'author', '云中诗', '写园中旧事');
  const created = await createPostWithTags(
    db,
    { title: '作者篇一', slug: 'author-post-1', status: 'published', collection_id: null },
    [],
    [u.id],
  );
  assert.ok(created);

  const byName = await searchAuthors(db, '云中诗');
  assert.equal(byName.length, 1);
  assert.equal(byName[0].id, u.id);
  assert.equal(byName[0].post_count, 1, '统计署名文章数');

  assert.equal((await searchAuthors(db, 'cloudpoet')).length, 1, '命中用户名');
  assert.equal((await searchAuthors(db, '园中旧事')).length, 1, '命中简介');
  assert.equal((await searchAuthors(db, '不存在的作者')).length, 0);
  assert.equal((await searchAuthors(db, '  ')).length, 0, '空查询直接返回');

  const like = await searchAuthors(db, '%');
  assert.equal(like.length, 0, 'LIKE 通配符被转义为字面量');

  const all = await listAuthors(db);
  const counts = all.map((a) => a.post_count);
  assert.deepEqual(counts, [...counts].sort((x, y) => y - x), '按篇数降序');
  assert.equal(all.find((a) => a.id === u.id)?.post_count, 1, '列表带出该作者篇数');
});

test('作者文章列表：只统计已发布且署名/归属的文章', async () => {
  const u = await mkUser('countwriter', 'author', '计数作者');
  const other = await mkUser('otherwriter', 'author', '他人');
  const pub = await createPostWithTags(
    db,
    { title: '已发布', slug: 'count-1', status: 'published', collection_id: null },
    [],
    [u.id],
  );
  const draft = await createPostWithTags(
    db,
    { title: '草稿', slug: 'count-2', status: 'draft', collection_id: null },
    [],
    [u.id],
  );
  // 归属在 u 名下但署名他人：仍计入 u
  const ownedByU = await createPost(db, { title: '归属文', slug: 'count-3', status: 'published', created_by: u.id });
  await setPostAuthors(db, ownedByU!.id, [other.id]);
  assert.ok(pub && draft);

  assert.equal(await countPublishedPostsByAuthor(db, u.id), 2, '草稿不计入，归属与署名都计入');
  const list = await listPublishedPostsByAuthor(db, u.id);
  assert.deepEqual(list.map((p) => p.slug).sort(), ['count-1', 'count-3']);
  assert.equal((await listPublishedPostsByAuthor(db, u.id, { limit: 1 })).length, 1, '支持分页');
});

test('创建时可带归属人与初始署名', async () => {
  const u = await mkUser('createowner', 'author', '创建者');
  const co = await mkUser('createco', 'author', '合著者');
  const created = await createPostWithTags(
    db,
    { title: '创建即带署名', slug: 'create-authors-1', status: 'published', collection_id: null, created_by: u.id },
    [],
    [u.id, co.id],
  );
  assert.ok(created);
  assert.equal(created.post.created_by, u.id, '归属人落库');
  assert.deepEqual(await getPostAuthorIds(db, created.post.id), [u.id, co.id]);
});

test('版本快照：改署名与改正文一样产生版本，版本内 authors 记录当时署名', async () => {
  const a = await mkUser('vera', 'author', '版甲');
  const b = await mkUser('verb', 'author', '版乙');
  const created = await createPostWithTags(
    db,
    { title: '版本署名', slug: 'ver-authors-1', content_md: '一', status: 'published', collection_id: null },
    [],
    [],
  );
  assert.ok(created);
  const postId = created.post.id;

  await updatePostWithTags(db, postId, { content_md: '二' }, null, '改正文', undefined, [a.id, b.id]);
  const latest = await getLatestPostVersion(db, postId);
  const ver = await getPostVersion(db, postId, latest);
  assert.deepEqual(JSON.parse(ver!.authors), [a.id, b.id], '版本记录变更后的署名');

  // 仅改署名也要产生版本，否则回滚会把署名退回旧状态
  const before = await getLatestPostVersion(db, postId);
  await updatePostWithTags(db, postId, {}, null, undefined, undefined, [b.id]);
  const after = await getLatestPostVersion(db, postId);
  assert.equal(after, before + 1, '仅署名变更同样留版本');
  assert.deepEqual(await getPostAuthorIds(db, postId), [b.id]);

  // 不传 authorIds 时不触碰署名
  await updatePostWithTags(db, postId, { content_md: '三' }, null, '只改正文');
  assert.deepEqual(await getPostAuthorIds(db, postId), [b.id], '未携带署名时保持原样');
});

test('角色调整：仅 reader ↔ author，管理员角色免疫', async () => {
  const r = await mkUser('role-reader', 'reader');
  const a = await mkUser('role-author', 'author');
  const boss = await mkUser('role-admin', 'admin');

  assert.equal(await setUserRole(db, r.id, 'author'), true, '读者应可提为作者');
  assert.equal((await getUserById(db, r.id))?.role, 'author');
  assert.equal(await setUserRole(db, r.id, 'reader'), true, '作者应可降回读者');
  assert.equal((await getUserById(db, r.id))?.role, 'reader');
  assert.equal(await setUserRole(db, a.id, 'reader'), true);

  // 管理员角色不接受改动：既保住"最后一名管理员"，也不会被本接口提权
  assert.equal(await setUserRole(db, boss.id, 'reader'), false, '管理员不应被降级');
  assert.equal((await getUserById(db, boss.id))?.role, 'admin');
  assert.equal(await setUserRole(db, 999999, 'author'), false, '不存在的用户返回 false');
});

test('可署名过滤：只留作者/管理员且未封禁，保序去重', async () => {
  const a = await mkUser('sign-author', 'author');
  const r = await mkUser('sign-reader', 'reader');
  const banned = await mkUser('sign-banned', 'author');
  const boss = await mkUser('sign-admin', 'admin');
  await banUser(db, banned.id);

  assert.deepEqual(
    await filterSignableAuthorIds(db, [banned.id, a.id, r.id, a.id, boss.id]),
    [a.id, boss.id],
    '应剔除读者与封禁用户并去重保序',
  );
  assert.deepEqual(await filterSignableAuthorIds(db, []), []);
  assert.deepEqual(await filterSignableAuthorIds(db, [999999]), [], '不存在的用户被过滤');
});

test('署名参数解析：缺省不动、数组整体替换、非法值报错', () => {
  assert.deepEqual(parseAuthorIds(undefined), { ok: true, ids: undefined }, '未携带字段 = 不改署名');
  assert.deepEqual(parseAuthorIds(null), { ok: true, ids: undefined });
  assert.deepEqual(parseAuthorIds([]), { ok: true, ids: [] }, '空数组 = 清空署名');
  assert.deepEqual(parseAuthorIds([3, 1, 3]), { ok: true, ids: [3, 1] }, '去重保序（第一位即主作者）');

  assert.equal(parseAuthorIds('a').ok, false, '非数组应报错');
  assert.equal(parseAuthorIds([0]).ok, false, '非正整数应报错');
  assert.equal(parseAuthorIds([1.5]).ok, false, '小数应报错');
  assert.equal(parseAuthorIds(['1']).ok, false, '字符串 id 应报错');
  const tooMany = Array.from({ length: MAX_POST_AUTHORS + 1 }, (_, i) => i + 1);
  assert.equal(parseAuthorIds(tooMany).ok, false, '超过署名上限应报错');
});
