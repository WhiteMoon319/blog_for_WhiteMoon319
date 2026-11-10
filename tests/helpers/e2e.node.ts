// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// e2e 客户端（Node 后端版）
// ============================================================================
//
// 原实现用 miniflare 跑 Cloudflare Worker。Node 后端已移除 miniflare，
// 改为在测试进程内起一个真实的 http.Server，用 dist/server/entry.mjs 的 handler
// 处理请求，再通过 fetch 打真实 HTTP。
//
// 与生产的差异（有意为之，均为测试便利）：
//   - DB 用内存库（:memory:），每个 makeE2e() 都是干净 schema
//   - BLOB 用临时目录，每个实例独立
//   - EDGE_CACHE=false 关掉缓存，避免跨用例脏读
//   - HTTPS_REDIRECT=false，因为测试基址是 http://e2e.test
//
// 保留 triggerScheduled()：原来走 Cloudflare 的 /cdn-cgi/local/scheduled，
// 现在直接 POST 内部路由 /api/internal/publish-due。

import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NodeD1Database } from '../../server/d1.mjs';
import { NodeAssetsFetcher, NodeR2Bucket } from '../../server/r2.mjs';
import { readStatements } from './sql.ts';
import { hashPassword } from '../../src/lib/db/credentials.ts';

const SERVER_DIR = resolve('dist/server');
const BASE = 'http://e2e.test';
export const HAS_BUILD = existsSync(resolve(SERVER_DIR, 'entry.mjs'));

/** 校验构建产物存在且不早于源码（改代码忘 build 时明确失败，避免 e2e 误测旧产物） */
export function requireBuild(): void {
  if (!HAS_BUILD) throw new Error('dist/server/entry.mjs 缺失，请先运行 pnpm run build');
  let srcNewest = 0;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git' || e.name === '.astro') continue;
      const p = resolve(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|vue|js|mjs|json|css|astro|sql)$/i.test(e.name)) {
        const t = statSync(p).mtimeMs;
        if (t > srcNewest) srcNewest = t;
      }
    }
  };
  for (const dir of ['src', 'admin/src', 'scripts', 'db']) walk(dir);
  let distNewest = statSync(resolve(SERVER_DIR, 'entry.mjs')).mtimeMs;

  const adminDir = resolve('dist/client/admin');
  if (existsSync(adminDir)) {
    for (const f of readdirSync(adminDir)) {
      const t = statSync(resolve(adminDir, f)).mtimeMs;
      if (t > distNewest) distNewest = t;
    }
  }
  // 作者写作区是独立产物：缺了它就是没 build，不能靠 admin 产物蒙混过关。
  // 注意检查源产物 admin/dist-write，而不是 dist/client/write —— 后者的 index.html
  // 会被 merge-admin.mjs 主动删除（避免静态 handler 抢走路由，绕过 no-store/CSP）。
  const writeSrcDir = resolve('admin/dist-write');
  if (!existsSync(resolve(writeSrcDir, 'index.html'))) {
    throw new Error('admin/dist-write/index.html 缺失，请先运行 pnpm run build');
  }
  const writeDir = resolve('dist/client/write');
  if (!existsSync(writeDir)) {
    throw new Error('dist/client/write 缺失，请先运行 pnpm run build');
  }
  for (const f of readdirSync(writeDir)) {
    const t = statSync(resolve(writeDir, f)).mtimeMs;
    if (t > distNewest) distNewest = t;
  }
  if (distNewest < srcNewest) {
    throw new Error('dist 构建产物早于源码，请先重新运行 pnpm run build');
  }
}

export const ORIGIN_HEADERS = { Origin: BASE, 'Sec-Fetch-Site': 'same-origin' };

export interface UploadFile {
  name: string;
  filename: string;
  type: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface E2eResponse {
  status: number;
  ok: boolean;
  url: string;
  headers: Headers;
  text(): Promise<string>;
  json(): Promise<any>;
}

export interface E2eClient {
  /** 保留字段：原 miniflare 实例；Node 版为 undefined，仅为兼容既有用例的类型引用 */
  mf?: unknown;
  base: string;
  /** 直接用 D1 语句对象（与 c.sql 等价，便于需要 .bind().run() 的写法） */
  db?: NodeD1Database;
  get(path: string, headers?: Record<string, string>): Promise<E2eResponse>;
  post(path: string, body: unknown): Promise<E2eResponse>;
  put(path: string, body: unknown): Promise<E2eResponse>;
  del(path: string): Promise<E2eResponse>;
  raw(path: string, init: RequestInit): Promise<E2eResponse>;
  anon(path: string, init?: RequestInit): Promise<E2eResponse>;
  login(): Promise<void>;
  setSession(cookieValue: string): void;
  session(): string;
  multipart(files: UploadFile[]): { body: Uint8Array<ArrayBuffer>; contentType: string };
  triggerScheduled(): Promise<void>;
  sql(stmt: string, ...binds: (string | number | null)[]): Promise<{ results: Record<string, unknown>[] }>;
  dispose(): Promise<void>;
}

/** 把 Node http 响应转成 E2eResponse（保留 headers 的原样语义） */
async function toE2eResponse(res: Response): Promise<E2eResponse> {
  const text = await res.text();
  return {
    status: res.status,
    ok: res.ok,
    url: res.url,
    headers: res.headers,
    async text() {
      return text;
    },
    async json() {
      return JSON.parse(text);
    },
  };
}

export async function makeE2e(): Promise<E2eClient> {
  requireBuild();

  // ---- 独立的内存库 + 临时对象目录 ----
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = new NodeD1Database(sqlite, 'e2e-db');

  for (const file of readdirSync(resolve('db/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    for (const stmt of readStatements(`db/migrations/${file}`)) {
      await db.prepare(stmt).run();
    }
  }
  for (const stmt of readStatements('db/seed.sql')) {
    await db.prepare(stmt).run();
  }

  const blobDir = mkdtempSync(join(tmpdir(), 'blog-e2e-blobs-'));
  const images = new NodeR2Bucket(blobDir);
  const assets = new NodeAssetsFetcher(resolve('dist/client'));

  const env: Record<string, unknown> = {
    DB: db,
    IMAGES: images,
    ASSETS: assets,
    SITE_NAME: '测试书斋',
    SITE_SLOGAN: '一角书斋',
    SITE_POEM: '晨起摊书卷。',
    SITE_URL: BASE,
    BLOG_ADMIN_PASSWORD: 'admin123',
    BLOG_SESSION_SECRET: 'e2e-secret-0123456789abcdef0123456789abcdef',
    R2_PUBLIC_URL: '',
    LOGIN_RATE_LIMIT_MAX: 10,
    LOGIN_RATE_LIMIT_WINDOW: 300,
    EDGE_CACHE: 'false',
    // e2e 走 http://e2e.test（非 localhost），关掉强制跳转，否则所有请求都会被 308 到 https
    HTTPS_REDIRECT: 'false',
  };

  // ---- 注入 env，再加载 handler ----
  process.env.ASTRO_NODE_AUTOSTART = 'disabled';
  globalThis.__BLOG_ENV_RESOLVER__ = async () => env as never;
  globalThis.__BLOG_PAGE_CACHE__ = undefined;

  const mod = await import(resolve(SERVER_DIR, 'entry.mjs'));
  const handler = mod.handler as (req: any, res: any) => unknown;

  // ---- 起真实 HTTP server（随机端口）----
  const clientDir = resolve('dist/client');
  const { createReadStream } = await import('node:fs');
  const { contentTypeOf, resolveStaticFile, staticCacheControl } = await import('../../server/static.mjs');

  const server = createServer((req, res) => {
    // 测试基址是 e2e.test，但 server 实际监听 127.0.0.1：
    // 把 Host 头改写成目标基址，让业务侧基于 Host 的判定（如 Origin 校验）看到预期值
    req.headers.host = 'e2e.test';

    // 与生产 server/index.mjs 保持一致：先判静态，再交给 SSR
    // （adapter 自带的 static handler 会把 /admin/、/write/ 的外壳直接发出，
    //   绕过路由的 no-store / CSP，因此必须由我们接管静态判定）
    try {
      const urlPath = (req.url ?? '/').split('?')[0].split('#')[0];
      const file = resolveStaticFile(clientDir, urlPath);
      if (file) {
        res.writeHead(200, {
          'Content-Type': contentTypeOf(file),
          'Cache-Control': staticCacheControl(urlPath),
          'X-Content-Type-Options': 'nosniff',
        });
        createReadStream(file).pipe(res);
        return;
      }
    } catch {
      // 降级给 SSR
    }

    void handler(req, res);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const realBase = `http://127.0.0.1:${port}`;

  let cookie = '';

  /**
   * 发请求。对外仍然用 BASE + path 表达（业务侧看到的是 e2e.test），
   * 实际打到本地端口。
   *
   * redirect 默认 'manual'：与 miniflare 的 dispatchFetch 一致（不跟随重定向）。
   * 全站用 `Astro.redirect('/404')` 表达「资源不存在」，跟随之后恰好落成 404 状态，
   * 所以只需要状态码的用例（如阅读历史、定时发布）直接判断即可。
   * 需要看原始 302 与 Location 的用例，都显式传了 `{ redirect: 'manual' }`。
   */
  const fetchOf = async (path: string, init: RequestInit = {}): Promise<E2eResponse> => {
    const headers = new Headers(init.headers ?? {});
    const res = await fetch(realBase + path, { redirect: 'manual', ...init, headers });
    return toE2eResponse(res);
  };

  const client: E2eClient = {
    mf: undefined,
    base: BASE,
    db,

    async get(path, headers = {}) {
      return fetchOf(path, {
        headers: { ...headers, ...(cookie ? { cookie } : {}) },
      });
    },

    async post(path, body) {
      return fetchOf(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    },

    async put(path, body) {
      return fetchOf(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    },

    async del(path) {
      return fetchOf(path, { method: 'DELETE', headers: { cookie, ...ORIGIN_HEADERS } });
    },

    async raw(path, init) {
      const headers = new Headers(init.headers ?? {});
      if (cookie) headers.set('cookie', cookie);
      return fetchOf(path, { ...init, headers });
    },

    async anon(path, init = {}) {
      return fetchOf(path, init);
    },

    async login() {
      if (cookie) return;
      const res = await fetchOf('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE, 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({ password: 'admin123' }),
      });
      if (res.status !== 200) throw new Error('e2e login failed: ' + res.status);
      const setCookie = res.headers.get('set-cookie') ?? '';
      cookie = setCookie.split(';')[0];
    },

    setSession(cookieValue: string) {
      cookie = cookieValue;
    },

    session() {
      return cookie;
    },

    async triggerScheduled() {
      // 原实现走 Cloudflare 的 /cdn-cgi/local/scheduled 触发 scheduled 处理器；
      // Node 后端的定时发布是内部路由，直接 POST 即可。
      // 必须带 Origin：全站写接口都过 CSRF 校验（仅凭 clientAddress 豁免不够，
      // 因为 Astro 的 origin 检查在路由之前由 adapter 层完成）。
      const res = await fetchOf('/api/internal/publish-due', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
      });
      if (!res.ok) throw new Error(`triggerScheduled failed: ${res.status} ${await res.text()}`);
    },

    async sql(stmt: string, ...binds: (string | number | null)[]) {
      // 直接操作测试数据库：用于制造 API 无法表达的状态（如把定时回拨到过去）
      return db
        .prepare(stmt)
        .bind(...binds)
        .all();
    },

    multipart(files) {
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
      return { body: body as Uint8Array<ArrayBuffer>, contentType: `multipart/form-data; boundary=${boundary}` };
    },

    async dispose() {
      await new Promise<void>((ok) => server.close(() => ok()));
      db.close();
      rmSync(blobDir, { recursive: true, force: true });
      // 清掉注入，避免污染后续用例
      globalThis.__BLOG_ENV_RESOLVER__ = undefined;
    },
  };

  return client;
}

// 越权用例需要多身份切换：下列辅助造出可登录的普通账号并拿到其会话 cookie。
// 注意 client.login() 有「已有 cookie 就短路」的语义，切回管理员必须用 loginAsAdmin。
const E2E_USER_PASSWORD = 'e2e-author-pw';

export interface SeededUser {
  id: number;
  username: string;
  cookie: string;
}

/** 直接造一个可登录账号（reader/author/admin）并返回其会话 cookie，不改变 client 当前会话 */
export async function seedUserSession(
  client: E2eClient,
  opts: { username: string; role?: 'reader' | 'author' | 'admin'; displayName?: string; bio?: string },
): Promise<SeededUser> {
  const { username } = opts;
  const hash = await hashPassword(E2E_USER_PASSWORD);
  await client.sql(
    `INSERT INTO users (username, display_name, email, email_verified, password_hash, role, bio, session_version, created_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, 1, datetime('now'))`,
    username,
    opts.displayName ?? username,
    `${username}@e2e.test`,
    hash,
    opts.role ?? 'author',
    opts.bio ?? '',
  );
  const rows = await client.sql('SELECT id FROM users WHERE username = ?', username);
  const id = Number(rows.results[0]?.id);
  if (!id) throw new Error(`seedUserSession 插入失败: ${username}`);
  const res = await client.anon('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
    body: JSON.stringify({ username, password: E2E_USER_PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`seedUserSession 登录失败 ${username}: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  if (!cookie) throw new Error(`seedUserSession 未取得会话 cookie: ${username}`);
  return { id, username, cookie };
}

/** 切回管理员会话（client 的 login() 在已有会话时不会重新登录） */
export async function loginAsAdmin(client: E2eClient): Promise<string> {
  const res = await client.anon('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
    body: JSON.stringify({ password: 'admin123' }),
  });
  if (res.status !== 200) throw new Error(`管理员登录失败: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  client.setSession(cookie);
  return cookie;
}

void readFileSync;
