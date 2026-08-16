import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';

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
            RATE_LIMIT: { type: 'kv', id: 'e2e-ratelimit' },
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