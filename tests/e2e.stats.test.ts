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

// 带真实浏览器 UA + 可辨识 IP 访问文章页，使日聚合记录（种子文章在「随笔」文集内，走文集路径）
async function visit(postPath: string, ip: string): Promise<void> {
  const r = await c.get(postPath, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) e2e-test',
    'CF-Connecting-IP': ip,
  });
  assert.equal(r.status, 200);
}

test('e2e：/api/stats 未登录 401', async () => {
  if (!HAS_BUILD) return;
  const r = await c.anon('/api/stats');
  assert.equal(r.status, 401);
});

test('e2e：访问文章后日聚合入账，同 IP 去重', async () => {
  if (!HAS_BUILD) return;
  await c.login();

  await visit('/collections/essays/first-post/', '61.61.61.1');
  await visit('/collections/essays/first-post/', '61.61.61.1');
  await visit('/collections/essays/first-post/', '61.61.61.2');

  const r = await c.get('/api/stats?days=7');
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.ok(s.total_views >= 2, '同 IP 两次只计 1 次，异 IP 计第 2 次');
  const today = new Date().toISOString().slice(0, 10);
  const todayRow = (s.daily as Array<{ day: string; views: number }>).find((d) => d.day === today);
  assert.ok(todayRow && todayRow.views >= 2, '今日序列应包含至少 2 次');
  assert.ok(
    (s.top_posts as Array<{ title: string }>).some((t) => t.title === '第一篇：博客开张'),
    '热文 TOP 应包含刚访问的文章',
  );
});

test('e2e：爬虫 UA 访问不计入日聚合', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const before = (await (await c.get('/api/stats?days=7')).json()).total_views as number;

  const r = await c.get('/collections/essays/first-post/', {
    'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'CF-Connecting-IP': '70.70.70.7',
  });
  assert.equal(r.status, 200);

  const after = (await (await c.get('/api/stats?days=7')).json()).total_views as number;
  assert.equal(after, before, '爬虫访问不应增加趋势计数');
});

test('e2e：days 参数校验（非法值回落 30）', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const r = await c.get('/api/stats?days=abc');
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.equal(s.days, 30);
});