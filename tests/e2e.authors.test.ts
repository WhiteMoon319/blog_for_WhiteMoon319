// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 多作者权限层（阶段 2）：作者基线权限、归属/署名编辑权、管理员专属接口的越权面。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeE2e, HAS_BUILD, ORIGIN_HEADERS, seedUserSession, loginAsAdmin, type E2eClient, type SeededUser } from './helpers/e2e.ts';

let c: E2eClient;
let colId = 0;
let authorA: SeededUser;
let authorB: SeededUser;
let reader: SeededUser;
let ready = false;
// 登录接口有频率限制（e2e 窗口内 10 次），管理员会话只在 setup 里换一次，其余用此缓存复用
let adminCookie = '';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4]);

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
  const col = await c.post('/api/collections', { title: '鉴权集', slug: 'e2e-authz' });
  assert.equal(col.status, 201);
  colId = (await col.json()).collection.id as number;
  authorA = await seedUserSession(c, { username: 'authz-a', displayName: '作者甲' });
  authorB = await seedUserSession(c, { username: 'authz-b', displayName: '作者乙' });
  reader = await seedUserSession(c, { username: 'authz-r', displayName: '读者丙', role: 'reader' });
  ready = true;
}

/** 以某个会话创建一篇文章，返回 id */
async function createPost(cookie: string, slug: string, status = 'draft'): Promise<number> {
  c.setSession(cookie);
  const res = await c.post('/api/posts', {
    collection_id: colId,
    title: `文章 ${slug}`,
    slug,
    content_md: '正文。',
    status,
  });
  assert.equal(res.status, 201, `创建 ${slug} 应 201`);
  return (await res.json()).post.id as number;
}

test('e2e：未登录 401、读者访问内容管理接口 403', async () => {
  if (!HAS_BUILD) return;
  await setup();

  const anonDraft = await c.anon('/api/posts?status=draft', { redirect: 'manual' });
  assert.equal(anonDraft.status, 401, '未登录看草稿列表应 401');
  const anonCreate = await c.anon('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
    body: JSON.stringify({ title: '匿名', slug: 'anon-x' }),
  });
  assert.equal(anonCreate.status, 401, '未登录创建文章应 401');

  c.setSession(reader.cookie);
  const readerDraft = await c.get('/api/posts?status=draft');
  assert.equal(readerDraft.status, 403, '读者看草稿列表应 403');
  const readerCreate = await c.post('/api/posts', { title: '读者写稿', slug: 'reader-write' });
  assert.equal(readerCreate.status, 403, '读者创建文章应 403');
  const readerMedia = await c.get('/api/media');
  assert.equal(readerMedia.status, 403, '读者看媒体库应 403');
  const readerRender = await c.post('/api/render', { md: '# 标题' });
  assert.equal(readerRender.status, 403, '读者调渲染接口应 403');

  // 管理员专属接口：已登录的非管理员是越权（403），未登录才是 401
  for (const path of ['/api/settings', '/api/users', '/api/stats', '/api/export', '/api/admin/comments']) {
    const res = await c.get(path);
    assert.equal(res.status, 403, `读者访问 ${path} 应 403`);
  }
});

test('e2e：作者可创建/编辑自己的文章，归属人记为自己', async () => {
  if (!HAS_BUILD) return;
  await setup();

  const id = await createPost(authorA.cookie, 'authz-a-own', 'draft');
  const rows = await c.sql('SELECT created_by FROM posts WHERE id = ?', id);
  assert.equal(Number(rows.results[0]?.created_by), authorA.id, 'created_by 应记为创建者');

  const list = await c.get('/api/posts?status=draft');
  assert.equal(list.status, 200);
  const mine = (await list.json()).posts as Array<{ id: number; created_by: number | null }>;
  assert.ok(mine.some((p) => p.id === id), '作者草稿列表应含自己的文章');

  c.setSession(authorA.cookie);
  const detail = await c.get(`/api/posts/${id}`);
  assert.equal(detail.status, 200, '作者应能读自己的草稿');
  const upd = await c.put(`/api/posts/${id}`, { title: '改过的标题' });
  assert.equal(upd.status, 200, '作者应能改自己的文章');

  const versions = await c.get(`/api/posts/${id}/versions`);
  assert.equal(versions.status, 200, '作者应能看自己文章的版本列表');
  const ver = await c.get(`/api/posts/${id}/versions/1`);
  assert.equal(ver.status, 200, '作者应能看自己文章的版本详情');

  const render = await c.post('/api/render', { md: '# 标题\n\n正文' });
  assert.equal(render.status, 200, '作者应能用实时渲染');
  assert.ok(((await render.json()).html as string).includes('<h1'), '渲染应产出 HTML');

  const form = c.multipart([{ name: 'file', filename: 'a.png', type: 'image/png', bytes: PNG }]);
  const up = await c.raw('/api/upload', {
    method: 'POST',
    headers: { ...ORIGIN_HEADERS, 'Content-Type': form.contentType },
    body: form.body,
  });
  assert.equal(up.status, 201, '作者应能上传图片');

  const media = await c.get('/api/media');
  assert.equal(media.status, 200, '作者应能读媒体库');

  const preview = await c.get(`/preview/${id}`);
  assert.equal(preview.status, 200, '作者应能预览自己的草稿');
});

test('e2e：作者不能读写他人文章、他人版本与批量操作', async () => {
  if (!HAS_BUILD) return;
  await setup();

  c.setSession(adminCookie);
  const adminPost = await createPost(await c.session(), 'authz-admin-post', 'draft');
  c.setSession(authorA.cookie);

  assert.equal((await c.get(`/api/posts/${adminPost}`)).status, 404, '他人草稿按不存在处理');
  assert.equal((await c.put(`/api/posts/${adminPost}`, { title: '篡改' })).status, 403, '改他人文章应 403');
  assert.equal((await c.del(`/api/posts/${adminPost}`)).status, 403, '删他人文章应 403');
  assert.equal((await c.get(`/api/posts/${adminPost}/versions`)).status, 403, '看他人版本列表应 403');
  assert.equal((await c.get(`/api/posts/${adminPost}/versions/1`)).status, 403, '看他人版本详情应 403');
  assert.equal(
    (await c.post(`/api/posts/${adminPost}/versions/1/restore`, {})).status,
    403,
    '回滚他人版本应 403',
  );

  const batchTrash = await c.post('/api/posts/batch', { action: 'trash', ids: [adminPost] });
  assert.equal(batchTrash.status, 403, '批量删除含他人文章应 403');
  const batchPurge = await c.post('/api/posts/batch', { action: 'purge', ids: [adminPost] });
  assert.equal(batchPurge.status, 403, '彻底删除他人文章应 403');

  const preview = await c.get(`/preview/${adminPost}`);
  assert.equal(preview.status, 302, '他人草稿预览应被重定向');
  assert.ok(String(preview.headers.get('location')).includes('/404'), '预览应跳 404');

  // 作者对自己文章的批量操作仍可用
  const ownPost = await createPost(authorA.cookie, 'authz-a-batch', 'published');
  const ownBatch = await c.post('/api/posts/batch', { action: 'trash', ids: [ownPost] });
  assert.equal(ownBatch.status, 200, '作者应能批量处理自己的文章');
  const restored = await c.post('/api/posts/batch', { action: 'restore', ids: [ownPost] });
  assert.equal(restored.status, 200, '作者应能从回收站恢复自己的文章');
});

test('e2e：署名作者可编辑他人创建的文章（署名与归属解耦）', async () => {
  if (!HAS_BUILD) return;
  await setup();

  const id = await createPost(authorA.cookie, 'authz-coauthor', 'draft');
  assert.equal((await c.put(`/api/posts/${id}`, { title: '乙改不了' })).status, 200, '归属人自己可改');
  c.setSession(authorB.cookie);
  assert.equal((await c.put(`/api/posts/${id}`, { title: '乙改不了' })).status, 403, '未署名时乙应被拒');

  // 把归属人清空、乙列为署名作者：编辑权应随署名生效
  await c.sql('UPDATE posts SET created_by = NULL WHERE id = ?', id);
  await c.sql('INSERT INTO post_authors (post_id, user_id, sort_order) VALUES (?, ?, 0)', id, authorB.id);
  c.setSession(authorB.cookie);
  assert.equal((await c.get(`/api/posts/${id}`)).status, 200, '署名作者应能读草稿');
  assert.equal((await c.put(`/api/posts/${id}`, { title: '乙改得了' })).status, 200, '署名作者应能改');
  assert.equal((await c.get(`/api/posts/${id}/versions`)).status, 200, '署名作者应能看版本');
});

test('e2e：管理员全通，作者列表只看得到自己', async () => {
  if (!HAS_BUILD) return;
  await setup();

  const aPost = await createPost(authorA.cookie, 'authz-scope-a', 'draft');
  c.setSession(adminCookie);
  const adminPost = await createPost(await c.session(), 'authz-scope-admin', 'draft');

  c.setSession(authorA.cookie);
  const mine = (await (await c.get('/api/posts?status=draft')).json()).posts as Array<{ id: number }>;
  assert.ok(mine.some((p) => p.id === aPost), '作者列表含自己的文章');
  assert.ok(!mine.some((p) => p.id === adminPost), '作者列表不含他人文章');

  const trash = await c.get('/api/posts?status=all&trash=1');
  assert.equal(trash.status, 200, '作者可看自己的回收站');
  const trashIds = ((await trash.json()).posts as Array<{ id: number }>).map((p) => p.id);
  assert.ok(!trashIds.includes(adminPost), '作者回收站不含他人文章');

  const adminAll = await (async () => {
    c.setSession(adminCookie);
    return (await (await c.get('/api/posts?status=all')).json()).posts as Array<{ id: number }>;
  })();
  assert.ok(adminAll.some((p) => p.id === adminPost), '管理员列表可见他人文章');

  // 管理员可改、可删作者的文章
  c.setSession(adminCookie);
  assert.equal((await c.put(`/api/posts/${aPost}`, { title: '管理员改的' })).status, 200, '管理员应能改作者文章');
  assert.equal((await c.del(`/api/posts/${aPost}`)).status, 200, '管理员应能删作者文章');
  assert.equal((await c.get('/api/settings')).status, 200, '管理员应能读设置');
  assert.equal((await c.get('/api/users')).status, 200, '管理员应能读用户列表');
});

test('e2e：角色调整接口——管理员专属，reader↔author，管理员角色不可改', async () => {
  if (!HAS_BUILD) return;
  await setup();

  const adminRows = await c.sql(`SELECT id FROM users WHERE username = 'admin'`);
  const adminId = Number(adminRows.results[0]?.id);

  c.setSession(authorA.cookie);
  assert.equal((await c.post(`/api/users/${reader.id}/role`, { role: 'author' })).status, 403, '作者无权提权');
  const anon = await c.anon(`/api/users/${reader.id}/role`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
    body: JSON.stringify({ role: 'author' }),
  });
  assert.equal(anon.status, 401, '未登录应 401');

  c.setSession(adminCookie);
  assert.equal((await c.post(`/api/users/${reader.id}/role`, { role: 'admin' })).status, 400, '不得提为管理员');
  assert.equal((await c.post(`/api/users/${adminId}/role`, { role: 'reader' })).status, 403, '管理员角色不可改');
  assert.equal((await c.post('/api/users/999999/role', { role: 'author' })).status, 404, '用户不存在应 404');

  const promote = await c.post(`/api/users/${reader.id}/role`, { role: 'author' });
  assert.equal(promote.status, 200, '读者应可提为作者');
  const roleRows = await c.sql('SELECT role FROM users WHERE id = ?', reader.id);
  assert.equal(String(roleRows.results[0]?.role), 'author', '角色应落库');
  assert.equal((await c.post(`/api/users/${reader.id}/role`, { role: 'author' })).status, 200, '重复设置应幂等');

  // 提权后立刻生效（角色即时读取，无需重新登录）
  c.setSession(reader.cookie);
  assert.equal((await c.get('/api/posts?status=draft')).status, 200, '新作者会话立即可用');

  c.setSession(adminCookie);
  assert.equal((await c.post(`/api/users/${reader.id}/role`, { role: 'reader' })).status, 200, '作者应可降回读者');
  c.setSession(reader.cookie);
  assert.equal((await c.get('/api/posts?status=draft')).status, 403, '降级后立即失去内容管理权限');
});

test('e2e：简介编辑——作者自助走 account，管理员可改他人', async () => {
  if (!HAS_BUILD) return;
  await setup();

  c.setSession(authorA.cookie);
  assert.equal((await c.put('/api/account', { bio: '写代码的人' })).status, 200, '作者应能改自己的简介');
  assert.equal((await (await c.get('/api/account')).json()).bio, '写代码的人', 'account 应回带简介');
  assert.equal((await (await c.get('/api/auth/me')).json()).bio, '写代码的人', 'me 应回带简介');
  assert.equal((await c.put('/api/account', { bio: 'x'.repeat(201) })).status, 400, '超长简介应 400');
  assert.equal((await c.put(`/api/users/${authorA.id}`, { bio: '越权' })).status, 403, '作者不能改他人资料');

  c.setSession(adminCookie);
  assert.equal((await c.put(`/api/users/${authorA.id}`, { bio: '由管理员写入' })).status, 200, '管理员应能改作者简介');
  const listed = ((await (await c.get('/api/users')).json()).users as Array<{ id: number; bio: string }>).find(
    (u) => u.id === authorA.id,
  );
  assert.equal(listed?.bio, '由管理员写入', '用户列表应带最新简介');
  assert.equal((await c.put(`/api/users/${authorA.id}`, {})).status, 400, '空更新应 400');
});

test('e2e：文章署名写入、替换与清空，非法署名被拒', async () => {
  if (!HAS_BUILD) return;
  await setup();

  c.setSession(authorA.cookie);
  // 缺省署名 = 创建者本人
  const plain = await c.post('/api/posts', { collection_id: colId, title: '默认署名', slug: 'authz-default-sign', status: 'draft' });
  assert.equal(plain.status, 201);
  const plainBody = await plain.json();
  assert.deepEqual((plainBody.authors as Array<{ id: number }>).map((a) => a.id), [authorA.id], '新文默认署名创建者');

  // 显式多人署名：第一位为主作者
  const multi = await c.post('/api/posts', {
    collection_id: colId,
    title: '联合署名',
    slug: 'authz-multi-sign',
    status: 'draft',
    authors: [authorB.id, authorA.id],
  });
  assert.equal(multi.status, 201);
  const multiId = (await multi.json()).post.id as number;
  const detail = await (await c.get(`/api/posts/${multiId}`)).json();
  assert.deepEqual((detail.authors as Array<{ id: number }>).map((a) => a.id), [authorB.id, authorA.id], '署名应保序');

  const replaced = await c.put(`/api/posts/${multiId}`, { authors: [authorA.id] });
  assert.equal(replaced.status, 200);
  assert.deepEqual(
    ((await replaced.json()).authors as Array<{ id: number }>).map((a) => a.id),
    [authorA.id],
    '署名应整体替换',
  );

  // 仅换署名也要留版本，否则回滚会把署名退回旧状态
  const verAfterSign = ((await (await c.get(`/api/posts/${multiId}`)).json()).version as number) ?? 0;
  await c.put(`/api/posts/${multiId}`, { authors: [] });
  const cleared = await (await c.get(`/api/posts/${multiId}`)).json();
  assert.deepEqual(cleared.authors, [], '空数组应清空署名');
  assert.ok((cleared.version as number) > verAfterSign, '署名变更应产生新版本');

  // 非法署名：读者、不存在的用户、超限一律 400
  assert.equal((await c.put(`/api/posts/${multiId}`, { authors: [reader.id] })).status, 400, '读者不可署名');
  assert.equal((await c.put(`/api/posts/${multiId}`, { authors: [999999] })).status, 400, '不存在的用户不可署名');
  assert.equal((await c.put(`/api/posts/${multiId}`, { authors: [authorA.id, 'x'] })).status, 400, '非法类型应 400');
  const oversized = await c.post('/api/posts', {
    collection_id: colId,
    title: '超限署名',
    slug: 'authz-over-sign',
    authors: Array.from({ length: 11 }, () => authorA.id),
  });
  assert.equal(oversized.status, 400, '超过署名上限应 400');
});
