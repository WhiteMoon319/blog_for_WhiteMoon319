// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 边缘缓存判定 + 会话 cookie 的「签名判定」。
// 这两处原先只存在于 middleware.ts 且没有任何测试，线上两个问题（裸路径漏判、
// 覆盖路由 no-store）都出在这里，所以把判定抽成纯函数并逐条钉住。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE_CACHE_MAX_AGE,
  isEdgeCacheDisabled,
  isNoCachePath,
  isPublicCacheablePath,
  isStorableHtmlResponse,
  normalizePath,
  shouldUseEdgeCache,
} from '../src/lib/edge-cache.ts';
import { signToken, verifyTokenShape } from '../src/lib/auth.ts';

const html = (status = 200, headers: Record<string, string> = {}) =>
  ({ status, headers: new Headers({ 'content-type': 'text/html; charset=utf-8', ...headers }) });

test('边缘缓存：裸路径与带尾斜杠等价（/admin、/search 曾漏判成可缓存）', () => {
  for (const p of ['/admin', '/admin/', '/admin/posts', '/search', '/search/', '/write', '/write/', '/api', '/api/posts', '/login', '/account']) {
    assert.equal(isNoCachePath(p), true, `${p} 应免缓存`);
    assert.equal(isPublicCacheablePath(p), false, `${p} 不该走公开缓存`);
  }
  // 路径段匹配：不能把同前缀的其它路径误伤/漏判
  for (const p of ['/', '/posts/hello/', '/collections/essays/', '/tags/tech/', '/administrator', '/searching', '/writers']) {
    assert.equal(isNoCachePath(p), false, `${p} 应允许缓存`);
  }
});

test('边缘缓存：路径归一化', () => {
  assert.equal(normalizePath('/admin/'), '/admin');
  assert.equal(normalizePath('/admin'), '/admin');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('/a/b///'), '/a/b');
});

test('边缘缓存：只有匿名静态 200 HTML 才可入缓存', () => {
  assert.equal(isStorableHtmlResponse(html()), true);
  assert.equal(isStorableHtmlResponse(html(200, { 'cache-control': 'public, max-age=60' })), true);
  // 路由声明不缓存 → 不得覆盖后再入缓存
  assert.equal(isStorableHtmlResponse(html(200, { 'cache-control': 'no-store' })), false);
  assert.equal(isStorableHtmlResponse(html(200, { 'cache-control': 'private, no-store' })), false);
  assert.equal(isStorableHtmlResponse(html(200, { 'cache-control': 'no-cache' })), false);
  // 带登录态写入的响应不得入边缘缓存
  assert.equal(isStorableHtmlResponse(html(200, { 'set-cookie': 'blog_session=x; Path=/' })), false);
  // 非 200 / 非 HTML 不入缓存
  assert.equal(isStorableHtmlResponse(html(404)), false);
  assert.equal(isStorableHtmlResponse(html(302)), false);
  assert.equal(isStorableHtmlResponse({ status: 200, headers: new Headers({ 'content-type': 'application/json' }) }), false);
});

test('边缘缓存：开关与前置条件', () => {
  const base = { method: 'GET', path: '/', hasVerifiedSession: false, isProd: true, edgeCacheFlag: undefined };
  assert.equal(shouldUseEdgeCache(base), true);
  assert.equal(shouldUseEdgeCache({ ...base, method: 'POST' }), false);
  assert.equal(shouldUseEdgeCache({ ...base, method: 'HEAD' }), false);
  assert.equal(shouldUseEdgeCache({ ...base, isProd: false }), false);
  // 有「验签通过」的会话才绕过缓存；伪造 cookie 不再能把缓存整个绕掉
  assert.equal(shouldUseEdgeCache({ ...base, hasVerifiedSession: true }), false);
  assert.equal(shouldUseEdgeCache({ ...base, edgeCacheFlag: 'false' }), false);
  assert.equal(shouldUseEdgeCache({ ...base, edgeCacheFlag: false }), false);
  assert.equal(shouldUseEdgeCache({ ...base, path: '/admin' }), false);

  assert.equal(isEdgeCacheDisabled('false'), true);
  assert.equal(isEdgeCacheDisabled(false), true);
  assert.equal(isEdgeCacheDisabled('true'), false);
  assert.equal(isEdgeCacheDisabled(undefined), false);
  assert.equal(EDGE_CACHE_MAX_AGE, 60);
});

test('会话 cookie：只认签名有效且未过期的 token（伪造 cookie 必须判为无会话）', async () => {
  const secret = 'test-secret-at-least-16-chars-long';
  const valid = await signToken(secret, 'user:1', 3);
  assert.ok(await verifyTokenShape(secret, valid), '有效 token 应通过');

  // 伪造：随便一个字符串
  assert.equal(await verifyTokenShape(secret, 'fake-abc'), null);
  // 换密钥 → 签名不匹配
  assert.equal(await verifyTokenShape('another-secret-16-chars-min', valid), null);
  // 篡改 payload 保留签名
  const [, sig] = valid.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ sub: 'user:1', ver: 3, exp: 9999999999 })).toString('base64url');
  assert.equal(await verifyTokenShape(secret, `${forgedPayload}.${sig}`), null);
  // 过期
  const expired = await signToken(secret, 'user:1', 3);
  const [payload] = expired.split('.');
  const oldPayload = Buffer.from(JSON.stringify({ sub: 'user:1', ver: 3, exp: Math.floor(Date.now() / 1000) - 10 })).toString('base64url');
  assert.equal(await verifyTokenShape(secret, `${oldPayload}.${expired.split('.')[1]}`), null);
  assert.ok(payload);
  // 密钥缺失/过短 → 一律拒绝
  assert.equal(await verifyTokenShape(undefined, valid), null);
  assert.equal(await verifyTokenShape('short', valid), null);
  // 结构不合法
  assert.equal(await verifyTokenShape(secret, `${Buffer.from(JSON.stringify({ sub: 'user:1' })).toString('base64url')}.x`), null);
});
