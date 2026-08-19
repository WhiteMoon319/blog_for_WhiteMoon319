import type { APIContext } from 'astro';
import { envOf } from './db/index.ts';
import { getCredentials, verifyPasswordHash, getSessionVersion } from './db/credentials.ts';

const COOKIE_NAME = 'blog_session';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

export interface Session {
  sub: string;
  exp: number;
  ver: number;
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSign(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function signToken(secret: string, sub: string, sessionVersion: number): Promise<string> {
  const payload = b64url(
    encoder.encode(
      JSON.stringify({
        sub,
        ver: sessionVersion,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      }),
    ),
  );
  const sig = b64url(await hmacSign(secret, payload));
  return `${payload}.${sig}`;
}

export async function verifyToken(
  secret: string,
  token: string,
  sessionVersion: number,
): Promise<Session | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(await hmacSign(secret, payload));
  if (!constantTimeEqual(sig, expected)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof parsed.ver !== 'number' || parsed.ver !== sessionVersion) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setSessionCookie(ctx: APIContext, sub: string): Promise<void> {
  const env = await envOf();
  const ver = await getSessionVersion(env.DB);
  const token = await signToken(env.BLOG_SESSION_SECRET, sub, ver);
  ctx.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.url.protocol === 'https:',
    path: '/',
    maxAge: TOKEN_TTL_SECONDS,
  });
}

export function clearSessionCookie(ctx: APIContext): void {
  ctx.cookies.delete(COOKIE_NAME, { path: '/' });
}

export async function getSession(ctx: APIContext): Promise<Session | null> {
  const env = await envOf();
  if (!env.BLOG_SESSION_SECRET || env.BLOG_SESSION_SECRET.length < 16) return null;
  const token = ctx.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const ver = await getSessionVersion(env.DB);
  return verifyToken(env.BLOG_SESSION_SECRET, token, ver);
}

export function isAdmin(session: Session | null): boolean {
  return !!session && session.sub === 'admin';
}

// 密码校验：DB 凭据存在时优先使用 DB hash，不存在时回退到 env BLOG_ADMIN_PASSWORD 明文比对
export async function checkPassword(env: Env, password: string): Promise<boolean> {
  const cred = await getCredentials(env.DB);
  if (cred) {
    return verifyPasswordHash(password, cred.password_hash);
  }
  // 回退到环境变量明文比对（旧部署兜底）
  const expected = env.BLOG_ADMIN_PASSWORD;
  if (!expected || expected.length < 4) return false;
  return constantTimeEqual(password, expected);
}

export type AuthResult = { ok: true; session: Session } | { ok: false; response: Response };

export async function requireAuth(ctx: APIContext): Promise<AuthResult> {
  const session = await getSession(ctx);
  if (!isAdmin(session)) {
    return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  }
  return { ok: true, session: session! };
}

// CSRF/Origin 防护：浏览器发起的 POST/PUT/DELETE 必须携带 Origin 且匹配 SITE_URL
export function checkCsrf(ctx: APIContext, siteUrl: string): boolean {
  if (ctx.request.method === 'GET' || ctx.request.method === 'HEAD') return true;
  const origin = ctx.request.headers.get('Origin');
  if (!origin) return false;
  const normalizedSite = siteUrl.replace(/\/+$/, '');
  return origin === normalizedSite;
}