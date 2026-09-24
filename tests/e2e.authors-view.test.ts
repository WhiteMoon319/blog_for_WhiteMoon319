// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 前台多作者呈现：文章/列表署名、文集集主、作者页、搜索作者区与封禁降级。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeE2e, HAS_BUILD, seedUserSession, loginAsAdmin, type E2eClient, type SeededUser } from './helpers/e2e.ts';

let c: E2eClient;
let authorA: SeededUser;
let authorB: SeededUser;
let reader: SeededUser;
let adminCookie = '';
let colSlug = '';
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
  authorA = await seedUserSession(c, { username: 'view-a', displayName: '砚台甲', bio: '写山水的甲' });
  authorB = await seedUserSession(c, { username: 'view-b', displayName: '砚台乙' });
  reader = await seedUserSession(c, { username: 'view-r', displayName: '读者丙', role: 'reader' });
  // 甲自建文集（归属人即集主署名）
  const col = await c.post('/api/collections', { title: '山水集', slug: 'view-col', is_public: true });
  assert.equal(col.status, 201);
  colSlug = (await col.json()).collection.slug as string;
  ready = true;
}

/** 建一篇已刊发、署名指定作者的文章 */
async function publishSigned(slug: string, title: string, authorIds: number[], cookie: string): Promise<number> {
  c.setSession(cookie);
  const res = await c.post('/api/posts', {
    collection_id: null,
    title,
    slug,
    summary: '摘要',
    content_md: '正文。',
    status: 'published',
    authors: authorIds,
  });
  assert.equal(res.status, 201, `发布 ${slug} 应 201`);
  return (await res.json()).post.id as number;
}

test('e2e：文章页署名——多作者按序、链接作者页、JSON-LD 为作者数组', async () => {
  if (!HAS_BUILD) return;
  await setup();
  const slug = 'view-signed-post';
  await publishSigned(slug, '联署之篇', [authorB.id, authorA.id], authorA.cookie);

  const html = await (await c.get(`/posts/${slug}/`)).text();
  assert.ok(html.includes('砚台乙'), '应展示第一位作者');
  assert.ok(html.includes('砚台甲'), '应展示第二位作者');
  assert.ok(html.includes(`/authors/view-b/`), '署名应链接作者页');
  assert.ok(
    html.indexOf('砚台乙') < html.indexOf('砚台甲'),
    '展示顺序应保持署名顺序（第一位为主作者）',
  );

  // JSON-LD：author 为数组，含全部作者
  const ld = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(ld, '应输出 JSON-LD');
  const data = JSON.parse(ld[1]);
  const authors = Array.isArray(data.author) ? data.author : [data.author];
  assert.deepEqual(
    authors.map((a: { name: string }) => a.name),
    ['砚台乙', '砚台甲'],
    'JSON-LD author 应为作者数组',
  );
});

test('e2e：作者页——作者 200（含简介与文章），读者与不存在 404', async () => {
  if (!HAS_BUILD) return;
  await setup();
  await publishSigned('view-author-page', '甲的篇章', [authorA.id], authorA.cookie);

  const page = await c.get('/authors/view-a/');
  assert.equal(page.status, 200, '作者页应可访问');
  const html = await page.text();
  assert.ok(html.includes('砚台甲'), '应展示作者名');
  assert.ok(html.includes('写山水的甲'), '应展示简介');
  assert.ok(html.includes('甲的篇章'), '应列出该作者的文章');
  assert.ok(html.includes('ProfilePage'), '应带 ProfilePage JSON-LD');

  assert.equal((await c.get('/authors/view-r/')).status, 302, '读者无作者页（跳 404）');
  assert.equal((await c.get('/authors/nobody-here/')).status, 302, '不存在的用户跳 404');
});

test('e2e：封禁作者的既有署名降级为纯文本，作者页停止生成', async () => {
  if (!HAS_BUILD) return;
  await setup();
  const slug = 'view-banned-post';
  await publishSigned(slug, '封禁署名篇', [authorB.id], authorB.cookie);

  // 未封禁时署名可跳转
  const before = await (await c.get(`/posts/${slug}/`)).text();
  assert.ok(before.includes('/authors/view-b/'), '封禁前署名应可跳转');

  c.setSession(adminCookie);
  assert.equal((await c.post(`/api/users/${authorB.id}/ban`, {})).status, 200, '封禁应成功');

  const afterBan = await (await c.get(`/posts/${slug}/`)).text();
  assert.ok(afterBan.includes('砚台乙'), '文章保留，署名仍展示');
  assert.ok(!afterBan.includes('/authors/view-b/'), '封禁后署名不应再链接作者页（降级纯文本）');
  assert.equal((await c.get('/authors/view-b/')).status, 302, '封禁作者页停止生成');

  c.setSession(adminCookie);
  await c.post(`/api/users/${authorB.id}/ban`, {}); // 还原，避免影响后续用例
});

test('e2e：文集页集主署名与列表卡署名', async () => {
  if (!HAS_BUILD) return;
  await setup();
  const postSlug = 'view-col-post';
  c.setSession(authorA.cookie);
  const created = await c.post('/api/posts', {
    collection_id: (await c.sql('SELECT id FROM collections WHERE slug = ?', colSlug)).results[0]?.id as number,
    title: '集内之篇',
    slug: postSlug,
    status: 'published',
    authors: [authorA.id],
  });
  assert.equal(created.status, 201);

  const html = await (await c.get(`/collections/${colSlug}/`)).text();
  assert.ok(html.includes('砚台甲'), '文集页应展示集主署名');
  assert.ok(html.includes('/authors/view-a/'), '集主应链接作者页');
  assert.ok(/byline/.test(html), '列表卡应渲染署名标记');
});

test('e2e：搜索页命中作者时展示作者分区', async () => {
  if (!HAS_BUILD) return;
  await setup();
  const html = await (await c.get('/search/?q=' + encodeURIComponent('砚台甲'))).text();
  assert.ok(html.includes('砚台甲'), '应命中作者');
  assert.ok(html.includes('/authors/view-a/'), '作者分区应链接作者页');
  assert.ok(html.includes('写山水的甲'), '作者分区应展示简介');
});
