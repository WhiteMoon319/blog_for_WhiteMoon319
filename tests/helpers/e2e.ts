import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';

const SERVER_DIR = resolve('dist/server');
const BASE = 'http://e2e.test';

export const HAS_BUILD = existsSync(resolve(SERVER_DIR, 'entry.mjs'));

export const ORIGIN_HEADERS = { Origin: BASE, 'Sec-Fetch-Site': 'same-origin' };

export interface UploadFile {
  name: string;
  filename: string;
  type: string;
  bytes: Uint8Array;
}

export interface E2eClient {
  mf: Miniflare;
  base: string;
  get(path: string, headers?: Record<string, string>): Promise<Response>;
  post(path: string, body: unknown): Promise<Response>;
  put(path: string, body: unknown): Promise<Response>;
  del(path: string): Promise<Response>;
  raw(path: string, init: RequestInit): Promise<Response>;
  anon(path: string, init?: RequestInit): Promise<Response>;
  login(): Promise<void>;
  setSession(cookieValue: string): void;
  multipart(files: UploadFile[]): { body: Uint8Array; contentType: string };
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
      // 触发器 BEGIN…END 体内含分号，未闭合前不切分
      const begins = (cur.match(/\bBEGIN\b/gi) ?? []).length;
      const ends = (cur.match(/\bEND\b/gi) ?? []).length;
      if (begins > ends) {
        cur += ch;
        continue;
      }
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

export async function makeE2e(): Promise<E2eClient> {
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

  const client: E2eClient = {
    mf,
    base: BASE,
    async get(path, headers = {}) {
      return mf.dispatchFetch(BASE + path, {
        redirect: 'manual',
        headers: { ...headers, ...(cookie ? { cookie } : {}) },
      });
    },
    async post(path, body) {
      return mf.dispatchFetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    },
    async put(path, body) {
      return mf.dispatchFetch(BASE + path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    },
    async del(path) {
      return mf.dispatchFetch(BASE + path, { method: 'DELETE', headers: { cookie, ...ORIGIN_HEADERS } });
    },
    async raw(path, init) {
      const headers = new Headers(init.headers ?? {});
      if (cookie) headers.set('cookie', cookie);
      return mf.dispatchFetch(BASE + path, { ...init, headers });
    },
    async anon(path, init = {}) {
      return mf.dispatchFetch(BASE + path, init);
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
