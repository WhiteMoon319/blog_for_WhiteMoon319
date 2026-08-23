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

test('e2e：首页置顶区——仅已发布未删除的置顶文章，时间倒序，列表不隐藏', async () => {
  if (!HAS_BUILD) return;
  await c.login();

  const older = await c.post('/api/posts', {
    title: '置顶旧篇',
    slug: 'pin-older',
    content_md: '旧置顶',
    status: 'published',
    is_pinned: 1,
  });
  assert.equal(older.status, 201);
  const olderId = (await older.json()).post.id;

  const newer = await c.post('/api/posts', {
    title: '置顶新篇',
    slug: 'pin-newer',
    content_md: '新置顶',
    status: 'published',
    is_pinned: 1,
  });
  assert.equal(newer.status, 201);
  const newerId = (await newer.json()).post.id;

  const draftPinned = await c.post('/api/posts', {
    title: '置顶草稿',
    slug: 'pin-draft',
    content_md: '未发表',
    status: 'draft',
    is_pinned: 1,
  });
  assert.equal(draftPinned.status, 201);
  const draftPinnedId = (await draftPinned.json()).post.id;

  const home = await c.get('/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.ok(html.includes('id="pinned"'), '应渲染置顶区');
  assert.ok(html.includes('置于案头'), '置顶区标题');
  const iNewer = html.indexOf('/posts/pin-newer/');
  const iOlder = html.indexOf('/posts/pin-older/');
  assert.ok(iNewer !== -1 && iOlder !== -1, '两篇置顶都应出现');
  assert.ok(iNewer < iOlder, '置顶区按时间倒序（新篇在前）');
  assert.ok(!html.includes('/posts/pin-draft/'), '置顶草稿不得出现');

  const pinned2 = await c.get('/api/posts?status=published');
  const listJson = await pinned2.json();
  const slugs = listJson.posts.map((p: { slug: string }) => p.slug);
  assert.ok(slugs.includes('pin-newer'), '置顶文章在普通列表内依然可见（不隐藏）');

  await c.del(`/api/posts/${olderId}`);
  await c.del(`/api/posts/${newerId}`);
  await c.del(`/api/posts/${draftPinnedId}`);
  const afterTrash = await c.get('/');
  assert.ok(!(await afterTrash.text()).includes('/posts/pin-older/'), '回收站置顶文章不得出现在置顶区');
});

test('e2e：批量置顶/取消置顶 API 幂等与计数', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const created = await c.post('/api/posts', {
    title: '批量置顶',
    slug: 'pin-bulk',
    content_md: '正文',
    status: 'published',
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id;

  const pin = await c.post('/api/posts/batch', { action: 'pin', ids: [id] });
  assert.equal(pin.status, 200);
  assert.equal((await pin.json()).count, 1);
  const pinAgain = await c.post('/api/posts/batch', { action: 'pin', ids: [id] });
  assert.equal((await pinAgain.json()).count, 0, '重复置顶幂等');

  const detail = await c.get(`/api/posts/${id}`);
  assert.equal((await detail.json()).post.is_pinned, 1);

  const unpin = await c.post('/api/posts/batch', { action: 'unpin', ids: [id] });
  assert.equal((await unpin.json()).count, 1);
  const detail2 = await c.get(`/api/posts/${id}`);
  assert.equal((await detail2.json()).post.is_pinned, 0);

  await c.del(`/api/posts/${id}`);
  const afterTrash = await c.post('/api/posts/batch', { action: 'pin', ids: [id] });
  assert.equal((await afterTrash.json()).count, 0, '回收站文章不参与置顶');
});