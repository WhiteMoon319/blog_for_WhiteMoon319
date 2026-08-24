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

test('e2e：RSS 订阅源只含已发布未删除文章，XML 转义正确，按时间倒序', async () => {
  if (!HAS_BUILD) return;
  await c.login();

  const special = await c.post('/api/posts', {
    title: 'RSS 试炼 <&> 引号"',
    slug: 'rss-probe',
    summary: '含 <特殊> & 字符的摘要',
    content_md: '正文',
    status: 'published',
  });
  assert.equal(special.status, 201);
  const specialId = (await special.json()).post.id;

  const draft = await c.post('/api/posts', {
    title: 'RSS 草稿',
    slug: 'rss-draft',
    content_md: '未发表',
    status: 'draft',
  });
  assert.equal(draft.status, 201);
  const draftId = (await draft.json()).post.id;

  const feed = await c.get('/feed.xml');
  assert.equal(feed.status, 200);
  assert.ok(feed.headers.get('content-type')?.includes('application/rss+xml'), '应为 rss+xml 类型');
  assert.ok(feed.headers.get('cache-control')?.includes('max-age'), '应允许短时间缓存');
  const xml = await feed.text();

  assert.ok(xml.includes('<guid isPermaLink="true">http://e2e.test/posts/rss-probe/</guid>'), 'guid 应为文章绝对 URL');
  assert.ok(xml.includes('RSS 试炼 &lt;&amp;&gt; 引号&quot;'), '标题特殊字符应转义');
  assert.ok(xml.includes('含 <特殊> & 字符的摘要'), '摘要特殊字符应转义');
  assert.ok(xml.includes('http://e2e.test/posts/rss-probe/'), '应含绝对链接');
  assert.ok(xml.includes('<atom:link'), '应声明 atom self 链接');
  assert.ok(!xml.includes('RSS 草稿'), '草稿不应进订阅源');

  const indexOfMine = xml.indexOf('RSS 试炼');
  const indexOfSeed = xml.indexOf('第一篇：博客开张');
  assert.ok(indexOfMine !== -1 && indexOfSeed !== -1, '新老文章都应出现');
  assert.ok(indexOfMine < indexOfSeed, '新文应排在前（按发布时间倒序）');

  await c.del(`/api/posts/${specialId}`);
  await c.del(`/api/posts/${draftId}`);
  const afterTrash = await c.get('/feed.xml');
  const xml2 = await afterTrash.text();
  assert.ok(!xml2.includes('rss-probe'), '移入回收站的文章不应再进订阅源');
});

test('e2e：文章页渲染 meta keywords 与安全 JSON-LD（BlogPosting）', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const created = await c.post('/api/posts', {
    title: 'JSON-LD 试炼',
    slug: 'jsonld-probe',
    summary: '摘要包含 </script> 与引号"',
    content_md: '## 正文\n\n内容。',
    meta_keywords: '测试, 序列化, 转义',
    status: 'published',
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id;

  const res = await c.get('/posts/jsonld-probe/');
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.ok(html.includes('<meta name="keywords" content="测试, 序列化, 转义"'), '应渲染 keywords 元信息');
  const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.ok(script.includes('"@type":"BlogPosting"'), '应输出 BlogPosting');
  assert.ok(script.includes('"headline":"JSON-LD 试炼"'), '应含标题');
  assert.ok(script.includes('"keywords":"测试, 序列化, 转义"'), '应含关键词');
  assert.ok(!script.includes('</script>'), 'JSON-LD 内容区不得包含闭合 script 标签');
  assert.ok(script.includes('\\u003c/script>'), '摘要中的 </script> 应被转义');
  assert.ok(script.includes('http://e2e.test/posts/jsonld-probe/'), '应含 canonical URL');

  await c.del(`/api/posts/${id}`);
});

test('e2e：文集页输出 CollectionPage JSON-LD', async () => {
  if (!HAS_BUILD) return;
  const res = await c.get('/collections/essays/');
  assert.equal(res.status, 200);
  const html = await res.text();
  const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.ok(script.includes('"@type":"CollectionPage"'), '应输出 CollectionPage');
  assert.ok(script.includes('"name":"随笔"'), '应含文集名');
  assert.ok(script.includes('http://e2e.test/collections/essays/'), '应含文集 URL');
  assert.ok(script.includes('"@type":"ListItem"'), '应列举文集内文章');
});
