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

test('e2e：构建产物存在（先运行 pnpm run build）', () => {
  assert.ok(HAS_BUILD, 'dist/server/entry.mjs 缺失，请先 pnpm run build');
});

test('e2e：首页渲染文集与最新文章', async () => {
  if (!HAS_BUILD) return;
  const res = await c.get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('测试书斋'));
  assert.ok(html.includes('随笔'));
  assert.ok(html.includes('第一篇：博客开张'));
  assert.ok(html.includes('/collections/essays/first-post/'));
});

test('e2e：草稿文章对游客 302 至 /404', async () => {
  if (!HAS_BUILD) return;
  const res = await c.get('/collections/essays/draft-post/');
  assert.equal(res.status, 302);
  assert.ok(String(res.headers.get('location')).includes('/404'));
});

test('e2e：admin SPA 回退路由 200（含 no-store 与 noindex）', async () => {
  if (!HAS_BUILD) return;
  for (const path of ['/admin/', '/admin/posts', '/admin/collections', '/admin/editor?id=1', '/admin/login']) {
    const res = await c.get(path);
    assert.equal(res.status, 200, `GET ${path} 应为 200`);
    const html = await res.text();
    assert.ok(html.includes('id="app"'), `${path} 应返回 SPA 外壳`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  }
});

test('e2e：admin SPA 静态资源以正确 MIME 返回（防白屏）', async () => {
  if (!HAS_BUILD) return;
  const shell = await c.get('/admin/');
  const html = await shell.text();
  const src = html.match(/(?:src|href)="(\/admin\/assets\/[^"]+\.(?:js|css))"/)?.[1];
  assert.ok(src, 'SPA 外壳应引用 admin 静态资源');
  const asset = await c.get(src);
  assert.equal(asset.status, 200, `${src} 应为 200`);
  assert.ok(
    String(asset.headers.get('content-type')).startsWith('text/javascript') ||
      String(asset.headers.get('content-type')).startsWith('text/css'),
    `${src} 不应返回 text/html`,
  );
});

test('e2e：未登录无法读草稿列表、无法写数据', async () => {
  if (!HAS_BUILD) return;
  const drafts = await c.get('/api/posts?status=draft');
  assert.equal(drafts.status, 401);
  const create = await c.post('/api/collections', { title: '不应创建', slug: 'x' });
  assert.equal(create.status, 401);
});

test('e2e：sitemap 覆盖静态页、文集、文章与标签页', async () => {
  if (!HAS_BUILD) return;
  // 标签页此前不进 sitemap；口径与 /tags/ 索引一致（只收至少有内容的标签）
  await c.sql(
    `INSERT INTO posts (title, slug, content_md, status, created_at, updated_at)
     VALUES ('站图文章', 'sitemap-post', 'x', 'published', datetime('now'), datetime('now'))`,
  );
  await c.sql(`INSERT INTO tags (name, created_at) VALUES ('sitemap-tag', datetime('now'))`);
  await c.sql(`INSERT INTO tags (name, created_at) VALUES ('empty-tag', datetime('now'))`);
  await c.sql(
    `INSERT INTO post_tags (post_id, tag_id)
     SELECT p.id, t.id FROM posts p, tags t WHERE p.slug = 'sitemap-post' AND t.name = 'sitemap-tag'`,
  );

  const res = await c.get('/sitemap.xml');
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.ok(xml.includes('<loc>http://e2e.test/archive/</loc>'));
  assert.ok(xml.includes('<loc>http://e2e.test/collections/essays/</loc>'));
  assert.ok(xml.includes('<loc>http://e2e.test/collections/tech/astro-on-cloudflare/</loc>'));
  assert.ok(!xml.includes('draft-post'));
  assert.ok(xml.includes('<loc>http://e2e.test/tags/sitemap-tag/</loc>'), '有内容的标签页应进 sitemap');
  assert.ok(!xml.includes('/tags/empty-tag/'), '无内容的标签不应进 sitemap');
});

test('e2e：404 页带站点样式，静态资源可达', async () => {
  if (!HAS_BUILD) return;
  const res = await c.get('/404');
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.ok(html.includes('main-content'), '404 页应渲染站点布局');
  assert.ok(html.includes('/archive/'), '404 页应提供归档出口');

  const robots = await c.get('/robots.txt');
  assert.equal(robots.status, 200);
  assert.ok((await robots.text()).includes('sitemap.xml'));
  const og = await c.get('/og-default.png');
  assert.equal(og.status, 200);
  assert.ok(String(og.headers.get('content-type')).includes('image/png'));
});

test('e2e：admin 页面带 CSP 与 no-store', async () => {
  if (!HAS_BUILD) return;
  const res = await c.get('/admin/');
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.ok(csp.includes("script-src 'self'"), 'admin CSP 应禁止内联脚本');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
});

test('e2e：站点 CSP 走响应头（含 frame-ancestors）且字体已自托管', async () => {
  if (!HAS_BUILD) return;
  const res = await c.get('/');
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.ok(csp.includes("frame-ancestors 'none'"), 'frame-ancestors 只能在响应头里生效');
  assert.ok(!csp.includes('fonts.googleapis.com'), '字体自托管后 CSP 不应再放行 Google 域名');
  assert.ok(csp.includes("font-src 'self'"), '字体应只允许同源');
  const html = await res.text();
  assert.ok(!html.includes('http-equiv="Content-Security-Policy"'), 'CSP 不应再写在 meta 里');
  assert.ok(!html.includes('fonts.googleapis.com'), '页面不应再引用 Google Fonts');
  assert.ok(!html.includes('onload="this.media'), '不得再使用被 script-src 拦截的内联 onload');
  assert.ok(!html.includes('media="print"'), '不得残留 print 占位');
});
