// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 传输层安全判定：HSTS 的发送条件、HTTP→HTTPS 跳转条件、cookie Secure 判定。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_SECURITY_HEADERS,
  HSTS_VALUE,
  firstForwardedProto,
  isHttpsRedirectDisabled,
  isHttpsRequest,
  isLocalHostname,
  needsHttpsRedirect,
  securityHeaders,
} from '../src/lib/http-security.ts';

test('传输层：HTTPS 响应才带 HSTS，且基线安全头始终存在', () => {
  const https = securityHeaders(true);
  const http = securityHeaders(false);
  assert.equal(https['Strict-Transport-Security'], HSTS_VALUE);
  assert.match(HSTS_VALUE, /max-age=31536000/);
  assert.ok(!HSTS_VALUE.includes('preload'), 'preload 不应顺手打开（难以撤回）');
  assert.equal(http['Strict-Transport-Security'], undefined);
  for (const h of Object.values(BASE_SECURITY_HEADERS)) assert.ok(h.length > 0);
  assert.equal(http['X-Frame-Options'], 'DENY');
  assert.equal(https['X-Content-Type-Options'], 'nosniff');
});

test('传输层：协议判定认 x-forwarded-proto（边缘终结 TLS 的情形）', () => {
  assert.equal(firstForwardedProto('https'), 'https');
  assert.equal(firstForwardedProto('HTTPS, http'), 'https');
  assert.equal(firstForwardedProto(' http'), 'http');
  assert.equal(firstForwardedProto(null), '');

  assert.equal(isHttpsRequest('https:', null), true);
  assert.equal(isHttpsRequest('http:', 'https'), true);
  assert.equal(isHttpsRequest('http:', 'http'), false);
  assert.equal(isHttpsRequest('http:', null), false);
});

test('传输层：HTTP 跳转的边界（生产+非本地+非 https 才跳）', () => {
  const prod = { isProd: true, protocol: 'http:', hostname: 'blog.whitemoon319.xyz', forwardedProto: null };
  assert.equal(needsHttpsRedirect(prod), true);
  // 已经是 https：不跳
  assert.equal(needsHttpsRedirect({ ...prod, protocol: 'https:' }), false);
  assert.equal(needsHttpsRedirect({ ...prod, protocol: 'http:', forwardedProto: 'https' }), false);
  // 开发环境不跳（本地 dev server 是 http）
  assert.equal(needsHttpsRedirect({ ...prod, isProd: false }), false);
  // 本地地址不跳，避免开发/健康检查被重定向
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'foo.localhost']) {
    assert.equal(needsHttpsRedirect({ ...prod, hostname }), false, hostname);
    assert.equal(isLocalHostname(hostname), true, hostname);
  }
  assert.equal(isLocalHostname('blog.whitemoon319.xyz'), false);
  // e2e 用 http://e2e.test，必须能被开关关掉（否则所有用例都被 308 打挂）
  assert.equal(needsHttpsRedirect({ ...prod, hostname: 'e2e.test' }), true);
  assert.equal(needsHttpsRedirect({ ...prod, hostname: 'e2e.test', disabled: true }), false);
  assert.equal(isHttpsRedirectDisabled('false'), true);
  assert.equal(isHttpsRedirectDisabled(false), true);
  assert.equal(isHttpsRedirectDisabled('true'), false);
  assert.equal(isHttpsRedirectDisabled(undefined), false);
});
