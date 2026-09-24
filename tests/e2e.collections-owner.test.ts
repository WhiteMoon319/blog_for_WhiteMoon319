// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 文集作者化的接口行为：自建、只管理自建、删除保护、我的文集视图。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeE2e, HAS_BUILD, seedUserSession, loginAsAdmin, type E2eClient, type SeededUser } from './helpers/e2e.ts';

let c: E2eClient;
let authorA: SeededUser;
let authorB: SeededUser;
let reader: SeededUser;
let adminCookie = '';
let ready = false;

before(async () => {
  if (!HAS_BUILD) return;
  c = await makeE2e();
});

after(async () => {
  if (c) await c.dispose();
});

async function setup(): Promise<void> {
  if (ready) return;
  adminCookie = await loginAsAdmin(c);
  authorA = await seedUserSession(c, { username: 'col-a', displayName: '集作者甲' });
  authorB = await seedUserSession(c, { username: 'col-b', displayName: '集作者乙' });
  reader = await seedUserSession(c, { username: 'col-r', displayName: '集读者', role: 'reader' });
  ready = true;
}

test('e2e：文集——作者可建，"我的文集"只列自建', async () => {
  if (!HAS_BUILD) return;
  await setup();

  const anonMine = await c.anon('/api/collections?mine=1', { redirect: 'manual' });
  assert.equal(anonMine.status, 401, '未登录看我的文集应 401');
  c.setSession(reader.cookie);
  assert.equal((await c.get('/api/collections?mine=1')).status, 403, '读者看我的文集应 403');
  assert.equal((await c.post('/api/collections', { title: '读者建集', slug: 'col-by-reader' })).status, 403, '读者建文集应 403');

  c.setSession(authorA.cookie);
  const created = await c.post('/api/collections', { title: '甲自建集', slug: 'col-a-own', summary: '甲写的集' });
  assert.equal(created.status, 201, '作者应能建文集');
  const colAId = (await created.json()).collection.id as number;
  const rows = await c.sql('SELECT created_by FROM collections WHERE id = ?', colAId);
  assert.equal(Number(rows.results[0]?.created_by), authorA.id, '归属人应记为创建者');

  c.setSession(authorB.cookie);
  const createdB = await c.post('/api/collections', { title: '乙自建集', slug: 'col-b-own' });
  assert.equal(createdB.status, 201);

  c.setSession(authorA.cookie);
  const mineA = (await (await c.get('/api/collections?mine=1')).json()).collections as Array<{ id: number; title: string }>;
  assert.ok(mineA.some((x) => x.id === colAId), '我的文集含自建');
  assert.ok(!mineA.some((x) => x.title === '乙自建集'), '我的文集不含他人合集');

  const all = (await (await c.get('/api/collections')).json()).collections as Array<{ id: number }>;
  assert.ok(all.some((x) => x.id === colAId), '公开列表仍返回全量文集（写文选择器要用）');
});

test('e2e：文集——作者只能改删自建，改删他人文集 403', async () => {
  if (!HAS_BUILD) return;
  await setup();

  c.setSession(authorA.cookie);
  const created = await c.post('/api/collections', { title: '甲集待改', slug: 'col-a-edit' });
  assert.equal(created.status, 201);
  const colAId = (await created.json()).collection.id as number;
  assert.equal((await c.put(`/api/collections/${colAId}`, { title: '甲集改名' })).status, 200, '作者可改自建文集');
  assert.equal((await c.put(`/api/collections/${colAId}`, { theme_color: 'red' })).status, 400, '非法主题色仍要 400');

  c.setSession(authorB.cookie);
  assert.equal((await c.put(`/api/collections/${colAId}`, { title: '乙篡改' })).status, 403, '改他人文集应 403');
  assert.equal((await c.del(`/api/collections/${colAId}`)).status, 403, '删他人文集应 403');
  assert.equal((await c.put('/api/collections/999999', { title: 'x' })).status, 404, '不存在应 404');

  await setup();
  c.setSession(adminCookie);
  assert.equal((await c.put(`/api/collections/${colAId}`, { title: '管理员改的' })).status, 200, '管理员可改任何文集');
  assert.equal((await c.del(`/api/collections/${colAId}`)).status, 200, '管理员可删任何文集');
});

test('e2e：文集——删除保护与自建文集删除', async () => {
  if (!HAS_BUILD) return;
  await setup();

  // 甲的文集里放乙的文章：甲不能删（否则乙的文章会被打散为未分类）
  c.setSession(authorB.cookie);
  const colCreated = await c.post('/api/collections', { title: '共享集', slug: 'col-shared' });
  const colId = (await colCreated.json()).collection.id as number;
  const postByB = await c.post('/api/posts', { collection_id: colId, title: '乙的稿', slug: 'col-post-b', status: 'draft' });
  assert.equal(postByB.status, 201);
  const postIdB = (await postByB.json()).post.id as number;

  c.setSession(authorA.cookie);
  const guarded = await c.del(`/api/collections/${colId}`);
  assert.equal(guarded.status, 403, '他人文集本来就不能删');
  assert.ok(String((await guarded.json()).error).includes('非本人文集'), '应提示非本人文集');

  // 换成甲自己的文集，内含乙的文章 → 命中删除保护
  c.setSession(authorA.cookie);
  const mine = await c.post('/api/collections', { title: '甲共享集', slug: 'col-a-shared' });
  const mineId = (await mine.json()).collection.id as number;
  c.setSession(adminCookie);
  const foreign = await c.post('/api/posts', { collection_id: mineId, title: '他人稿', slug: 'col-a-foreign', status: 'draft' });
  assert.equal(foreign.status, 201, '管理员可把文章写进他人文集');

  c.setSession(authorA.cookie);
  const blocked = await c.del(`/api/collections/${mineId}`);
  assert.equal(blocked.status, 403, '内含他人文章时不得删除');
  assert.ok(String((await blocked.json()).error).includes('1 篇'), '错误应说明他人文章篇数');

  // 移走他人文章后即可删除；自己文集内的文章随集迁移到未分类
  c.setSession(adminCookie);
  const moved = await c.put(`/api/posts/${(await foreign.json()).post.id as number}`, { collection_id: null });
  assert.equal(moved.status, 200);
  c.setSession(authorA.cookie);
  const own = await c.post('/api/posts', { collection_id: mineId, title: '自己的稿', slug: 'col-a-own-post', status: 'draft' });
  assert.equal(own.status, 201);
  assert.equal((await c.del(`/api/collections/${mineId}`)).status, 200, '只剩自己的文章时可删');
  const migrated = await c.sql('SELECT collection_id FROM posts WHERE slug = ?', 'col-a-own-post');
  assert.equal(migrated.results[0]?.collection_id, null, '文集内的文章应迁到未分类');

  // 清理：把乙的文章也从乙的文集里移出并删集
  c.setSession(authorB.cookie);
  assert.equal((await c.put(`/api/posts/${postIdB}`, { collection_id: null })).status, 200);
  assert.equal((await c.del(`/api/collections/${colId}`)).status, 200, '作者可删自建空集');
  assert.equal((await c.del('/api/collections/999999')).status, 404, '不存在应 404');
});

test('e2e：文集——署名作者可从公开数据取（前台用）', async () => {
  if (!HAS_BUILD) return;
  await setup();

  c.setSession(authorA.cookie);
  const created = await c.post('/api/collections', { title: '可署名集', slug: 'col-sign-public' });
  const colId = (await created.json()).collection.id as number;

  // 公开 GET 详情仍可读，且归属人可从库中对应到作者
  const anon = await c.anon(`/api/collections/${colId}`, { redirect: 'manual' });
  assert.equal(anon.status, 200, '文集详情公开可读');
  const rows = await c.sql(
    `SELECT u.username, u.display_name FROM collections c JOIN users u ON u.id = c.created_by WHERE c.id = ?`,
    colId,
  );
  assert.equal(String(rows.results[0]?.username), authorA.username, '归属人应能联表取到作者');
  assert.equal(String(rows.results[0]?.display_name), '集作者甲');
});

test('e2e：私有文集拒绝他人写入，申请并由归属人同意后放行', async () => {
  if (!HAS_BUILD) return;
  await setup();

  c.setSession(authorA.cookie);
  const created = await c.post('/api/collections', { title: '甲的私集', slug: 'col-private-a' });
  assert.equal(created.status, 201);
  const colId = (await created.json()).collection.id as number;
  const colRow = await c.sql('SELECT is_public FROM collections WHERE id = ?', colId);
  assert.equal(Number(colRow.results[0]?.is_public), 0, '作者自建文集默认私有');

  // 乙写入被拒：创建、改文集、批量移动三条路径都要拦
  c.setSession(authorB.cookie);
  const deniedCreate = await c.post('/api/posts', { collection_id: colId, title: '乙投私稿', slug: 'col-priv-b', status: 'draft' });
  assert.equal(deniedCreate.status, 403, '往他人私有文集建文应 403');
  assert.ok(String((await deniedCreate.json()).error).includes('私有'), '应提示私有文集');

  const loose = await c.post('/api/posts', { title: '乙的散稿', slug: 'col-priv-b2', status: 'draft' });
  assert.equal(loose.status, 201, '不指定文集可正常建文');
  const looseId = (await loose.json()).post.id as number;
  assert.equal((await c.put(`/api/posts/${looseId}`, { collection_id: colId })).status, 403, '改到他人私有文集应 403');
  const moved = await c.post('/api/posts/batch', { action: 'move', ids: [looseId], collection_id: colId });
  assert.equal(moved.status, 403, '批量移动进他人私有文集应 403');
  const batchCreate = await c.post('/api/posts/batch', {
    action: 'create',
    posts: [{ title: '批量塞进私集', slug: 'col-priv-b3', collection_id: colId }],
  });
  assert.equal(batchCreate.status, 403, '批量新建到他人私有文集应 403');

  // 成员列表与申请审核：非归属人不可读、不可操作
  assert.equal((await c.get(`/api/collections/${colId}/members`)).status, 403, '非归属人看成员应 403');
  assert.equal((await c.get(`/api/collections/${colId}/join`)).status, 404, 'join 只接受 POST');

  // 乙申请协作
  const asked = await c.post(`/api/collections/${colId}/join`, { message: '想一起写' });
  assert.equal(asked.status, 201, '作者应能申请协作');
  assert.equal((await asked.json()).status, 'pending');
  const again = await c.post(`/api/collections/${colId}/join`, { message: '再问一次' });
  assert.equal(again.status, 201, '重复申请应幂等成功');
  assert.equal((await c.post('/api/posts', { collection_id: colId, title: '还没同意', slug: 'col-priv-b4' })).status, 403, '未同意前仍不可写');

  // 归属人看到申请并同意
  c.setSession(authorA.cookie);
  const inbox = await (await c.get(`/api/collections/${colId}/members`)).json();
  assert.equal((inbox.invites as unknown[]).length, 1, '归属人应看到待处理申请');
  const inviteId = (inbox.invites as Array<{ id: number }>)[0].id;
  assert.equal((await c.post(`/api/collections/${colId}/members`, { approve_id: inviteId })).status, 200, '归属人可同意申请');
  const afterApprove = await (await c.get(`/api/collections/${colId}/members`)).json();
  assert.deepEqual((afterApprove.members as Array<{ user_id: number }>).map((m) => m.user_id), [authorB.id], '同意后应进入协作者列表');

  // 乙可写了；移除后又不可写，但已写入的文章保留
  c.setSession(authorB.cookie);
  const allowed = await c.post('/api/posts', { collection_id: colId, title: '乙通过后的稿', slug: 'col-priv-b5', status: 'draft' });
  assert.equal(allowed.status, 201, '协作者可写私有文集');
  const allowedId = (await allowed.json()).post.id as number;

  c.setSession(authorA.cookie);
  assert.equal((await c.del(`/api/collections/${colId}/members?user_id=${authorB.id}`)).status, 200, '归属人可移除协作者');
  c.setSession(authorB.cookie);
  assert.equal((await c.post('/api/posts', { collection_id: colId, title: '被移除后', slug: 'col-priv-b6' })).status, 403, '移除后立即不可写');
  const kept = await c.sql('SELECT collection_id FROM posts WHERE id = ?', allowedId);
  assert.equal(Number(kept.results[0]?.collection_id), colId, '移除协作者不改动已写入的文章');
  assert.equal((await c.put(`/api/posts/${allowedId}`, { title: '只改标题' })).status, 200, '既有文章仍可编辑（不校验当前所在文集）');
});

test('e2e：公用文集任何作者可写，归属人可切换公用/私有', async () => {
  if (!HAS_BUILD) return;
  await setup();

  c.setSession(authorA.cookie);
  const created = await c.post('/api/collections', { title: '甲的公集', slug: 'col-public-a', is_public: true });
  assert.equal(created.status, 201);
  const colId = (await created.json()).collection.id as number;
  const pub = await c.sql('SELECT is_public FROM collections WHERE id = ?', colId);
  assert.equal(Number(pub.results[0]?.is_public), 1, '显式传 is_public 应落库');

  c.setSession(authorB.cookie);
  assert.equal(
    (await c.post('/api/posts', { collection_id: colId, title: '乙投公集', slug: 'col-pub-b', status: 'draft' })).status,
    201,
    '公用文集任何作者可写',
  );

  // 归属人改回私有：只影响后续写入，已写入的文章保留
  c.setSession(authorA.cookie);
  assert.equal((await c.put(`/api/collections/${colId}`, { is_public: false })).status, 200, '归属人可改公用状态');
  c.setSession(authorB.cookie);
  assert.equal(
    (await c.post('/api/posts', { collection_id: colId, title: '私下改后', slug: 'col-pub-b2' })).status,
    403,
    '改回私有后不可再写入',
  );
  assert.equal((await c.post(`/api/collections/${colId}/join`, { message: '给我开个权限' })).status, 201, '公有仍可申请');

  // 非归属人不可改公用状态
  assert.equal((await c.put(`/api/collections/${colId}`, { is_public: true })).status, 403, '非归属人不可改');

  c.setSession(adminCookie);
  assert.equal((await c.put(`/api/collections/${colId}`, { is_public: true })).status, 200, '管理员可改任意文集');
  assert.equal(
    (await c.post('/api/posts', { collection_id: colId, title: '管理员开公后可写', slug: 'col-pub-b3' })).status,
    201,
    '管理员本就全权',
  );
});
