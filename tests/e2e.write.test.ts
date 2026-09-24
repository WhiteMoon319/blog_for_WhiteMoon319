// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 作者写作区（/write/）：与 /admin/ 分开的入口、产物与路由表。

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

test('e2e：写作区入口——/write/ 与深链均返回独立壳，且不缓存', async () => {
  if (!HAS_BUILD) return;

  const root = await c.anon('/write/', { redirect: 'manual' });
  assert.equal(root.status, 200, '/write/ 应返回写作区入口');
  assert.equal(root.headers.get('cache-control'), 'no-store', '写作区入口不应被缓存');
  assert.equal(root.headers.get('x-robots-tag'), 'noindex', '写作区不应被索引');
  const html = await root.text();
  assert.ok(html.includes('写作区'), '应渲染写作区壳');
  assert.ok(html.includes('/write/assets/'), '资源应挂在 /write/ 基路径下');
  assert.ok(!html.includes('/admin/assets/'), '不应引用后台产物');

  // 深链刷新：/write/editor 也由前端路由接管
  for (const path of ['/write/editor', '/write/collections', '/write/media']) {
    const res = await c.anon(path, { redirect: 'manual' });
    assert.equal(res.status, 200, `${path} 深链应返回写作区壳`);
    assert.ok((await res.text()).includes('写作区'), `${path} 应渲染写作区壳`);
  }

  // 静态资源透传
  const assetPath = /\/write\/(assets\/[^"]+\.js)/.exec(html)?.[1];
  assert.ok(assetPath, '入口 HTML 应引用打包后的 JS');
  const asset = await c.anon(`/write/${assetPath}`, { redirect: 'manual' });
  assert.equal(asset.status, 200, '写作区资源应可访问');
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable', '带 hash 的产物应长缓存');
});

test('e2e：后台与写作区互不串门', async () => {
  if (!HAS_BUILD) return;

  const admin = await c.anon('/admin/', { redirect: 'manual' });
  const adminHtml = await admin.text();
  assert.ok(adminHtml.includes('/admin/assets/'), '后台仍引用自己的产物');
  assert.ok(!adminHtml.includes('/write/assets/'), '后台不应引用写作区产物');

  // 写作区不提供任何管理员页面：/write/settings 走前端路由，落到文章列表
  const ghost = await c.anon('/write/settings', { redirect: 'manual' });
  assert.equal(ghost.status, 200, '未知子路径由写作区壳接管');
  assert.ok(!(await ghost.text()).includes('设置'), '写作区壳不含后台设置页内容');
});

test('e2e：写作区的权限仍由接口兜底（前端隐藏不是防线）', async () => {
  if (!HAS_BUILD) return;
  // 任何人都能取到壳（静态产物不保密），但接口一律按角色判定
  const anonApi = await c.anon('/api/posts?status=draft', { redirect: 'manual' });
  assert.equal(anonApi.status, 401, '未登录读草稿应 401');
  const anonCollections = await c.anon('/api/collections?view=1', { redirect: 'manual' });
  assert.equal(anonCollections.status, 401, '未登录读写作区文集视图应 401');
});
