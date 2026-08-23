// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeE2e, HAS_BUILD, type E2eClient } from './helpers/e2e.ts';

let c: E2eClient;

before(async () => {
  if (!HAS_BUILD) return;
  c = await makeE2e();
});

after(async () => {
  if (c) await c.dispose();
});

test('e2e：GET /api/pages 公开列表仅返回已发布', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  // 建两篇文章，一篇发布一篇草稿
  await c.post('/api/pages', { slug: 'pub-page', title: 'Published', content_md: 'hi', published: 1 });
  await c.post('/api/pages', { slug: 'draft-page', title: 'Draft', content_md: 'd', published: 0 });
  // 公开列表只有已发布
  c.setSession('');
  const r = await c.get('/api/pages');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.pages.length, 1);
  assert.equal(j.pages[0].slug, 'pub-page');
});

test('e2e：管理员 ?all=1 返回全部', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const r = await c.get('/api/pages?all=1');
  const j = await r.json();
  assert.ok(j.pages.length >= 2);
  const slugs = j.pages.map((p: any) => p.slug);
  assert.ok(slugs.includes('pub-page') && slugs.includes('draft-page'));
});

test('e2e：PUT 更新页面字段', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const pages = (await (await c.get('/api/pages?all=1')).json()).pages;
  const pub = pages.find((p: any) => p.slug === 'pub-page');
  const r = await c.put(`/api/pages/${pub.id}`, { title: 'Updated Title', published: 0 });
  assert.equal(r.status, 200);
  // 下线后公开列表不可见
  c.setSession('');
  const pubList = await c.get('/api/pages');
  assert.equal((await pubList.json()).pages.length, 0);
});

test('e2e：DELETE 删除页面', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const pages = (await (await c.get('/api/pages?all=1')).json()).pages;
  const draft = pages.find((p: any) => p.slug === 'draft-page');
  const r = await c.del(`/api/pages/${draft.id}`);
  assert.equal(r.status, 200);
  const ok = await r.json();
  assert.ok(ok.ok);
  // 确认已删除
  const after = await c.get('/api/pages?all=1');
  const slugs = (await after.json()).pages.map((p: any) => p.slug);
  assert.ok(!slugs.includes('draft-page'));
});

test('e2e：slug 冲突拒绝', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const r = await c.post('/api/pages', { slug: 'pub-page', title: 'Dup', content_md: '' });
  assert.equal(r.status, 409);
});

test('e2e：slug 校验——非法字符拒绝', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const r = await c.post('/api/pages', { slug: 'BAD UPPER', title: 'X' });
  assert.equal(r.status, 400);
});

test('e2e：slug 校验——系统保留拒绝', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const r = await c.post('/api/pages', { slug: 'admin', title: 'X' });
  assert.equal(r.status, 400);
});

test('e2e：公开路由 /pages/slug 已发布可访问', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  await c.post('/api/pages', { slug: 'hello', title: 'Hello', content_md: '# Hi', published: 1 });
  c.setSession('');
  const r = await c.get('/pages/hello');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('Hello') || html.includes('<h1'));
});

test('e2e：公开路由 draft 页返回 404', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  await c.post('/api/pages', { slug: 'secret', title: 'Secret', content_md: 'x', published: 0 });
  c.setSession('');
  const r = await c.get('/pages/secret');
  assert.equal(r.status, 404);
});

test('e2e：/about 优先走 DB，无 DB 时 fallback', async () => {
  if (!HAS_BUILD) return;
  // 无 DB about 时展示内建内容
  c.setSession('');
  let r = await c.get('/about');
  assert.equal(r.status, 200);
  let html = await r.text();
  assert.ok(html.includes('江逐月') || html.includes('关于'));

  // 写入 DB about 页面
  await c.login();
  await c.post('/api/pages', { slug: 'about', title: '关于我', content_md: '**数据库内容**', published: 1 });

  c.setSession('');
  r = await c.get('/about');
  assert.equal(r.status, 200);
  html = await r.text();
  assert.ok(html.includes('关于我'));
  assert.ok(html.includes('数据库内容'));
});

test('e2e：未登录 CSRF 拒绝 POST/PUT/DELETE', async () => {
  if (!HAS_BUILD) return;
  c.setSession('');
  assert.equal((await c.post('/api/pages', { slug: 'x', title: 'X' })).status, 401);
  assert.equal((await c.put('/api/pages/1', { title: 'X' })).status, 401);
  assert.equal((await c.del('/api/pages/1')).status, 401);
});