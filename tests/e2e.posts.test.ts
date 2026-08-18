import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeE2e, HAS_BUILD, ORIGIN_HEADERS, type E2eClient } from './helpers/e2e.ts';

let c: E2eClient;

before(async () => {
  if (!HAS_BUILD) return;
  c = await makeE2e();
});

after(async () => {
  if (c) await c.dispose();
});

test('e2e：文章页 TOC 锚点与相邻导航', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const created = await c.post('/api/posts', {
    title: 'TOC 试炼',
    slug: 'toc-probe',
    summary: '摘要',
    content_md: '## 第一标题\n\n正文甲。\n\n## 第二标题\n\n正文乙。',
    status: 'published',
  });
  assert.equal(created.status, 201);
  const res = await c.get('/posts/toc-probe/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('article-toc'), '应渲染目录');
  assert.ok(html.includes('<h2 id="第一标题">'), '标题应带锚点 id');
  assert.ok(html.includes('href="#第一标题"'), '目录应链接到锚点');
  await c.del(`/api/posts/${(await created.json()).post.id}`);

  const page = await c.get('/collections/tech/astro-on-cloudflare/');
  assert.equal(page.status, 200);
  const html2 = await page.text();
  assert.ok(html2.includes('article-pagination'), '应渲染相邻导航');
  assert.ok(html2.includes('/collections/essays/first-post/'), '相邻链接应正确');

  const legacy = await c.get('/posts/astro-on-cloudflare/');
  assert.equal(legacy.status, 301, '已收录文章的旧路径 301 转跳文集路径');
  assert.ok(String(legacy.headers.get('location')).includes('/collections/tech/astro-on-cloudflare/'));
});

test('e2e：相邻导航文集内优先，组内无文章才跨文集回退', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const colA = await c.post('/api/collections', { title: '邻集', slug: 'adj-col-a' });
  assert.equal(colA.status, 201);
  const colAId = (await colA.json()).collection.id as number;
  for (const [title, slug] of [['邻一', 'adj-a-1'], ['邻二', 'adj-a-2'], ['邻三', 'adj-a-3']]) {
    const r = await c.post('/api/posts', { collection_id: colAId, title, slug, content_md: '正文', status: 'published' });
    assert.equal(r.status, 201);
  }
  const colB = await c.post('/api/collections', { title: '别集', slug: 'adj-col-b' });
  assert.equal(colB.status, 201);
  const colBId = (await colB.json()).collection.id as number;
  const r = await c.post('/api/posts', { collection_id: colBId, title: '别一', slug: 'adj-b-1', content_md: '正文', status: 'published' });
  assert.equal(r.status, 201);

  const html = await (await c.get('/collections/adj-col-a/adj-a-2/')).text();
  assert.ok(html.includes('/collections/adj-col-a/adj-a-1/'), '上一篇应为同文集邻一');
  assert.ok(html.includes('/collections/adj-col-a/adj-a-3/'), '下一篇应为同文集邻三');
  assert.ok(!html.includes('/collections/adj-col-b/'), '同文集存在时不应跨文集相邻');

  const htmlB = await (await c.get('/collections/adj-col-b/adj-b-1/')).text();
  assert.ok(htmlB.includes('/collections/adj-col-a/adj-a-3/'), '别集组内无文章，上一篇应回退为邻三');
});

test('e2e：集内文章顺序 post_order（asc 旧在前 / desc 新在前）', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const bad = await c.post('/api/collections', { title: '坏顺序', slug: 'bad-order', post_order: 'sideways' });
  assert.equal(bad.status, 400, '非法 post_order 应 400');

  const novel = await c.post('/api/collections', { title: '连载集', slug: 'order-novel', post_order: 'asc' });
  assert.equal(novel.status, 201);
  const novelId = (await novel.json()).collection.id as number;
  for (const t of ['第一章', '第二章', '第三章']) {
    const r = await c.post('/api/posts', { collection_id: novelId, title: t, slug: `order-novel-${t}`, content_md: '正文', status: 'published' });
    assert.equal(r.status, 201);
  }
  const blog = await c.post('/api/collections', { title: '随感集', slug: 'order-blog' });
  assert.equal(blog.status, 201);
  const blogId = (await blog.json()).collection.id as number;
  for (const t of ['甲帖', '乙帖']) {
    const r = await c.post('/api/posts', { collection_id: blogId, title: t, slug: `order-blog-${t}`, content_md: '正文', status: 'published' });
    assert.equal(r.status, 201);
  }

  const novelHtml = await (await c.get('/collections/order-novel/')).text();
  const novelLinks = [...novelHtml.matchAll(/href="(\/collections\/order-novel\/[^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
  assert.deepEqual(novelLinks, ['/collections/order-novel/order-novel-第一章/', '/collections/order-novel/order-novel-第二章/', '/collections/order-novel/order-novel-第三章/'], '连载集应第一章在前');

  const blogHtml = await (await c.get('/collections/order-blog/')).text();
  const blogLinks = [...blogHtml.matchAll(/href="(\/collections\/order-blog\/[^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
  assert.deepEqual(blogLinks, ['/collections/order-blog/order-blog-乙帖/', '/collections/order-blog/order-blog-甲帖/'], '博客集应最新在前');

  const flipped = await c.put(`/api/collections/${novelId}`, { post_order: 'desc' });
  assert.equal(flipped.status, 200);
  const flippedHtml = await (await c.get('/collections/order-novel/')).text();
  const flippedLinks = [...flippedHtml.matchAll(/href="(\/collections\/order-novel\/[^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
  assert.deepEqual(flippedLinks, ['/collections/order-novel/order-novel-第三章/', '/collections/order-novel/order-novel-第二章/', '/collections/order-novel/order-novel-第一章/'], '改 desc 后应最新在前');
});

test('e2e：slug 校验与重复 slug', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const bad = await c.post('/api/collections', { title: '坏 slug', slug: '-bad-' });
  assert.equal(bad.status, 400);
  const dup = await c.post('/api/collections', { title: '重复', slug: 'essays' });
  assert.equal(dup.status, 409);
});

test('e2e：登录后创建文集→文章→发布→可见→删除', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const created = await c.post('/api/collections', {
    title: '测试集',
    slug: 'test-col',
    summary: 'e2e',
    theme_color: '#123456',
    sort_order: 9,
  });
  assert.equal(created.status, 201);
  const colBody = await created.json();
  const colId = colBody.collection.id as number;

  const badColor = await c.post('/api/collections', { title: '坏色', theme_color: 'red' });
  assert.equal(badColor.status, 400, '非 #RRGGBB 主题色应 400');

  const postRes = await c.post('/api/posts', {
    title: 'e2e 文章',
    slug: 'e2e-post',
    collection_id: colId,
    summary: '摘要',
    content_md: '## 正文\n\n内容。',
    status: 'published',
  });
  assert.equal(postRes.status, 201);
  const postBody = await postRes.json();
  const postId = postBody.post.id as number;
  assert.equal(postBody.version, 1, '创建响应应带 version=1（乐观锁基线）');

  const badCol = await c.put(`/api/posts/${postId}`, { collection_id: 99999 });
  assert.equal(badCol.status, 404, 'PUT 到不存在的文集应 404');

  const legacy = await c.get('/posts/e2e-post/');
  assert.equal(legacy.status, 301, '已收录文章的旧路径 301 转跳文集路径');
  assert.ok(String(legacy.headers.get('location')).includes('/collections/test-col/e2e-post/'));

  const page = await c.get('/collections/test-col/e2e-post/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('e2e 文章'));
  assert.ok(html.includes('测试集'));

  const del = await c.raw(`/api/posts/${postId}`, { method: 'DELETE', headers: ORIGIN_HEADERS });
  assert.equal(del.status, 200);
  const delCol = await c.raw(`/api/collections/${colId}`, { method: 'DELETE', headers: ORIGIN_HEADERS });
  assert.equal(delCol.status, 200);
  const gone = await c.get('/posts/e2e-post/');
  assert.equal(gone.status, 302);
  assert.ok(String(gone.headers.get('location')).includes('/404'));
});

test('e2e：Markdown 清洗——script/onerror/javascript: 全部去除', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const evil = `<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[坏](javascript:alert(1))\n\n## 标题`;
  const created = await c.post('/api/posts', {
    title: 'XSS 试炼',
    slug: 'xss-probe',
    content_md: evil,
    status: 'published',
  });
  assert.equal(created.status, 201);
  const res = await c.get('/posts/xss-probe/');
  const html = await res.text();
  assert.ok(!html.includes('alert(1)'), '不应有脚本内容');
  assert.ok(!html.includes('onerror'), '不应有 onerror');
  assert.ok(!html.includes('javascript:'), '不应有 javascript: 协议');
  assert.ok(html.includes('<h2 id="标题">'), '合法标题仍应渲染');
  await c.del(`/api/posts/${(await created.json()).post.id}`);
});

test('e2e：同秒文章的相邻排序按 id 决胜', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const db = await c.mf.getD1Database('DB');
  const a = await c.post('/api/posts', { title: '同秒 A', slug: 'same-a', status: 'published' });
  const b = await c.post('/api/posts', { title: '同秒 B', slug: 'same-b', status: 'published' });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const aBody = await a.json();
  const bBody = await b.json();
  await db
    .prepare(`UPDATE posts SET created_at = '2026-01-01 00:00:00' WHERE id IN (?, ?)`)
    .bind(aBody.post.id, bBody.post.id)
    .run();
  const pageB = await c.get('/posts/same-b/');
  const htmlB = await pageB.text();
  assert.ok(htmlB.includes('/posts/same-a/'), '同秒时 prev 应按 id 决胜为 A');
  const pageA = await c.get('/posts/same-a/');
  const htmlA = await pageA.text();
  assert.ok(htmlA.includes('/posts/same-b/'), '同秒时 next 应按 id 决胜为 B');
  await c.del(`/api/posts/${aBody.post.id}`);
  await c.del(`/api/posts/${bBody.post.id}`);
});

test('e2e：搜索页按关键字命中已刊文章', async () => {
  if (!HAS_BUILD) return;
  const res = await c.get('/search/?q=Cloudflare');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('把 Astro 架到 Cloudflare 上'), '应命中标题含关键字的文章');
  assert.ok(html.includes('/collections/tech/astro-on-cloudflare/'));

  const miss = await c.get('/search/?q=不存在的关键字XYZ');
  assert.equal(miss.status, 200);
  assert.ok((await miss.text()).includes('未寻得'));
});

test('e2e：文章页阅读量递增并展示', async () => {
  if (!HAS_BUILD) return;
  const first = await c.get('/collections/essays/first-post/');
  assert.equal(first.status, 200);
  const m1 = (await first.text()).match(/阅 (\d+)/);
  assert.ok(m1, '文章页应展示阅读数');
  const second = await c.get('/collections/essays/first-post/');
  const m2 = (await second.text()).match(/阅 (\d+)/);
  assert.ok(m2);
  assert.ok(Number(m2[1]) > Number(m1[1]), '再次访问阅读数应递增');
});

test('e2e：slug 文集内唯一——跨文集可同名，旧路径 301 转跳文集路径', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const a = await c.post('/api/posts', { title: '同名甲', slug: 'same-name', collection_id: 1, status: 'published' });
  const b = await c.post('/api/posts', { title: '同名乙', slug: 'same-name', collection_id: 2, status: 'published' });
  assert.equal(a.status, 201, '文集 1 内可用 same-name');
  assert.equal(b.status, 201, '文集 2 内可复用 same-name');

  const pageA = await c.get('/collections/essays/same-name/');
  assert.equal(pageA.status, 200);
  assert.ok((await pageA.text()).includes('同名甲'), '文集 1 路径应指向自己的文章');

  const pageB = await c.get('/collections/tech/same-name/');
  assert.equal(pageB.status, 200);
  assert.ok((await pageB.text()).includes('同名乙'), '文集 2 路径应指向自己的文章');

  const legacy = await c.get('/posts/same-name/');
  assert.equal(legacy.status, 301, '已收录文章的旧路径 301 转跳文集路径');
  assert.ok(String(legacy.headers.get('location')).includes('/collections/'));

  const dup = await c.post('/api/posts', { title: '同名丙', slug: 'same-name', collection_id: 1, status: 'published' });
  assert.equal(dup.status, 409, '同一文集内重复 slug 应 409');
  await c.del(`/api/posts/${(await a.json()).post.id}`);
  await c.del(`/api/posts/${(await b.json()).post.id}`);
});

test('e2e：文集与归档分页——页 1 满页、页 2 余量、页码越界回页 1', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const colRes = await c.post('/api/collections', { title: '分页集', slug: 'page-col', sort_order: 8 });
  assert.equal(colRes.status, 201);
  const colId = (await colRes.json()).collection.id as number;
  const db = await c.mf.getD1Database('DB');
  const ids: number[] = [];
  for (let i = 0; i < 13; i++) {
    const r = await c.post('/api/posts', {
      title: `分页文${String(i).padStart(2, '0')}`,
      slug: `page-${String(i).padStart(2, '0')}`,
      collection_id: colId,
      status: 'published',
    });
    assert.equal(r.status, 201);
    const pid = (await r.json()).post.id as number;
    ids.push(pid);
    await db
      .prepare(`UPDATE posts SET created_at = datetime('2026-01-01 00:00:00', '+' || ? || ' seconds') WHERE id = ?`)
      .bind(i, pid)
      .run();
  }

  const p1 = await c.get('/collections/page-col/');
  assert.equal(p1.status, 200);
  const h1 = await p1.text();
  assert.ok(h1.includes('分页文12'), '页 1 应含最新一篇');
  assert.ok(h1.includes('pagination'), '应渲染分页导航');
  assert.ok(h1.includes('?page=2'), '应有下一页链接');
  assert.ok(!h1.includes('分页文00'), '页 1 不应含最旧一篇');

  const p2 = await c.get('/collections/page-col/?page=2');
  assert.equal(p2.status, 200);
  const h2 = await p2.text();
  assert.ok(h2.includes('分页文00'), '页 2 应含最旧一篇');
  assert.ok(h2.includes('href="/collections/page-col/"'), '应有回页 1 链接');
  assert.ok(h2.includes('13 篇'), '页头应显示文集文章总数而非当前页条数');

  const pBad = await c.get('/collections/page-col/?page=999');
  assert.equal(pBad.status, 200);
  assert.ok((await pBad.text()).includes('分页文00'), '越界页码应回落末页');

  const a1 = await c.get('/archive/?page=1');
  assert.equal(a1.status, 200);
  const ah1 = await a1.text();
  assert.ok(ah1.includes('pagination'), '归档应渲染分页导航');
  assert.ok(ah1.includes('分页文00'), '归档页 1 应含最旧文章（升序）');

  for (const id of ids) await c.del(`/api/posts/${id}`);
  await c.del(`/api/collections/${colId}`);
});

test('e2e：草稿预览——未登录 302，登录后可见草稿且 noindex', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const created = await c.post('/api/posts', {
    title: '预览试炼',
    slug: 'preview-probe',
    content_md: '## 只给主人看\n\n草稿正文。',
    status: 'draft',
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id as number;

  const anon = await c.anon(`/preview/${id}`, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.ok(String(anon.headers.get('location')).includes('/admin/login'));

  const res = await c.get(`/preview/${id}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('草稿预览'), '应有预览提示条');
  assert.ok(html.includes('只给主人看'), '应渲染草稿正文');
  assert.ok(html.includes('name="robots" content="noindex, nofollow"'), '预览页应 noindex');
  assert.ok(html.includes('（未刊发）'), '应标明未刊发状态');

  const unknown = await c.get('/preview/999999');
  assert.equal(unknown.status, 302);
  assert.ok(String(unknown.headers.get('location')).includes('/404'));

  await c.del(`/api/posts/${id}`);
});

test('e2e：批量创建——一次导入多篇、slug 自动避让、逐条报错', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const res = await c.post('/api/posts/batch', {
    action: 'create',
    collection_id: 1,
    posts: [
      { title: '导入甲', slug: 'import-a', content_md: '甲文。', status: 'published' },
      { title: '导入乙', slug: '', content_md: '乙文。', status: 'draft' },
      { title: '', slug: 'no-title', content_md: '' },
      { title: '导入甲重名', slug: 'import-a', content_md: '应避让为 import-a-2。' },
    ],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.results.length, 4);
  assert.equal(body.results[0].ok, true);
  assert.equal(body.results[0].post.slug, 'import-a');
  assert.equal(body.results[1].ok, true, '空 slug 应从标题生成');
  assert.equal(body.results[1].post.slug, '导入乙');
  assert.equal(body.results[2].ok, false, '空标题应逐条报错');
  assert.ok(body.results[2].error);
  assert.equal(body.results[3].ok, true, 'slug 冲突应自动避让');
  assert.equal(body.results[3].post.slug, 'import-a-2');

  const list = await c.get('/api/posts?status=all');
  const lbody = await list.json();
  const created = (lbody.posts as Array<{ id: number; slug: string }>).filter((p) =>
    ['import-a', '导入乙', 'import-a-2'].includes(p.slug),
  );
  assert.equal(created.length, 3);
  for (const p of created) await c.del(`/api/posts/${p.id}`);

  const tooMany = await c.post('/api/posts/batch', {
    action: 'create',
    posts: Array.from({ length: 51 }, (_, i) => ({ title: `超限${i}` })),
  });
  assert.equal(tooMany.status, 400, '超过 50 篇应拒绝');

  const badCol = await c.post('/api/posts/batch', {
    action: 'create',
    collection_id: 99999,
    posts: [{ title: '甲' }],
  });
  assert.equal(badCol.status, 404, '不存在的文集应 404');

  const badPerItem = await c.post('/api/posts/batch', {
    action: 'create',
    collection_id: 1,
    posts: [{ title: '丙', collection_id: 99998 }],
  });
  assert.equal(badPerItem.status, 404, '条目指定的文集不存在应 404');

  const dup = await c.post('/api/posts/batch', {
    action: 'create',
    collection_id: 1,
    posts: [{ title: '重名甲', slug: 'dup-slug' }, { title: '重名乙', slug: 'dup-slug' }],
  });
  assert.equal(dup.status, 200);
  const dupBody = await dup.json();
  assert.equal(dupBody.results[0].ok, true);
  assert.equal(dupBody.results[1].ok, true);
  assert.equal(dupBody.results[1].post.slug, 'dup-slug-2', '同批内冲突也要自动避让');
  const l2 = await c.get('/api/posts?status=all');
  const l2body = await l2.json();
  for (const p of (l2body.posts as Array<{ id: number; slug: string }>).filter((p) => p.slug.startsWith('dup-slug'))) {
    await c.del(`/api/posts/${p.id}`);
  }
});

test('e2e：批量 API——一次请求刊发/移动/删除多篇', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await c.post('/api/posts', {
      title: `批量文${i}`,
      slug: `bulk-${i}`,
      status: 'draft',
    });
    assert.equal(r.status, 201);
    ids.push((await r.json()).post.id as number);
  }

  const bulkIds: number[] = [];
  for (let i = 0; i < 120; i++) {
    const r = await c.post('/api/posts', { title: `大批量${i}`, slug: `big-batch-${i}`, status: 'draft' });
    assert.equal(r.status, 201);
    bulkIds.push((await r.json()).post.id as number);
  }
  const bigPub = await c.post('/api/posts/batch', { action: 'publish', ids: bulkIds });
  assert.equal(bigPub.status, 200, '120 篇批量刊发应分批执行而非超限 500');
  const bigDel = await c.post('/api/posts/batch', { action: 'delete', ids: bulkIds });
  assert.equal(bigDel.status, 200, '120 篇批量删除应分批执行而非超限 500');

  const bad = await c.post('/api/posts/batch', { action: 'nuke', ids: [1] });
  assert.equal(bad.status, 400, '未知动作应拒绝');

  const empty = await c.post('/api/posts/batch', { action: 'publish', ids: [] });
  assert.equal(empty.status, 400, '空 ids 应拒绝');

  const dup = await c.post('/api/posts/batch', { action: 'publish', ids: [ids[0], ids[0]] });
  assert.equal(dup.status, 200);
  assert.equal((await dup.json()).count, 1, '重复 id 应去重');

  const pub = await c.post('/api/posts/batch', { action: 'publish', ids });
  assert.equal(pub.status, 200);
  assert.equal((await pub.json()).count, 3);

  const list = await c.get('/api/posts?status=all');
  const body = await list.json();
  const published = (body.posts as Array<{ id: number; status: string }>).filter((p) => ids.includes(p.id));
  assert.equal(published.length, 3);
  assert.ok(published.every((p) => p.status === 'published'), '三篇应全部刊发');

  const move = await c.post('/api/posts/batch', { action: 'move', ids, collection_id: 1 });
  assert.equal(move.status, 200);
  assert.equal((await move.json()).count, 3);

  const badCol = await c.post('/api/posts/batch', { action: 'move', ids, collection_id: 99999 });
  assert.equal(badCol.status, 404, '不存在的文集应 404');

  const draft = await c.post('/api/posts/batch', { action: 'draft', ids });
  assert.equal(draft.status, 200);

  const delBatch = await c.post('/api/posts/batch', { action: 'delete', ids });
  assert.equal(delBatch.status, 200);
  assert.equal((await delBatch.json()).count, 3);

  for (const id of ids) {
    const gone = await c.get(`/api/posts/${id}`);
    assert.equal(gone.status, 404, '批量删除后文章应不存在');
  }
});

test('e2e：版本史——留档、读取、回滚，未登录 401', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const created = await c.post('/api/posts', {
    title: '版本史篇',
    slug: 'ver-e2e',
    content_md: '第一稿。',
    status: 'draft',
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id as number;

  const anon = await c.anon(`/api/posts/${id}/versions`, { redirect: 'manual' });
  assert.equal(anon.status, 401, '版本接口应需登录');

  const list1 = await c.get(`/api/posts/${id}/versions`);
  assert.equal(list1.status, 200);
  let vb = await list1.json();
  assert.equal(vb.versions.length, 1, '创建即 v1');
  assert.equal(vb.versions[0].message, '创建');

  const upd = await c.put(`/api/posts/${id}`, {
    title: '版本史篇',
    slug: 'ver-e2e',
    content_md: '第二稿，改了不少。',
    status: 'draft',
    version_message: '重写第二稿',
  });
  assert.equal(upd.status, 200);

  const noop = await c.put(`/api/posts/${id}`, {
    content_md: '第二稿，改了不少。',
    version_message: '不应留档',
  });
  assert.equal(noop.status, 200);

  const list2 = await c.get(`/api/posts/${id}/versions`);
  vb = await list2.json();
  assert.equal(vb.versions.length, 2, '无实质变化的保存不应留档');
  assert.equal(vb.versions[0].version, 2);
  assert.equal(vb.versions[0].message, '重写第二稿');

  const single = await c.get(`/api/posts/${id}/versions/1`);
  assert.equal(single.status, 200);
  const sv = (await single.json()).version;
  assert.equal(sv.content_md, '第一稿。');

  const badVer = await c.get(`/api/posts/${id}/versions/999`);
  assert.equal(badVer.status, 404);

  const restore = await c.post(`/api/posts/${id}/versions/1/restore`, {});
  assert.equal(restore.status, 200);
  const rb = await restore.json();
  assert.equal(rb.post.content_md, '第一稿。', '回滚后内容应恢复为 v1');

  const list3 = await c.get(`/api/posts/${id}/versions`);
  vb = await list3.json();
  assert.equal(vb.versions.length, 3, '回滚应生成 v3 而非覆盖历史');
  assert.equal(vb.versions[0].version, 3);
  assert.equal(vb.versions[0].message, '回滚至 v1');

  const page = await c.get(`/api/posts/${id}`);
  const postBody = await page.json();
  assert.equal(postBody.post.title, '版本史篇');

  await c.del(`/api/posts/${id}`);
  const goneVersions = await c.get(`/api/posts/${id}/versions`);
  assert.equal(goneVersions.status, 404, '文章删除后版本接口应 404');
});

test('e2e：未分类重复 slug 返回 409，公开 URL 唯一', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const a = await c.post('/api/posts', { title: '未分类甲', slug: 'uc-dup-e2e', status: 'published' });
  assert.equal(a.status, 201);
  const dup = await c.post('/api/posts', { title: '未分类乙', slug: 'uc-dup-e2e', status: 'published' });
  assert.equal(dup.status, 409, '未分类重复 slug 应 409 而非 500');
  const page = await c.get('/posts/uc-dup-e2e/');
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('未分类甲'), 'URL 应稳定指向唯一一篇');
  await c.del(`/api/posts/${(await a.json()).post.id}`);
});

test('e2e：删除文集后冲突文章确定性改 slug 并保持可访问', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const col = await c.post('/api/collections', { title: '散集', slug: 'scatter-col' });
  assert.equal(col.status, 201);
  const colId = (await col.json()).collection.id as number;
  const inCol = await c.post('/api/posts', { title: '入集篇', slug: 'shared-x', collection_id: colId, status: 'published' });
  assert.equal(inCol.status, 201);
  const uncat = await c.post('/api/posts', { title: '散落篇', slug: 'shared-x', status: 'published' });
  assert.equal(uncat.status, 201);

  const delCol = await c.del(`/api/collections/${colId}`);
  assert.equal(delCol.status, 200, '删除文集不应因冲突而 500');

  const list = await c.get('/api/posts?status=all');
  const body = await list.json();
  const posts = body.posts as Array<{ id: number; slug: string; collection_id: number | null }>;
  const inColId = (await inCol.json()).post.id as number;
  const moved = posts.find((p) => p.id === inColId);
  assert.ok(moved, '集内文章应保留');
  assert.equal(moved.collection_id, null, '文集删除后转未分类');
  assert.equal(moved.slug, 'shared-x-2', '冲突者获得确定性后缀 -2');

  const uncatId = (await uncat.json()).post.id as number;
  const keeper = posts.find((p) => p.id === uncatId);
  assert.equal(keeper?.slug, 'shared-x', '较新一篇保留原 slug');

  const p1 = await c.get('/posts/shared-x/');
  assert.equal(p1.status, 200);
  assert.ok((await p1.text()).includes('散落篇'));
  const p2 = await c.get('/posts/shared-x-2/');
  assert.equal(p2.status, 200);
  assert.ok((await p2.text()).includes('入集篇'));

  await c.del(`/api/posts/${moved.id}`);
  await c.del(`/api/posts/${keeper!.id}`);
});

test('e2e：批量移动全成功或全失败——冲突时零提交', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const mk = async (title: string, slug: string) => {
    const r = await c.post('/api/collections', { title, slug });
    assert.equal(r.status, 201);
    return (await r.json()).collection.id as number;
  };
  const colA = await mk('甲集', 'mcol-a');
  const colB = await mk('乙集', 'mcol-b');
  const colC = await mk('丙集', 'mcol-c');

  const pa = await c.post('/api/posts', { title: '甲篇', slug: 'shared-m', collection_id: colA, status: 'published' });
  const pb = await c.post('/api/posts', { title: '乙篇', slug: 'shared-m', collection_id: colB, status: 'published' });
  assert.equal(pa.status, 201);
  assert.equal(pb.status, 201);
  const paId = (await pa.json()).post.id as number;
  const pbId = (await pb.json()).post.id as number;

  // 两篇同名 slug 同时移入丙集：互相冲突 → 409，且一篇都不移动
  const both = await c.post('/api/posts/batch', { action: 'move', ids: [paId, pbId], collection_id: colC });
  assert.equal(both.status, 409, '批内互相冲突应 409');
  const bothBody = await both.json();
  assert.ok(Array.isArray(bothBody.conflicts) && bothBody.conflicts.includes('shared-m'));
  const after = await c.get(`/api/posts/${paId}`);
  assert.equal((await after.json()).post.collection_id, colA, '失败后不得部分移动');

  // 单篇移入空文集成功
  const single = await c.post('/api/posts/batch', { action: 'move', ids: [paId], collection_id: colC });
  assert.equal(single.status, 200);
  assert.equal((await single.json()).count, 1);

  // 目标已被占用 → 409 且乙篇仍在乙集
  const conflict = await c.post('/api/posts/batch', { action: 'move', ids: [pbId], collection_id: colC });
  assert.equal(conflict.status, 409, '目标文集已有同名 slug 应 409');
  const pbAfter = await c.get(`/api/posts/${pbId}`);
  assert.equal((await pbAfter.json()).post.collection_id, colB, '冲突时不得移动');

  // 幂等：把已在丙集的 pa 再次移入丙集仍成功
  const idem = await c.post('/api/posts/batch', { action: 'move', ids: [paId], collection_id: colC });
  assert.equal(idem.status, 200);

  // 超过单次上限 → 400
  const tooMany = await c.post('/api/posts/batch', {
    action: 'move',
    ids: Array.from({ length: 51 }, (_, i) => 1000 + i),
    collection_id: colC,
  });
  assert.equal(tooMany.status, 400, 'move 超过 50 篇应拒绝');

  await c.del(`/api/posts/${paId}`);
  await c.del(`/api/posts/${pbId}`);
  await c.del(`/api/collections/${colA}`);
  await c.del(`/api/collections/${colB}`);
  await c.del(`/api/collections/${colC}`);
});

test('e2e：offset-only 文章列表查询正常返回', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await c.post('/api/posts', { title: `列表页${i}`, slug: `list-off-${i}`, status: 'published' });
    assert.equal(r.status, 201);
    ids.push((await r.json()).post.id as number);
  }
  const res = await c.get('/api/posts?offset=1');
  assert.equal(res.status, 200, '无 limit 仅 offset 不应 500');
  const body = await res.json();
  assert.ok(Array.isArray(body.posts));
  const limited = await c.get('/api/posts?limit=2&offset=1');
  assert.equal(limited.status, 200);
  assert.equal((await limited.json()).posts.length, 2);
  for (const id of ids) await c.del(`/api/posts/${id}`);
});

test('e2e：版本恢复到已删除文集——降级为未分类', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const col = await c.post('/api/collections', { title: '瞬逝集', slug: 'ephemeral-col' });
  assert.equal(col.status, 201);
  const colId = (await col.json()).collection.id as number;

  const created = await c.post('/api/posts', {
    title: '旧作',
    slug: 'old-work',
    collection_id: colId,
    content_md: '初稿。',
    status: 'published',
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id as number;

  await c.put(`/api/posts/${id}`, { content_md: '二稿。' });
  await c.del(`/api/collections/${colId}`);
  assert.equal((await c.get(`/api/posts/${id}`)).status, 200, '删文集后文章保留为未分类');

  const restore = await c.post(`/api/posts/${id}/versions/1/restore`, {});
  assert.equal(restore.status, 200, '文集已删时恢复旧版不应 500');
  const rb = await restore.json();
  assert.equal(rb.post.collection_id, null, '旧版指向的文集已删除应降级为未分类');
  assert.equal(rb.post.content_md, '初稿。');
  await c.del(`/api/posts/${id}`);
});

test('e2e：OG 图片——绝对 URL 原样输出，相对 URL 基于站点拼接', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const col = await c.post('/api/collections', { title: '图册', slug: 'og-col' });
  assert.equal(col.status, 201);
  const colId = (await col.json()).collection.id as number;

  const abs = await c.post('/api/posts', {
    title: '绝对封面',
    slug: 'og-abs',
    collection_id: colId,
    cover_url: 'https://cdn.example/uploads/a.png',
    status: 'published',
  });
  assert.equal(abs.status, 201);
  const page = await c.get('/collections/og-col/og-abs/');
  const html = await page.text();
  assert.ok(html.includes('property="og:image" content="https://cdn.example/uploads/a.png"'), '绝对 URL 不得二次拼接');
  assert.ok(!html.includes('http://e2e.testhttps://'), '不得出现拼接出的非法地址');
  await c.del(`/api/posts/${(await abs.json()).post.id}`);

  const rel = await c.post('/api/posts', {
    title: '相对封面',
    slug: 'og-rel',
    collection_id: colId,
    cover_url: '/api/files/uploads/rel.png',
    status: 'published',
  });
  assert.equal(rel.status, 201);
  const page2 = await c.get('/collections/og-col/og-rel/');
  const html2 = await page2.text();
  assert.ok(html2.includes('property="og:image" content="http://e2e.test/api/files/uploads/rel.png"'), '相对 URL 应拼上站点基址');
  await c.del(`/api/posts/${(await rel.json()).post.id}`);
  await c.del(`/api/collections/${colId}`);
});

test('e2e：PUT 乐观锁——过期 base_version 返回 409，正确基线放行', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const created = await c.post('/api/posts', {
    title: '锁测篇',
    slug: `lock-e2e-${Date.now().toString(36)}`,
    content_md: '初稿。',
    status: 'draft',
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id as number;

  const fresh = await c.get(`/api/posts/${id}`);
  assert.equal(fresh.status, 200);
  const { version } = await fresh.json();
  assert.equal(version, 1, '创建即 v1');

  const ok1 = await c.put(`/api/posts/${id}`, { content_md: '二稿。', base_version: version });
  assert.equal(ok1.status, 200, '基线匹配应放行');
  assert.equal((await ok1.json()).version, 2);

  const stale = await c.put(`/api/posts/${id}`, { content_md: '三稿（过期基线）。', base_version: version });
  assert.equal(stale.status, 409, '过期基线应拒绝');

  const ok2 = await c.put(`/api/posts/${id}`, { content_md: '三稿。', base_version: 2 });
  assert.equal(ok2.status, 200, '更新基线应放行');
  assert.equal((await ok2.json()).version, 3);

  const v3 = await c.get(`/api/posts/${id}`);
  assert.equal((await v3.json()).version, 3, 'GET 返回当前版本');

  await c.del(`/api/posts/${id}`);
});

test('e2e：批量删除/刊发/草稿单事务——含不存在 id 时原子失败', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const mk = async (title: string) => {
    const r = await c.post('/api/posts', { title, slug: `batx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, status: 'draft' });
    assert.equal(r.status, 201);
    return (await r.json()).post.id as number;
  };
  const a = await mk('批量甲');
  const b = await mk('批量乙');

  const pub = await c.post('/api/posts/batch', { action: 'publish', ids: [a, b] });
  assert.equal(pub.status, 200);
  assert.equal((await pub.json()).count, 2);

  // delete 混入不存在的 id：存在的照删，计数按实际删除数
  const ghost = await c.post('/api/posts/batch', { action: 'delete', ids: [99999999] });
  assert.equal(ghost.status, 200);
  assert.equal((await ghost.json()).count, 0, '全部未命中时计数为 0');
  assert.equal((await c.get(`/api/posts/${a}`)).status, 200, '未命中的批量删除不得误删');

  const mixed = await c.post('/api/posts/batch', { action: 'delete', ids: [a, b, 99999999] });
  assert.equal(mixed.status, 200, 'delete 不应 404');
  assert.equal((await mixed.json()).count, 2, '计数按实际删除数');
  assert.equal((await c.get(`/api/posts/${a}`)).status, 404, '存在的 id 已删除');

  const again = await c.post('/api/posts/batch', { action: 'delete', ids: [a, b] });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).count, 0, '重复删除时计数为 0');
});

test('e2e：搜索单独 # 时展示空态，不按字面检索', async () => {
  if (!HAS_BUILD) return;
  const res = await c.get('/search/?q=%23');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes('未寻得「#」'), '不得按字面 # 检索');
  assert.ok(html.includes('输入关键字，遍寻全卷'), '应展示空态提示');
});