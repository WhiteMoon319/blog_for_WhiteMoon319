import type { APIContext } from 'astro';
import { envOf } from './db/index.ts';
import { getCredentials, verifyPasswordHash, getSessionVersion } from './db/credentials.ts';
import { type UserRow, getUserById } from './db/users.ts';

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
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  return diff === 0;
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function signToken(secret: string, sub: string, sessionVersion: number): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify({ sub, ver: sessionVersion, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })));
  const sig = b64url(await hmacSign(secret, payload));
  return `${payload}.${sig}`;
}

export async function verifyToken(secret: string, token: string, sessionVersion: number): Promise<Session | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(await hmacSign(secret, payload));
  if (!constantTimeEqual(sig, expected)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof parsed.ver !== 'number' || parsed.ver !== sessionVersion) return null;
    return parsed;
  } catch { return null; }
}

export async function setSessionCookie(ctx: APIContext, sub: string, sessionVersion: number): Promise<void> {
  const env = await envOf();
  const token = await signToken(env.BLOG_SESSION_SECRET, sub, sessionVersion);
  ctx.cookies.set(COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', secure: ctx.url.protocol === 'https:', path: '/', maxAge: TOKEN_TTL_SECONDS,
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
  // 解析 token 获取版本号（不校验版本，只取 sub 用于查用户）
  const [payload] = token.split('.');
  if (!payload) return null;
  let parsed: Session;
  try { parsed = JSON.parse(new TextDecoder().decode(fromB64url(payload))); } catch { return null; }
  // 旧版 admin sub 兼容：用全局版本号校验
  if (parsed.sub === 'admin') {
    const ver = await getSessionVersion(env.DB);
    return verifyToken(env.BLOG_SESSION_SECRET, token, ver);
  }
  // 新版 user:{id}
  const m = parsed.sub?.match(/^user:(\d+)$/);
  if (!m) return null;
  const user = await getUserById(env.DB, Number(m[1]));
  if (!user || user.status !== 'active') return null;
  return verifyToken(env.BLOG_SESSION_SECRET, token, user.session_version);
}

export async function resolveUser(ctx: APIContext): Promise<{ user: UserRow; emailVerified: boolean } | null> {
  const session = await getSession(ctx);
  if (!session) return null;
  const m = session.sub?.match(/^user:(\d+)$/);
  if (!m) return null;
  const env = await envOf();
  const user = await getUserById(env.DB, Number(m[1]));
  if (!user || user.status !== 'active') return null;
  return { user, emailVerified: user.email_verified === 1 };
}

export type AuthResult = { ok: true; session: Session; user: UserRow } | { ok: false; response: Response };

export async function requireAdmin(ctx: APIContext): Promise<AuthResult> {
  const session = await getSession(ctx);
  if (!session) return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  const resolved = await resolveUser(ctx);
  if (!resolved || resolved.user.role !== 'admin') return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  return { ok: true, session, user: resolved.user };
}

// 保留 requireAuth 作为 requireAdmin 的别名（兼容现有调用）
export { requireAdmin as requireAuth };

export type AnyUserResult =
  | { ok: true; session: Session; user: UserRow; emailVerified: boolean }
  | { ok: false; response: Response };

export async function requireAnyUser(ctx: APIContext): Promise<AnyUserResult> {
  const session = await getSession(ctx);
  if (!session) return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  const resolved = await resolveUser(ctx);
  if (!resolved) return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  return { ok: true, session, user: resolved.user, emailVerified: resolved.emailVerified };
}

// 检查是否为管理员（用于公开页面的显示逻辑，非鉴权）
export function isAdmin(user: UserRow | null): boolean {
  return user?.role === 'admin';
}

// 密码校验：DB 凭据存在时优先使用 DB hash，不存在时回退到 env BLOG_ADMIN_PASSWORD 明文比对
export async function checkPassword(env: Env, password: string): Promise<boolean> {
  const cred = await getCredentials(env.DB);
  if (cred) {
    if (!verifyPasswordHash(password, cred.password_hash)) return false;
    return true;
  }
  const expected = env.BLOG_ADMIN_PASSWORD;
  if (!expected || expected.length < 4) return false;
  return constantTimeEqual(password, expected);
}

// 密码强度校验
export function passwordStrength(pwd: string): string | null {
  if (pwd.length < 8) return '至少 8 位';
  if (!/[a-zA-Z]/.test(pwd)) return '需包含字母';
  if (!/\d/.test(pwd) && !/[^a-zA-Z0-9]/.test(pwd)) return '需包含数字或特殊字符';
  return null;
}

// CSRF/Origin 防护
export function checkCsrf(ctx: APIContext, siteUrl: string): boolean {
  if (ctx.request.method === 'GET' || ctx.request.method === 'HEAD') return true;
  const origin = ctx.request.headers.get('Origin');
  if (!origin) return false;
  return origin === siteUrl.replace(/\/+$/, '');
}