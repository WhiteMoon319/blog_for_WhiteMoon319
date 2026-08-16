import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { XMLValidator, XMLParser } from 'fast-xml-parser';

const SERVER_DIR = resolve('dist/server');

function loadModules(): Record<string, { type: 'esm'; contents: string }> {
  const modules: Record<string, { type: 'esm'; contents: string }> = {};
  for (const file of ['entry.mjs', 'virtual_astro_middleware.mjs']) {
    modules[file] = { type: 'esm', contents: readFileSync(resolve(SERVER_DIR, file), 'utf8') };
  }
  for (const f of readdirSync(resolve(SERVER_DIR, 'chunks'))) {
    modules[`chunks/${f}`] = { type: 'esm', contents: readFileSync(resolve(SERVER_DIR, 'chunks', f), 'utf8') };
  }
  return modules;
}

function readStatements(file: string): string[] {
  const src = readFileSync(resolve(file), 'utf8');
  const statements: string[] = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'") {
      if (inStr && src[i + 1] === "'") {
        cur += "''";
        i++;
        continue;
      }
      inStr = !inStr;
      cur += ch;
      continue;
    }
    if (ch === ';' && !inStr) {
      const s = cur
        .split('\n')
        .filter((l) => !/^\s*--/.test(l))
        .join('\n')
        .trim();
      if (s.length > 0) statements.push(s);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const tail = cur
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n')
    .trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

const HAS_BUILD = existsSync(resolve(SERVER_DIR, 'entry.mjs'));

let mf: Miniflare;

async function boot(): Promise<void> {
  mf = new Miniflare({
    workers: [
      {
        config: {
          type: 'worker',
          name: 'e2e-blog',
          compatibilityDate: '2025-08-01',
          compatibilityFlags: ['nodejs_compat'],
          manifest: { mainModule: 'entry.mjs', modules: loadModules() },
          assets: {
            directory: resolve('dist/client'),
            runWorkerFirst: true,
            hasUserWorker: true,
            notFoundHandling: 'none',
          },
          env: {
            ASSETS: { type: 'assets' },
            DB: { type: 'd1', id: 'e2e-db' },
            IMAGES: { type: 'r2', name: 'e2e-images' },
            SESSION: { type: 'kv', id: 'e2e-session' },
            SITE_NAME: { type: 'json', value: '测试书斋' },
            SITE_SLOGAN: { type: 'json', value: '一角书斋' },
            SITE_POEM: { type: 'json', value: '晨起摊书卷。' },
            SITE_URL: { type: 'json', value: 'http://e2e.test' },
            SITE_URL: { type: 'json', value: 'http://e2e.test' },
            BLOG_ADMIN_PASSWORD: { type: 'json', value: 'admin123' },
            BLOG_SESSION_SECRET: { type: 'json', value: 'e2e-secret-0123456789abcdef0123456789abcdef' },
            R2_PUBLIC_URL: { type: 'json', value: '' },
            LOGIN_RATE_LIMIT_MAX: { type: 'json', value: 10 },
            LOGIN_RATE_LIMIT_WINDOW: { type: 'json', value: 300 },
          },
        },
      },
    ],
  });
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync(resolve('db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of readStatements(`db/migrations/${file}`)) {
      await db.prepare(stmt).run();
    }
  }
  for (const stmt of readStatements('db/seed.sql')) {
    await db.prepare(stmt).run();
  }
}

const BASE = 'http://e2e.test';
let cookie = '';

const originHeaders = { Origin: BASE, 'Sec-Fetch-Site': 'same-origin' };

function multipartBody(files: Array<{ name: string; filename: string; type: string; bytes: Uint8Array }>): {
  body: Uint8Array;
  contentType: string;
} {
  const boundary = `----e2eBoundary${Math.random().toString(36).slice(2)}`;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const f of files) {
    parts.push(
      enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`,
      ),
    );
    parts.push(f.bytes);
    parts.push(enc.encode('\r\n'));
  }
  parts.push(enc.encode(`--${boundary}--\r\n`));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    body.set(p, off);
    off += p.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function del(path: string): Promise<Response> {
  return mf.dispatchFetch(BASE + path, { method: 'DELETE', headers: { cookie, ...originHeaders } });
}

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return mf.dispatchFetch(BASE + path, {
    redirect: 'manual',
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
  });
}

async function post(path: string, body: unknown): Promise<Response> {
  return mf.dispatchFetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function put(path: string, body: unknown): Promise<Response> {
  return mf.dispatchFetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

before(async () => {
  if (!HAS_BUILD) return;
  await boot();
});

after(async () => {
  if (mf) await mf.dispose();
});

test('e2e：构建产物存在（先运行 npm run build）', () => {
  assert.ok(HAS_BUILD, 'dist/server/entry.mjs 缺失，请先 npm run build');
});

test('e2e：首页渲染文集与最新文章', async () => {
  if (!HAS_BUILD) return;
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('测试书斋'));
  assert.ok(html.includes('随笔'));
  assert.ok(html.includes('第一篇：博客开张'));
  assert.ok(html.includes('/collections/essays/first-post/'));
});

test('e2e：草稿文章对游客 302 至 /404', async () => {
  if (!HAS_BUILD) return;
  const res = await get('/collections/essays/draft-post/');
  assert.equal(res.status, 302);
  assert.ok(String(res.headers.get('location')).includes('/404'));
});

test('e2e：admin SPA 回退路由 200（含 no-store 与 noindex）', async () => {
  if (!HAS_BUILD) return;
  for (const path of ['/admin/', '/admin/posts', '/admin/collections', '/admin/editor?id=1', '/admin/login']) {
    const res = await get(path);
    assert.equal(res.status, 200, `GET ${path} 应为 200`);
    const html = await res.text();
    assert.ok(html.includes('id="app"'), `${path} 应返回 SPA 外壳`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  }
});

test('e2e：admin SPA 静态资源以正确 MIME 返回（防白屏）', async () => {
  if (!HAS_BUILD) return;
  const shell = await get('/admin/');
  const html = await shell.text();
  const src = html.match(/(?:src|href)="(\/admin\/assets\/[^"]+\.(?:js|css))"/)?.[1];
  assert.ok(src, 'SPA 外壳应引用 admin 静态资源');
  const asset = await get(src);
  assert.equal(asset.status, 200, `${src} 应为 200`);
  assert.ok(
    String(asset.headers.get('content-type')).startsWith('text/javascript') ||
      String(asset.headers.get('content-type')).startsWith('text/css'),
    `${src} 不应返回 text/html`,
  );
});

test('e2e：未登录无法读草稿列表、无法写数据', async () => {
  if (!HAS_BUILD) return;
  const drafts = await get('/api/posts?status=draft');
  assert.equal(drafts.status, 401);
  const create = await post('/api/collections', { title: '不应创建', slug: 'x' });
  assert.equal(create.status, 401);
});

test('e2e：登录流程与限流', async () => {
  if (!HAS_BUILD) return;
  for (let i = 0; i < 4; i++) {
    const bad = await post('/api/auth/login', { password: 'wrong' });
    assert.equal(bad.status, 401);
  }
  const ok = await post('/api/auth/login', { password: 'admin123' });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie') ?? '';
  assert.ok(setCookie.includes('blog_session='), '应下发会话 cookie');
  cookie = setCookie.split(';')[0];
  const me = await get('/api/auth/me');
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.ok(meBody.authenticated === true);
  for (let i = 0; i < 7; i++) {
    await post('/api/auth/login', { password: 'wrong' });
  }
  const blocked = await post('/api/auth/login', { password: 'admin123' });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
});

test('e2e：文章页 TOC 锚点与相邻导航', async () => {
  if (!HAS_BUILD) return;
  const created = await post('/api/posts', {
    title: 'TOC 试炼',
    slug: 'toc-probe',
    summary: '摘要',
    content_md: '## 第一标题\n\n正文甲。\n\n## 第二标题\n\n正文乙。',
    status: 'published',
  });
  assert.equal(created.status, 201);
  const res = await get('/posts/toc-probe/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('article-toc'), '应渲染目录');
  assert.ok(html.includes('<h2 id="第一标题">'), '标题应带锚点 id');
  assert.ok(html.includes('href="#第一标题"'), '目录应链接到锚点');
  await del(`/api/posts/${(await created.json()).post.id}`);

  const page = await get('/collections/tech/astro-on-cloudflare/');
  assert.equal(page.status, 200);
  const html2 = await page.text();
  assert.ok(html2.includes('article-pagination'), '应渲染相邻导航');
  assert.ok(html2.includes('/collections/essays/first-post/'), '相邻链接应正确');

  const legacy = await get('/posts/astro-on-cloudflare/');
  assert.equal(legacy.status, 302, '已收录文章的旧路径 302 至 /404');
  assert.ok(String(legacy.headers.get('location')).includes('/404'));
});

test('e2e：slug 校验与重复 slug', async () => {
  if (!HAS_BUILD) return;
  const bad = await post('/api/collections', { title: '坏 slug', slug: '-bad-' });
  assert.equal(bad.status, 400);
  const dup = await post('/api/collections', { title: '重复', slug: 'essays' });
  assert.equal(dup.status, 409);
});

test('e2e：登录后创建文集→文章→发布→可见→删除', async () => {
  if (!HAS_BUILD) return;
  const created = await post('/api/collections', {
    title: '测试集',
    slug: 'test-col',
    summary: 'e2e',
    theme_color: '#123456',
    sort_order: 9,
  });
  assert.equal(created.status, 201);
  const colBody = await created.json();
  const colId = colBody.collection.id as number;

  const postRes = await post('/api/posts', {
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

  const legacy = await get('/posts/e2e-post/');
  assert.equal(legacy.status, 302, '已收录文章的旧路径 302 至 /404');
  assert.ok(String(legacy.headers.get('location')).includes('/404'));

  const page = await get('/collections/test-col/e2e-post/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('e2e 文章'));
  assert.ok(html.includes('测试集'));

  const del = await mf.dispatchFetch(BASE + `/api/posts/${postId}`, {
    method: 'DELETE',
    headers: { cookie, ...originHeaders },
  });
  assert.equal(del.status, 200);
  const delCol = await mf.dispatchFetch(BASE + `/api/collections/${colId}`, {
    method: 'DELETE',
    headers: { cookie, ...originHeaders },
  });
  assert.equal(delCol.status, 200);
  const gone = await get('/posts/e2e-post/');
  assert.equal(gone.status, 302);
});

test('e2e：Markdown 清洗——script/onerror/javascript: 全部去除', async () => {
  if (!HAS_BUILD) return;
  const evil = `<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[坏](javascript:alert(1))\n\n## 标题`;
  const created = await post('/api/posts', {
    title: 'XSS 试炼',
    slug: 'xss-probe',
    content_md: evil,
    status: 'published',
  });
  assert.equal(created.status, 201);
  const res = await get('/posts/xss-probe/');
  const html = await res.text();
  assert.ok(!html.includes('alert(1)'), '不应有脚本内容');
  assert.ok(!html.includes('onerror'), '不应有 onerror');
  assert.ok(!html.includes('javascript:'), '不应有 javascript: 协议');
  assert.ok(html.includes('<h2 id="标题">'), '合法标题仍应渲染');
  await del(`/api/posts/${(await created.json()).post.id}`);
});

test('e2e：上传白名单——PNG 通过、SVG 拒绝', async () => {
  if (!HAS_BUILD) return;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4]);
  const good = multipartBody([{ name: 'file', filename: 'a.png', type: 'image/png', bytes: png }]);
  const up = await mf.dispatchFetch(BASE + '/api/upload', {
    method: 'POST',
    headers: { cookie, ...originHeaders, 'Content-Type': good.contentType },
    body: good.body,
  });
  assert.equal(up.status, 201);
  const upBody = await up.json();
  assert.ok(String(upBody.key).endsWith('.png'));
  const fileRes = await get(`/api/files/${upBody.key}`);
  assert.equal(fileRes.status, 200);
  assert.equal(fileRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(fileRes.headers.get('content-type'), 'image/png');

  const svg = new Uint8Array([0x3c, 0x73, 0x76, 0x67]);
  const badForm = multipartBody([{ name: 'file', filename: 'b.svg', type: 'image/svg+xml', bytes: svg }]);
  const bad = await mf.dispatchFetch(BASE + '/api/upload', {
    method: 'POST',
    headers: { cookie, ...originHeaders, 'Content-Type': badForm.contentType },
    body: badForm.body,
  });
  assert.equal(bad.status, 415);
});

test('e2e：同秒文章的相邻排序按 id 决胜', async () => {
  if (!HAS_BUILD) return;
  const db = await mf.getD1Database('DB');
  const a = await post('/api/posts', { title: '同秒 A', slug: 'same-a', status: 'published' });
  const b = await post('/api/posts', { title: '同秒 B', slug: 'same-b', status: 'published' });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const aBody = await a.json();
  const bBody = await b.json();
  await db
    .prepare(`UPDATE posts SET created_at = '2026-01-01 00:00:00' WHERE id IN (?, ?)`)
    .bind(aBody.post.id, bBody.post.id)
    .run();
  const pageB = await get('/posts/same-b/');
  const htmlB = await pageB.text();
  assert.ok(htmlB.includes('/posts/same-a/'), '同秒时 prev 应按 id 决胜为 A');
  const pageA = await get('/posts/same-a/');
  const htmlA = await pageA.text();
  assert.ok(htmlA.includes('/posts/same-b/'), '同秒时 next 应按 id 决胜为 B');
  await del(`/api/posts/${aBody.post.id}`);
  await del(`/api/posts/${bBody.post.id}`);
});

test('e2e：搜索页按关键字命中已刊文章', async () => {
  if (!HAS_BUILD) return;
  const res = await get('/search/?q=Cloudflare');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('把 Astro 架到 Cloudflare 上'), '应命中标题含关键字的文章');
  assert.ok(html.includes('/collections/tech/astro-on-cloudflare/'));

  const miss = await get('/search/?q=不存在的关键字XYZ');
  assert.equal(miss.status, 200);
  assert.ok((await miss.text()).includes('未寻得'));
});

test('e2e：RSS 输出已刊文章与规范头', async () => {
  if (!HAS_BUILD) return;
  const res = await get('/rss.xml');
  assert.equal(res.status, 200);
  assert.ok(String(res.headers.get('content-type')).includes('application/rss+xml'));
  const xml = await res.text();
  assert.ok(xml.includes('<rss version="2.0"'));
  assert.ok(xml.includes('<item>'));
  assert.ok(xml.includes('<link>http://e2e.test/collections/essays/first-post/</link>'));
  assert.ok(!xml.includes('draft-post'), '草稿不应出现在 RSS');
});

test('e2e：sitemap 覆盖静态页、文集与文章', async () => {
  if (!HAS_BUILD) return;
  const res = await get('/sitemap.xml');
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.ok(xml.includes('<loc>http://e2e.test/archive/</loc>'));
  assert.ok(xml.includes('<loc>http://e2e.test/collections/essays/</loc>'));
  assert.ok(xml.includes('<loc>http://e2e.test/collections/tech/astro-on-cloudflare/</loc>'));
  assert.ok(!xml.includes('draft-post'));
});

test('e2e：404 页带站点样式，静态资源可达', async () => {
  if (!HAS_BUILD) return;
  const res = await get('/404');
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.ok(html.includes('此页不存'), '404 页应渲染站点文案');
  assert.ok(html.includes('/archive/'), '404 页应提供归档出口');

  const robots = await get('/robots.txt');
  assert.equal(robots.status, 200);
  assert.ok((await robots.text()).includes('sitemap.xml'));
  const og = await get('/og-default.png');
  assert.equal(og.status, 200);
  assert.ok(String(og.headers.get('content-type')).includes('image/png'));
});

test('e2e：文章页阅读量递增并展示', async () => {
  if (!HAS_BUILD) return;
  const first = await get('/collections/essays/first-post/');
  assert.equal(first.status, 200);
  const m1 = (await first.text()).match(/阅 (\d+)/);
  assert.ok(m1, '文章页应展示阅读数');
  const second = await get('/collections/essays/first-post/');
  const m2 = (await second.text()).match(/阅 (\d+)/);
  assert.ok(m2);
  assert.ok(Number(m2[1]) > Number(m1[1]), '再次访问阅读数应递增');
});

test('e2e：slug 文集内唯一——跨文集可同名，旧路径 302 至 /404', async () => {
  if (!HAS_BUILD) return;
  const a = await post('/api/posts', { title: '同名甲', slug: 'same-name', collection_id: 1, status: 'published' });
  const b = await post('/api/posts', { title: '同名乙', slug: 'same-name', collection_id: 2, status: 'published' });
  assert.equal(a.status, 201, '文集 1 内可用 same-name');
  assert.equal(b.status, 201, '文集 2 内可复用 same-name');

  const pageA = await get('/collections/essays/same-name/');
  assert.equal(pageA.status, 200);
  assert.ok((await pageA.text()).includes('同名甲'), '文集 1 路径应指向自己的文章');

  const pageB = await get('/collections/tech/same-name/');
  assert.equal(pageB.status, 200);
  assert.ok((await pageB.text()).includes('同名乙'), '文集 2 路径应指向自己的文章');

  const legacy = await get('/posts/same-name/');
  assert.equal(legacy.status, 302, '已收录文章的旧路径 302 至 /404');
  assert.ok(String(legacy.headers.get('location')).includes('/404'));

  const dup = await post('/api/posts', { title: '同名丙', slug: 'same-name', collection_id: 1, status: 'published' });
  assert.equal(dup.status, 409, '同一文集内重复 slug 应 409');
  await del(`/api/posts/${(await a.json()).post.id}`);
  await del(`/api/posts/${(await b.json()).post.id}`);
});

test('e2e：文集与归档分页——页 1 满页、页 2 余量、页码越界回页 1', async () => {
  if (!HAS_BUILD) return;
  const colRes = await post('/api/collections', { title: '分页集', slug: 'page-col', sort_order: 8 });
  assert.equal(colRes.status, 201);
  const colId = (await colRes.json()).collection.id as number;
  const db = await mf.getD1Database('DB');
  const ids: number[] = [];
  for (let i = 0; i < 13; i++) {
    const r = await post('/api/posts', {
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

  const p1 = await get('/collections/page-col/');
  assert.equal(p1.status, 200);
  const h1 = await p1.text();
  assert.ok(h1.includes('分页文12'), '页 1 应含最新一篇');
  assert.ok(h1.includes('pagination'), '应渲染分页导航');
  assert.ok(h1.includes('?page=2'), '应有下一页链接');
  assert.ok(!h1.includes('分页文00'), '页 1 不应含最旧一篇');

  const p2 = await get('/collections/page-col/?page=2');
  assert.equal(p2.status, 200);
  const h2 = await p2.text();
  assert.ok(h2.includes('分页文00'), '页 2 应含最旧一篇');
  assert.ok(h2.includes('href="/collections/page-col/"'), '应有回页 1 链接');
  assert.ok(h2.includes('13 篇'), '页头应显示文集文章总数而非当前页条数');

  const pBad = await get('/collections/page-col/?page=999');
  assert.equal(pBad.status, 200);
  assert.ok((await pBad.text()).includes('分页文00'), '越界页码应回落末页');

  const a1 = await get('/archive/?page=1');
  assert.equal(a1.status, 200);
  const ah1 = await a1.text();
  assert.ok(ah1.includes('pagination'), '归档应渲染分页导航');
  assert.ok(ah1.includes('分页文00'), '归档页 1 应含最旧文章（升序）');

  for (const id of ids) await del(`/api/posts/${id}`);
  await del(`/api/collections/${colId}`);
});

test('e2e：草稿预览——未登录 302，登录后可见草稿且 noindex', async () => {
  if (!HAS_BUILD) return;
  const created = await post('/api/posts', {
    title: '预览试炼',
    slug: 'preview-probe',
    content_md: '## 只给主人看\n\n草稿正文。',
    status: 'draft',
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id as number;

  const anon = await mf.dispatchFetch(BASE + `/preview/${id}`, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.ok(String(anon.headers.get('location')).includes('/admin/login'));

  const res = await get(`/preview/${id}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('草稿预览'), '应有预览提示条');
  assert.ok(html.includes('只给主人看'), '应渲染草稿正文');
  assert.ok(html.includes('name="robots" content="noindex, nofollow"'), '预览页应 noindex');
  assert.ok(html.includes('（未刊发）'), '应标明未刊发状态');

  const unknown = await get('/preview/999999');
  assert.equal(unknown.status, 302);
  assert.ok(String(unknown.headers.get('location')).includes('/404'));

  await del(`/api/posts/${id}`);
});

test('e2e：批量创建——一次导入多篇、slug 自动避让、逐条报错', async () => {
  if (!HAS_BUILD) return;
  const res = await post('/api/posts/batch', {
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

  const list = await get('/api/posts?status=all');
  const lbody = await list.json();
  const created = (lbody.posts as Array<{ id: number; slug: string }>).filter((p) =>
    ['import-a', '导入乙', 'import-a-2'].includes(p.slug),
  );
  assert.equal(created.length, 3);
  for (const p of created) await del(`/api/posts/${p.id}`);

  const tooMany = await post('/api/posts/batch', {
    action: 'create',
    posts: Array.from({ length: 51 }, (_, i) => ({ title: `超限${i}` })),
  });
  assert.equal(tooMany.status, 400, '超过 50 篇应拒绝');

  const badCol = await post('/api/posts/batch', {
    action: 'create',
    collection_id: 99999,
    posts: [{ title: '甲' }],
  });
  assert.equal(badCol.status, 404, '不存在的文集应 404');

  const dup = await post('/api/posts/batch', {
    action: 'create',
    collection_id: 1,
    posts: [{ title: '重名甲', slug: 'dup-slug' }, { title: '重名乙', slug: 'dup-slug' }],
  });
  assert.equal(dup.status, 200);
  const dupBody = await dup.json();
  assert.equal(dupBody.results[0].ok, true);
  assert.equal(dupBody.results[1].ok, true);
  assert.equal(dupBody.results[1].post.slug, 'dup-slug-2', '同批内冲突也要自动避让');
  const l2 = await get('/api/posts?status=all');
  const l2body = await l2.json();
  for (const p of (l2body.posts as Array<{ id: number; slug: string }>).filter((p) => p.slug.startsWith('dup-slug'))) {
    await del(`/api/posts/${p.id}`);
  }
});

test('e2e：媒体库——未登录 401，列表含已传文件，删除后文件 404', async () => {
  if (!HAS_BUILD) return;
  const anon = await mf.dispatchFetch(BASE + '/api/media', { redirect: 'manual' });
  assert.equal(anon.status, 401);

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4]);
  const form = multipartBody([{ name: 'file', filename: 'm.png', type: 'image/png', bytes: png }]);
  const up = await mf.dispatchFetch(BASE + '/api/upload', {
    method: 'POST',
    headers: { cookie, ...originHeaders, 'Content-Type': form.contentType },
    body: form.body,
  });
  assert.equal(up.status, 201);
  const key = (await up.json()).key as string;
  assert.ok(key.startsWith('uploads/'), '上传 key 应有 uploads/ 前缀');

  const list = await get('/api/media');
  assert.equal(list.status, 200);
  const listBody = await list.json();
  const found = (listBody.files as Array<{ key: string; url: string }>).some((f) => f.key === key);
  assert.ok(found, '媒体列表应包含刚上传的文件');
  assert.ok(String((listBody.files as Array<{ url: string }>)[0].url).includes('/api/files/'), '无 R2_PUBLIC_URL 时用站内路径');

  const bad = await del(`/api/media?key=${encodeURIComponent('etc/passwd')}`);
  assert.equal(bad.status, 400, '非 uploads/ 前缀应拒绝');

  const delRes = await del(`/api/media?key=${encodeURIComponent(key)}`);
  assert.equal(delRes.status, 200);
  const gone = await get(`/api/files/${key}`);
  assert.equal(gone.status, 404, '删除后文件应不可再取');
});

test('e2e：批量 API——一次请求刊发/移动/删除多篇', async () => {
  if (!HAS_BUILD) return;
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await post('/api/posts', {
      title: `批量文${i}`,
      slug: `bulk-${i}`,
      status: 'draft',
    });
    assert.equal(r.status, 201);
    ids.push((await r.json()).post.id as number);
  }

  const bad = await post('/api/posts/batch', { action: 'nuke', ids: [1] });
  assert.equal(bad.status, 400, '未知动作应拒绝');

  const empty = await post('/api/posts/batch', { action: 'publish', ids: [] });
  assert.equal(empty.status, 400, '空 ids 应拒绝');

  const dup = await post('/api/posts/batch', { action: 'publish', ids: [ids[0], ids[0]] });
  assert.equal(dup.status, 200);
  assert.equal((await dup.json()).count, 1, '重复 id 应去重');

  const pub = await post('/api/posts/batch', { action: 'publish', ids });
  assert.equal(pub.status, 200);
  assert.equal((await pub.json()).count, 3);

  const list = await get('/api/posts?status=all');
  const body = await list.json();
  const published = (body.posts as Array<{ id: number; status: string }>).filter((p) => ids.includes(p.id));
  assert.equal(published.length, 3);
  assert.ok(published.every((p) => p.status === 'published'), '三篇应全部刊发');

  const move = await post('/api/posts/batch', { action: 'move', ids, collection_id: 1 });
  assert.equal(move.status, 200);
  assert.equal((await move.json()).count, 3);

  const badCol = await post('/api/posts/batch', { action: 'move', ids, collection_id: 99999 });
  assert.equal(badCol.status, 404, '不存在的文集应 404');

  const draft = await post('/api/posts/batch', { action: 'draft', ids });
  assert.equal(draft.status, 200);

  const delBatch = await post('/api/posts/batch', { action: 'delete', ids });
  assert.equal(delBatch.status, 200);
  assert.equal((await delBatch.json()).count, 3);

  for (const id of ids) {
    const gone = await get(`/api/posts/${id}`);
    assert.equal(gone.status, 404, '批量删除后文章应不存在');
  }
});

test('e2e：版本史——留档、读取、回滚，未登录 401', async () => {
  if (!HAS_BUILD) return;
  const created = await post('/api/posts', {
    title: '版本史篇',
    slug: 'ver-e2e',
    content_md: '第一稿。',
    status: 'draft',
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id as number;

  const anon = await mf.dispatchFetch(BASE + `/api/posts/${id}/versions`, { redirect: 'manual' });
  assert.equal(anon.status, 401, '版本接口应需登录');

  const list1 = await get(`/api/posts/${id}/versions`);
  assert.equal(list1.status, 200);
  let vb = await list1.json();
  assert.equal(vb.versions.length, 1, '创建即 v1');
  assert.equal(vb.versions[0].message, '创建');

  const upd = await put(`/api/posts/${id}`, {
    title: '版本史篇',
    slug: 'ver-e2e',
    content_md: '第二稿，改了不少。',
    status: 'draft',
    version_message: '重写第二稿',
  });
  assert.equal(upd.status, 200);

  const noop = await put(`/api/posts/${id}`, {
    content_md: '第二稿，改了不少。',
    version_message: '不应留档',
  });
  assert.equal(noop.status, 200);

  const list2 = await get(`/api/posts/${id}/versions`);
  vb = await list2.json();
  assert.equal(vb.versions.length, 2, '无实质变化的保存不应留档');
  assert.equal(vb.versions[0].version, 2);
  assert.equal(vb.versions[0].message, '重写第二稿');

  const single = await get(`/api/posts/${id}/versions/1`);
  assert.equal(single.status, 200);
  const sv = (await single.json()).version;
  assert.equal(sv.content_md, '第一稿。');

  const badVer = await get(`/api/posts/${id}/versions/999`);
  assert.equal(badVer.status, 404);

  const restore = await post(`/api/posts/${id}/versions/1/restore`, {});
  assert.equal(restore.status, 200);
  const rb = await restore.json();
  assert.equal(rb.post.content_md, '第一稿。', '回滚后内容应恢复为 v1');

  const list3 = await get(`/api/posts/${id}/versions`);
  vb = await list3.json();
  assert.equal(vb.versions.length, 3, '回滚应生成 v3 而非覆盖历史');
  assert.equal(vb.versions[0].version, 3);
  assert.equal(vb.versions[0].message, '回滚至 v1');

  const page = await get(`/api/posts/${id}`);
  const postBody = await page.json();
  assert.equal(postBody.post.title, '版本史篇');

  await del(`/api/posts/${id}`);
  const goneVersions = await get(`/api/posts/${id}/versions`);
  assert.equal(goneVersions.status, 404, '文章删除后版本接口应 404');
});

test('e2e：未分类重复 slug 返回 409，公开 URL 唯一', async () => {
  if (!HAS_BUILD) return;
  const a = await post('/api/posts', { title: '未分类甲', slug: 'uc-dup-e2e', status: 'published' });
  assert.equal(a.status, 201);
  const dup = await post('/api/posts', { title: '未分类乙', slug: 'uc-dup-e2e', status: 'published' });
  assert.equal(dup.status, 409, '未分类重复 slug 应 409 而非 500');
  const page = await get('/posts/uc-dup-e2e/');
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('未分类甲'), 'URL 应稳定指向唯一一篇');
  await del(`/api/posts/${(await a.json()).post.id}`);
});

test('e2e：删除文集后冲突文章确定性改 slug 并保持可访问', async () => {
  if (!HAS_BUILD) return;
  const col = await post('/api/collections', { title: '散集', slug: 'scatter-col' });
  assert.equal(col.status, 201);
  const colId = (await col.json()).collection.id as number;
  const inCol = await post('/api/posts', { title: '入集篇', slug: 'shared-x', collection_id: colId, status: 'published' });
  assert.equal(inCol.status, 201);
  const uncat = await post('/api/posts', { title: '散落篇', slug: 'shared-x', status: 'published' });
  assert.equal(uncat.status, 201);

  const delCol = await del(`/api/collections/${colId}`);
  assert.equal(delCol.status, 200, '删除文集不应因冲突而 500');

  const list = await get('/api/posts?status=all');
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

  const p1 = await get('/posts/shared-x/');
  assert.equal(p1.status, 200);
  assert.ok((await p1.text()).includes('散落篇'));
  const p2 = await get('/posts/shared-x-2/');
  assert.equal(p2.status, 200);
  assert.ok((await p2.text()).includes('入集篇'));

  await del(`/api/posts/${moved.id}`);
  await del(`/api/posts/${keeper!.id}`);
});

test('e2e：批量移动全成功或全失败——冲突时零提交', async () => {
  if (!HAS_BUILD) return;
  const mk = async (title: string, slug: string) => {
    const r = await post('/api/collections', { title, slug });
    assert.equal(r.status, 201);
    return (await r.json()).collection.id as number;
  };
  const colA = await mk('甲集', 'mcol-a');
  const colB = await mk('乙集', 'mcol-b');
  const colC = await mk('丙集', 'mcol-c');

  const pa = await post('/api/posts', { title: '甲篇', slug: 'shared-m', collection_id: colA, status: 'published' });
  const pb = await post('/api/posts', { title: '乙篇', slug: 'shared-m', collection_id: colB, status: 'published' });
  assert.equal(pa.status, 201);
  assert.equal(pb.status, 201);
  const paId = (await pa.json()).post.id as number;
  const pbId = (await pb.json()).post.id as number;

  // 两篇同名 slug 同时移入丙集：互相冲突 → 409，且一篇都不移动
  const both = await post('/api/posts/batch', { action: 'move', ids: [paId, pbId], collection_id: colC });
  assert.equal(both.status, 409, '批内互相冲突应 409');
  const bothBody = await both.json();
  assert.ok(Array.isArray(bothBody.conflicts) && bothBody.conflicts.includes('shared-m'));
  const after = await get(`/api/posts/${paId}`);
  assert.equal((await after.json()).post.collection_id, colA, '失败后不得部分移动');

  // 单篇移入空文集成功
  const single = await post('/api/posts/batch', { action: 'move', ids: [paId], collection_id: colC });
  assert.equal(single.status, 200);
  assert.equal((await single.json()).count, 1);

  // 目标已被占用 → 409 且乙篇仍在乙集
  const conflict = await post('/api/posts/batch', { action: 'move', ids: [pbId], collection_id: colC });
  assert.equal(conflict.status, 409, '目标文集已有同名 slug 应 409');
  const pbAfter = await get(`/api/posts/${pbId}`);
  assert.equal((await pbAfter.json()).post.collection_id, colB, '冲突时不得移动');

  // 幂等：把已在丙集的 pa 再次移入丙集仍成功
  const idem = await post('/api/posts/batch', { action: 'move', ids: [paId], collection_id: colC });
  assert.equal(idem.status, 200);

  // 超过单次上限 → 400
  const tooMany = await post('/api/posts/batch', {
    action: 'move',
    ids: Array.from({ length: 51 }, (_, i) => 1000 + i),
    collection_id: colC,
  });
  assert.equal(tooMany.status, 400, 'move 超过 50 篇应拒绝');

  await del(`/api/posts/${paId}`);
  await del(`/api/posts/${pbId}`);
  await del(`/api/collections/${colA}`);
  await del(`/api/collections/${colB}`);
  await del(`/api/collections/${colC}`);
});

test('e2e：offset-only 文章列表查询正常返回', async () => {
  if (!HAS_BUILD) return;
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await post('/api/posts', { title: `列表页${i}`, slug: `list-off-${i}`, status: 'published' });
    assert.equal(r.status, 201);
    ids.push((await r.json()).post.id as number);
  }
  const res = await get('/api/posts?offset=1');
  assert.equal(res.status, 200, '无 limit 仅 offset 不应 500');
  const body = await res.json();
  assert.ok(Array.isArray(body.posts));
  const limited = await get('/api/posts?limit=2&offset=1');
  assert.equal(limited.status, 200);
  assert.equal((await limited.json()).posts.length, 2);
  for (const id of ids) await del(`/api/posts/${id}`);
});

test('e2e：版本恢复到已删除文集——降级为未分类', async () => {
  if (!HAS_BUILD) return;
  const col = await post('/api/collections', { title: '瞬逝集', slug: 'ephemeral-col' });
  assert.equal(col.status, 201);
  const colId = (await col.json()).collection.id as number;

  const created = await post('/api/posts', {
    title: '旧作',
    slug: 'old-work',
    collection_id: colId,
    content_md: '初稿。',
    status: 'published',
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id as number;

  await put(`/api/posts/${id}`, { content_md: '二稿。' });
  await del(`/api/collections/${colId}`);
  assert.equal((await get(`/api/posts/${id}`)).status, 200, '删文集后文章保留为未分类');

  const restore = await post(`/api/posts/${id}/versions/1/restore`, {});
  assert.equal(restore.status, 200, '文集已删时恢复旧版不应 500');
  const rb = await restore.json();
  assert.equal(rb.post.collection_id, null, '旧版指向的文集已删除应降级为未分类');
  assert.equal(rb.post.content_md, '初稿。');
  await del(`/api/posts/${id}`);
});

test('e2e：OG 图片——绝对 URL 原样输出，相对 URL 基于站点拼接', async () => {
  if (!HAS_BUILD) return;
  const col = await post('/api/collections', { title: '图册', slug: 'og-col' });
  assert.equal(col.status, 201);
  const colId = (await col.json()).collection.id as number;

  const abs = await post('/api/posts', {
    title: '绝对封面',
    slug: 'og-abs',
    collection_id: colId,
    cover_url: 'https://cdn.example/uploads/a.png',
    status: 'published',
  });
  assert.equal(abs.status, 201);
  const page = await get('/collections/og-col/og-abs/');
  const html = await page.text();
  assert.ok(html.includes('property="og:image" content="https://cdn.example/uploads/a.png"'), '绝对 URL 不得二次拼接');
  assert.ok(!html.includes('http://e2e.testhttps://'), '不得出现拼接出的非法地址');
  await del(`/api/posts/${(await abs.json()).post.id}`);

  const rel = await post('/api/posts', {
    title: '相对封面',
    slug: 'og-rel',
    collection_id: colId,
    cover_url: '/api/files/uploads/rel.png',
    status: 'published',
  });
  assert.equal(rel.status, 201);
  const page2 = await get('/collections/og-col/og-rel/');
  const html2 = await page2.text();
  assert.ok(html2.includes('property="og:image" content="http://e2e.test/api/files/uploads/rel.png"'), '相对 URL 应拼上站点基址');
  await del(`/api/posts/${(await rel.json()).post.id}`);
  await del(`/api/collections/${colId}`);
});

test('e2e：RSS 含 ]]>、&、< 等内容时仍是合法 XML', async () => {
  if (!HAS_BUILD) return;
  const tricky = await post('/api/posts', {
    title: ']]> & <标签> 试炼',
    slug: 'rss-tricky',
    summary: '摘要包含 ]]> 与 & 与 <x>',
    content_md: '正文包含 ]]> 与 & 与 <标记>。',
    status: 'published',
  });
  assert.equal(tricky.status, 201);

  const res = await get('/rss.xml');
  assert.equal(res.status, 200);
  const xml = await res.text();
  const valid = XMLValidator.validate(xml);
  assert.equal(valid, true, `RSS 必须是合法 XML：${typeof valid === 'object' ? valid.err?.msg : ''}`);

  const parsed = new XMLParser().parse(xml);
  const titles = Array.isArray(parsed.rss.channel.item)
    ? parsed.rss.channel.item.map((i: { title?: string }) => i.title)
    : [parsed.rss.channel.item.title];
  assert.ok(titles.includes(']]> & <标签> 试炼'), 'CDATA 拆分后标题应完整还原');

  await del(`/api/posts/${(await tricky.json()).post.id}`);
});