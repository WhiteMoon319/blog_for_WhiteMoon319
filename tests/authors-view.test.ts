// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 前台作者展示契约：作者徽标（署名渲染的最小单元）与批量取回。

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUser,
  banUser,
  createPost,
  setPostAuthors,
  createCollection,
} from '../src/lib/db/index.ts';
import {
  toAuthorBadge,
  toAuthorBadges,
  listPostAuthorBadges,
  badgesByPostId,
  collectionOwnerBadge,
  collectionOwnerBadges,
  getAuthorProfile,
  searchAuthorHits,
} from '../src/lib/authors-view.ts';
import { makeTestDb } from './helpers/d1.ts';

const handle = await makeTestDb();
after(() => handle.dispose());
const db = handle.db;

async function mkUser(username: string, role: 'reader' | 'author' | 'admin' = 'author', displayName = username, bio = '') {
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

test('作者徽标：笔名优先，封禁或身份不符时降级为纯文本（href=null）', () => {
  const base = { id: 1, username: 'someone', display_name: '', avatar_url: '', bio: '', role: 'author', status: 'active' };

  const plain = toAuthorBadge(base);
  assert.equal(plain.name, 'someone', '无笔名回退用户名');
  assert.equal(plain.href, '/authors/someone/', '普通作者有作者页');

  const named = toAuthorBadge({ ...base, display_name: '  笔名甲  ' });
  assert.equal(named.name, '笔名甲', '笔名优先且去除首尾空白');

  assert.equal(toAuthorBadge({ ...base, status: 'banned' }).href, null, '封禁作者无作者页（署名降级纯文本）');
  assert.equal(toAuthorBadge({ ...base, role: 'reader' }).href, null, '读者身份不产生作者页');
  assert.equal(toAuthorBadge({ ...base, role: 'admin' }).href, '/authors/someone/', '管理员也有作者页');
  assert.equal(
    toAuthorBadge({ ...base, username: 'a b/c' }).href,
    '/authors/a%20b%2Fc/',
    '用户名需 URL 编码',
  );
  assert.equal(toAuthorBadges([]).length, 0);
});

test('单篇署名徽标：带简介与头像，按 sort_order 保序', async () => {
  const a = await mkUser('av-a', 'author', '甲作者', '写小说的人');
  const b = await mkUser('av-b', 'author', '乙作者');
  const post = await createPost(db, { title: '署名文', slug: 'av-post', status: 'published', created_by: a.id });
  assert.ok(post);
  await setPostAuthors(db, post!.id, [b.id, a.id]);

  const badges = await listPostAuthorBadges(db, post!.id);
  assert.deepEqual(badges.map((x) => x.name), ['乙作者', '甲作者'], '顺序即署名顺序（第一位主作者）');
  assert.equal(badges[1].bio, '写小说的人', '简介随徽标带出');
  assert.equal(badges[0].href, '/authors/av-b/', '作者页路径正确');
});

test('批量署名：按文章 id 索引返回普通对象，分块不丢数据', async () => {
  const a = await mkUser('av-batch', 'author', '批量作者');
  const stmts = Array.from({ length: 95 }, (_, i) =>
    db
      .prepare(`INSERT INTO posts (title, slug, status, created_by) VALUES (?, ?, 'draft', ?)`)
      .bind(`批量章 ${i}`, `av-batch-${i}`, a.id),
  );
  await db.batch(stmts);
  await db
    .prepare(`INSERT INTO post_authors (post_id, user_id, sort_order) SELECT id, ?, 0 FROM posts WHERE slug LIKE 'av-batch-%'`)
    .bind(a.id)
    .run();
  const rows = await db.prepare(`SELECT id FROM posts WHERE slug LIKE 'av-batch-%'`).all<{ id: number }>();
  const ids = (rows.results ?? []).map((r) => r.id);
  assert.equal(ids.length, 95);

  const map = await badgesByPostId(db, ids);
  assert.equal(Object.keys(map).length, 95, '每篇都应有署名键（分块合并后不丢）');
  assert.equal(map[String(ids[0])][0].name, '批量作者');
  assert.equal(map[String(ids[94])][0].name, '批量作者');
  assert.deepEqual(await badgesByPostId(db, []), {}, '空输入不查库');
});

test('文集集主：单个与批量取回，无归属不产生键', async () => {
  const owner = await mkUser('av-owner', 'author', '集主甲');
  const col = await createCollection(db, { title: '有主集', slug: 'av-col-yes', created_by: owner.id });
  const orphan = await createCollection(db, { title: '无主集', slug: 'av-col-no' });
  assert.ok(col && orphan);

  const single = await collectionOwnerBadge(db, col!.id);
  assert.equal(single?.name, '集主甲');
  assert.equal(await collectionOwnerBadge(db, orphan!.id), null, '无归属不产生作者');

  const multi = await collectionOwnerBadges(db, [col!.id, orphan!.id, 999999]);
  assert.equal(multi[String(col!.id)]?.name, '集主甲');
  assert.equal(multi[String(orphan!.id)], undefined, '无归属不产生键');
});

test('作者页作者信息：仅未封禁作者/管理员可解析，含加入时间', async () => {
  const a = await mkUser('av-page', 'author', '页面作者', '简介甲');
  await mkUser('av-page-reader', 'reader');
  const banned = await mkUser('av-page-banned', 'author');
  await banUser(db, banned.id);

  const profile = await getAuthorProfile(db, 'av-page');
  assert.equal(profile?.badge.name, '页面作者');
  assert.equal(profile?.badge.bio, '简介甲');
  assert.ok(profile?.joinedAt, '应带加入时间');
  assert.deepEqual(await getAuthorProfile(db, 'AV-PAGE'), profile, '用户名大小写不敏感');
  assert.equal(await getAuthorProfile(db, 'av-page-reader'), null, '读者无作者页');
  assert.equal(await getAuthorProfile(db, 'av-page-banned'), null, '封禁作者无作者页');
  assert.equal(await getAuthorProfile(db, 'nobody'), null, '不存在返回 null');
});

test('搜索作者：命中用户名/笔名/简介，排除读者与封禁，附已发布篇数', async () => {
  const writer = await mkUser('av-search-hit', 'author', '寻章作者', '专写山水游记');
  const banned = await mkUser('av-search-banned', 'author', '寻章封禁');
  const reader = await mkUser('av-search-reader', 'reader', '寻章读者');
  await banUser(db, banned.id);
  const post = await createPost(db, { title: '游记一', slug: 'av-search-post', status: 'published', created_by: writer.id });
  assert.ok(post);
  await setPostAuthors(db, post!.id, [writer.id]);

  const byUsername = await searchAuthorHits(db, 'av-search-hit');
  assert.equal(byUsername.length, 1);
  assert.equal(byUsername[0].name, '寻章作者');
  assert.equal(byUsername[0].postCount, 1, '已发布篇数计入');
  assert.equal(byUsername[0].href, '/authors/av-search-hit/');

  const byDisplayName = await searchAuthorHits(db, '寻章');
  assert.deepEqual(byDisplayName.map((x) => x.username), ['av-search-hit'], '封禁与读者不出现在结果里');

  const byBio = await searchAuthorHits(db, '山水游记');
  assert.equal(byBio.length, 1, '简介命中');

  assert.deepEqual(await searchAuthorHits(db, '   '), [], '空白关键词不查询');
  assert.ok(!(await searchAuthorHits(db, 'av-search-reader')).length, '读者不可被搜到');
});
