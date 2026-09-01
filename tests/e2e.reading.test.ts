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

test('e2e：阅读历史——登录可见、API 记录、首页历史区块、文章页恢复位置', async () => {
  if (!HAS_BUILD) return;

  // 先登录（管理员），再建一篇已发布文章
  await c.login();
  const created = await c.post('/api/posts', {
    title: '续读试炼',
    slug: 'reading-probe',
    content_md: '## 段落甲\n\n正文甲。\n\n## 段落乙\n\n正文乙。',
    status: 'published',
  });
  assert.equal(created.status, 201);
  const postId = (await created.json()).post.id as number;

  // 未登录：首页不应出现历史记录区块（使用无 cookie 的 anon 请求）
  const anonHome = await c.anon('/');
  const anonHtml = await anonHome.text();
  assert.ok(!anonHtml.includes('id="history"'), '未登录首页不应有历史区块');

  // 未登录：上报阅读进度应 401
  const anonPost = await c.anon('/api/reading', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: c.base },
    body: JSON.stringify({ postId, scrollPct: 42 }),
  });
  assert.equal(anonPost.status, 401, '未登录上报应拒绝');

  // 登录后（复用已登录会话）：上报阅读进度
  const record = await c.post('/api/reading', { postId, scrollPct: 42 });
  assert.equal(record.status, 200);

  // 登录后：首页应出现历史区块与文章
  const home = await c.get('/');
  const homeHtml = await home.text();
  assert.ok(homeHtml.includes('id="history"'), '登录首页应有历史区块');
  assert.ok(homeHtml.includes('续读试炼'), '历史区块应包含刚读的文章');
  assert.ok(homeHtml.includes('自上次搁笔处'), '历史区块应带引导文案');

  // 文章页：应带上次阅读位置（initialScrollPct → define:vars 注入脚本）
  const postPage = await c.get('/posts/reading-probe/');
  assert.equal(postPage.status, 200);
  const postHtml = await postPage.text();
  assert.ok(/initialPct[\s\S]{0,30}42/.test(postHtml), '文章页应注入上次阅读位置');

  // 清理
  await c.del(`/api/posts/${postId}`);
});
