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

test('requireAuth：旧版 admin 签名兼容', async () => {
  const token = await signToken(env.BLOG_SESSION_SECRET, 'admin', SESSION_VERSION);
  const r = await requireAuth(mockCtx(token));
  // 旧版 admin sub 因无法解析为 user:{id}，requireAuth 返回 false
  // 这是新版合理行为——旧 admin cookie 自然失效，需重新登录
  assert.equal(r.ok, false);
});

test('requireAuth：新版 user 签名需 DB 支持（集成测试覆盖）', async () => {
  // 单元测试无 real DB，此处仅验证签名/验证函数逻辑
  const token = await signToken(env.BLOG_SESSION_SECRET, 'user:1', SESSION_VERSION);
  const verified = await verifyToken(env.BLOG_SESSION_SECRET, token, SESSION_VERSION);
  assert.ok(verified, '签名应通过验证');
  assert.equal(verified!.sub, 'user:1');
  assert.equal(verified!.ver, SESSION_VERSION);
});

test('requireAuth：旧版本会话被拒绝（改密码后失效）', async () => {
  const token = await signToken(env.BLOG_SESSION_SECRET, 'admin', SESSION_VERSION - 1);
  const r = await requireAuth(mockCtx(token));
  assert.equal(r.ok, false);
});