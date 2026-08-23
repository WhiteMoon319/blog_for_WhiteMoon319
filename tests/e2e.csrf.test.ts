// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeE2e, HAS_BUILD, type E2eClient } from './helpers/e2e.ts';

let c: E2eClient;

before(async () => {
  if (!HAS_BUILD) return;
  c = await makeE2e();
});

after(async () => {
  if (c) await c.dispose();
});

// §14 统一安全要求：所有 Cookie 写接口必须拒绝无 Origin 的跨站请求（403）
test('e2e：全部写接口无 Origin 均被 CSRF 拒绝（403）', async () => {
  if (!HAS_BUILD) return;
  await c.login();

  const noOrigin = (method: string, path: string, body?: unknown) =>
    c.raw(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const cases: Array<[string, string, unknown]> = [
    ['POST', '/api/posts', { title: 'X' }],
    ['PUT', '/api/posts/1', { title: 'X' }],
    ['DELETE', '/api/posts/1', undefined],
    ['POST', '/api/posts/batch', { action: 'trash', ids: [1] }],
    ['POST', '/api/posts/1/versions/1/restore', {}],
    ['POST', '/api/collections', { title: 'X' }],
    ['PUT', '/api/collections/1', { title: 'X' }],
    ['DELETE', '/api/collections/1', undefined],
    ['PUT', '/api/settings', { SITE_NAME: 'X' }],
    ['POST', '/api/auth/password', { old_password: 'a', new_password: 'b' }],
    ['POST', '/api/pages', { slug: 'x', title: 'X' }],
    ['PUT', '/api/pages/1', { title: 'X' }],
    ['DELETE', '/api/pages/1', undefined],
    ['DELETE', '/api/media?key=uploads/x.png', undefined],
  ];

  for (const [method, path, body] of cases) {
    const r = await noOrigin(method, path, body);
    assert.equal(r.status, 403, `${method} ${path} 应返回 403 而非 ${r.status}`);
  }
});

test('e2e：上传接口无 Origin 同样被 CSRF 拒绝（403）', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4]);
  const form = c.multipart([{ name: 'file', filename: 'a.png', type: 'image/png', bytes: png }]);
  const r = await c.raw('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': form.contentType },
    body: form.body,
  });
  assert.equal(r.status, 403);
});