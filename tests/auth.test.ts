import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { APIContext } from 'astro';
import { __setEnvResolver } from '../src/lib/db.ts';
import { checkPassword, requireAuth, signToken, verifyToken } from '../src/lib/auth.ts';

function mockEnv(): Env {
  return {
    DB: {} as D1Database,
    IMAGES: {} as R2Bucket,
    RATE_LIMIT: {} as KVNamespace,
    SITE_NAME: '测试',
    SITE_SLOGAN: '',
    SITE_POEM: '',
    BLOG_ADMIN_PASSWORD: 'admin123',
    BLOG_SESSION_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
    R2_PUBLIC_URL: '',
    LOGIN_RATE_LIMIT_MAX: 10,
    LOGIN_RATE_LIMIT_WINDOW: 300,
  };
}

const env = mockEnv();
__setEnvResolver(async () => env);

function mockCtx(cookie?: string): APIContext {
  const cookies = {
    get: (name: string) => (name === 'blog_session' && cookie ? { value: cookie } : undefined),
    set: () => {},
    delete: () => {},
  };
  return {
    request: new Request('http://local/api/collections', { method: 'POST' }),
    params: {},
    url: new URL('http://local/api/collections'),
    cookies: cookies as unknown as APIContext['cookies'],
    locals: {},
  } as unknown as APIContext;
}

test('requireAuth：无会话拒绝写操作', async () => {
  const r = await requireAuth(mockCtx());
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.response.status, 401);
});

test('requireAuth：篡改签名被拒绝', async () => {
  const token = (await signToken(env.BLOG_SESSION_SECRET, 'admin')) + 'x';
  const r = await requireAuth(mockCtx(token));
  assert.equal(r.ok, false);
});

test('requireAuth：合法签名放行', async () => {
  const token = await signToken(env.BLOG_SESSION_SECRET, 'admin');
  const r = await requireAuth(mockCtx(token));
  assert.equal(r.ok, true);
});

test('signToken/verifyToken：往返一致且 sub 正确', async () => {
  const token = await signToken(env.BLOG_SESSION_SECRET, 'admin');
  const session = await verifyToken(env.BLOG_SESSION_SECRET, token);
  assert.ok(session);
  assert.equal(session.sub, 'admin');
  assert.ok(session.exp > Math.floor(Date.now() / 1000));
});

test('verifyToken：换密钥后签名失效', async () => {
  const token = await signToken(env.BLOG_SESSION_SECRET, 'admin');
  const session = await verifyToken('other-secret-00000000000000000000000000000000', token);
  assert.equal(session, null);
});

test('checkPassword：正确口令通过、错误口令拒绝、弱口令被拒', () => {
  assert.equal(checkPassword(env, 'admin123'), true);
  assert.equal(checkPassword(env, 'wrong'), false);
  const weak = mockEnv();
  weak.BLOG_ADMIN_PASSWORD = 'abc';
  assert.equal(checkPassword(weak, 'abc'), false);
});