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

test('e2e：登录流程与限流', async () => {
  if (!HAS_BUILD) return;
  for (let i = 0; i < 4; i++) {
    const bad = await c.post('/api/auth/login', { password: 'wrong' });
    assert.equal(bad.status, 401);
  }
  const ok = await c.post('/api/auth/login', { password: 'admin123' });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie') ?? '';
  assert.ok(setCookie.includes('blog_session='), '应下发会话 cookie');
  c.setSession(setCookie.split(';')[0]);
  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.ok(meBody.authenticated === true);
  for (let i = 0; i < 7; i++) {
    await c.post('/api/auth/login', { password: 'wrong' });
  }
  const blocked = await c.post('/api/auth/login', { password: 'admin123' });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
});