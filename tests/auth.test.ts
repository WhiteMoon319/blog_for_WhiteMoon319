// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { APIContext } from 'astro';
import { __setEnvResolver } from '../src/lib/db/index.ts';
import { __setCredentialsOverride, __setVersionOverride } from '../src/lib/db/credentials.ts';
import { checkPassword, requireAuth, signToken, verifyToken } from '../src/lib/auth.ts';

const SESSION_VERSION = 7;

function mockEnv(): Env {
  return {
    DB: {} as D1Database,
    IMAGES: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    SITE_NAME: '测试',
    SITE_SLOGAN: '',
    SITE_POEM: '',
    SITE_URL: 'http://local',
    BLOG_ADMIN_PASSWORD: 'admin123',
    BLOG_SESSION_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
    R2_PUBLIC_URL: '',
    LOGIN_RATE_LIMIT_MAX: 10,
    LOGIN_RATE_LIMIT_WINDOW: 300,
  };
}

const env = mockEnv();
__setEnvResolver(async () => env);

// 默认无 DB 凭据，回退到 env 明文比对
__setCredentialsOverride(async () => null);
__setVersionOverride(async () => SESSION_VERSION);

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
  const token = (await signToken(env.BLOG_SESSION_SECRET, 'admin', SESSION_VERSION)) + 'x';
  const r = await requireAuth(mockCtx(token));
  assert.equal(r.ok, false);
});

test('requireAuth：合法签名放行', async () => {
  const token = await signToken(env.BLOG_SESSION_SECRET, 'admin', SESSION_VERSION);
  const r = await requireAuth(mockCtx(token));
  assert.equal(r.ok, true);
});

test('requireAuth：旧版本会话被拒绝（改密码后失效）', async () => {
  const token = await signToken(env.BLOG_SESSION_SECRET, 'admin', SESSION_VERSION - 1);
  const r = await requireAuth(mockCtx(token));
  assert.equal(r.ok, false);
});

test('signToken/verifyToken：往返一致且 sub 正确', async () => {
  const token = await signToken(env.BLOG_SESSION_SECRET, 'admin', SESSION_VERSION);
  const session = await verifyToken(env.BLOG_SESSION_SECRET, token, SESSION_VERSION);
  assert.ok(session);
  assert.equal(session.sub, 'admin');
  assert.equal(session.ver, SESSION_VERSION);
  assert.ok(session.exp > Math.floor(Date.now() / 1000));
});

test('verifyToken：版本不匹配拒绝', async () => {
  const token = await signToken(env.BLOG_SESSION_SECRET, 'admin', SESSION_VERSION);
  const session = await verifyToken(env.BLOG_SESSION_SECRET, token, SESSION_VERSION + 1);
  assert.equal(session, null);
});

test('verifyToken：换密钥后签名失效', async () => {
  const token = await signToken(env.BLOG_SESSION_SECRET, 'admin', SESSION_VERSION);
  const session = await verifyToken('other-secret-00000000000000000000000000000000', token, SESSION_VERSION);
  assert.equal(session, null);
});

test('checkPassword：DB 无凭据时回退 env 明文比对', async () => {
  assert.equal(await checkPassword(env, 'admin123'), true);
  assert.equal(await checkPassword(env, 'wrong'), false);
  const weak = mockEnv();
  __setEnvResolver(async () => weak);
  weak.BLOG_ADMIN_PASSWORD = 'abc';
  assert.equal(await checkPassword(weak, 'abc'), false);
  __setEnvResolver(async () => env);
});

test('hashPassword / verifyPasswordHash：往返一致', async () => {
  const { hashPassword, verifyPasswordHash } = await import('../src/lib/db/credentials.ts');
  const hash = await hashPassword('my-secret-pw-123');
  assert.ok(hash.startsWith('v=1,alg=pbkdf2-sha512,iter=100000,'));
  assert.equal(await verifyPasswordHash('my-secret-pw-123', hash), true);
  assert.equal(await verifyPasswordHash('wrong-password', hash), false);
  assert.equal(await verifyPasswordHash('', hash), false);
});

test('hashPassword / verifyPasswordHash：空密码处理', async () => {
  const { hashPassword, verifyPasswordHash } = await import('../src/lib/db/credentials.ts');
  const hash = await hashPassword('a');
  assert.equal(await verifyPasswordHash('a', hash), true);
  assert.equal(await verifyPasswordHash('b', hash), false);
});