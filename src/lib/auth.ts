import type { APIContext } from 'astro';
import { envOf } from './db.ts';

const COOKIE_NAME = 'blog_session';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

export interface Session {
  sub: string;
  exp: number;
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
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function signToken(secret: string, sub: string): Promise<string> {
  const payload = b64url(
    encoder.encode(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })),
  );
  const sig = b64url(await hmacSign(secret, payload));
  return `${payload}.${sig}`;
}

export async function verifyToken(secret: string, token: string): Promise<Session | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(await hmacSign(secret, payload));
  if (!constantTimeEqual(sig, expected)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setSessionCookie(ctx: APIContext, sub: string): Promise<void> {
  const env = await envOf();
  const token = await signToken(env.BLOG_SESSION_SECRET, sub);
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
  const token = ctx.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(env.BLOG_SESSION_SECRET, token);
}

export function isAdmin(session: Session | null): boolean {
  return !!session && session.sub === 'admin';
}

export function checkPassword(env: Env, password: string): boolean {
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