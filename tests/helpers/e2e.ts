import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { readStatements } from './sql.ts';

const SERVER_DIR = resolve('dist/server');
const BASE = 'http://e2e.test';

export const HAS_BUILD = existsSync(resolve(SERVER_DIR, 'entry.mjs'));

// 校验构建产物存在且不早于源码（改代码忘 build 时明确失败，避免 e2e 误测旧产物）
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

// e2e 客户端统一返回的响应形态：miniflare 的 Response 与 Node/DOM 类型存在差异，
// 边界处转回本项目可用的最小接口，避免类型混乱
export interface E2eResponse {
  status: number;
  ok: boolean;
  url: string;
  headers: Headers;
  text(): Promise<string>;
  json(): Promise<any>;
}

export interface E2eClient {
  mf: Miniflare;
  base: string;
  get(path: string, headers?: Record<string, string>): Promise<E2eResponse>;
  post(path: string, body: unknown): Promise<E2eResponse>;
  put(path: string, body: unknown): Promise<E2eResponse>;
  del(path: string): Promise<E2eResponse>;
  raw(path: string, init: RequestInit): Promise<E2eResponse>;
  anon(path: string, init?: RequestInit): Promise<E2eResponse>;
  login(): Promise<void>;
  setSession(cookieValue: string): void;
  multipart(files: UploadFile[]): { body: Uint8Array<ArrayBuffer>; contentType: string };
  dispose(): Promise<void>;
}

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

export async function makeE2e(): Promise<E2eClient> {
  requireBuild();
  const mf = new Miniflare({
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
            SITE_URL: { type: 'json', value: BASE },
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

  let cookie = '';

  // miniflare 的 Response 与 DOM Response 存在类型差异（迭代器实现不同），统一转回 E2eResponse
  const fetchOf = (path: string, init: Parameters<typeof mf.dispatchFetch>[1]): Promise<E2eResponse> =>
    mf.dispatchFetch(BASE + path, init) as unknown as Promise<E2eResponse>;

  const client: E2eClient = {
    mf,
    base: BASE,
    async get(path, headers = {}) {
      return fetchOf(path, {
        redirect: 'manual',
        headers: { ...headers, ...(cookie ? { cookie } : {}) },
      });
    },
    async post(path, body) {
      return fetchOf(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    },
    async put(path, body) {
      return fetchOf(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    },
    async del(path) {
      return fetchOf(path, { method: 'DELETE', headers: { cookie, ...ORIGIN_HEADERS } });
    },
    async raw(path, init) {
      const headers = new Headers(init.headers ?? {});
      if (cookie) headers.set('cookie', cookie);
      return fetchOf(path, { ...init, headers } as Parameters<typeof mf.dispatchFetch>[1]);
    },
    async anon(path, init = {}) {
      return fetchOf(path, init as Parameters<typeof mf.dispatchFetch>[1]);
    },
    async login() {
      if (cookie) return;
      const res = await mf.dispatchFetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'admin123' }),
      });
      if (res.status !== 200) throw new Error('e2e login failed');
      const setCookie = res.headers.get('set-cookie') ?? '';
      cookie = setCookie.split(';')[0];
    },
    setSession(cookieValue: string) {
      cookie = cookieValue;
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
      return { body, contentType: `multipart/form-data; boundary=${boundary}` };
    },
    async dispose() {
      await mf.dispose();
    },
  };
  return client;
}
