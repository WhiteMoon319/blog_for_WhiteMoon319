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

test('e2e：注册不因验证邮件发不出去而回滚账号（P1）', async () => {
  if (!HAS_BUILD) return;
  // e2e 环境未配置 SMTP → sendEmail 必然失败，正好覆盖「邮件服务故障」这条路径
  // （旧实现在这里 DELETE FROM users 回滚并返回 500，等于「SMTP 没配好 = 注册整体不可用」，
  //  且重试会撞「邮箱已被注册」，用户被永久锁在门外）
  const email = 'mailerdown@example.com';
  const origin = { Origin: 'http://e2e.test', 'Sec-Fetch-Site': 'same-origin' };
  const res = await c.anon('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...origin },
    body: JSON.stringify({ username: 'mailerdown', email, password: 'passw0rd!' }),
  });
  assert.equal(res.status, 201, '账号仍应创建成功，即使验证邮件失败');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.email_sent, false, '必须如实告知邮件没发出去');

  // 账号必须留在库里（不得回滚）
  const rows = await c.sql('SELECT id, email_verified FROM users WHERE username = ?', 'mailerdown');
  assert.equal(rows.results.length, 1, '账号不得被回滚删除');
  assert.equal(rows.results[0].email_verified, 0);

  // 自救路径：重发接口能查到该账号（此时它会因 SMTP 不可用返回 500，但不能是「未注册」）
  const resend = await c.anon('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...origin },
    body: JSON.stringify({ email }),
  });
  assert.notEqual(resend.status, 400, '重发应能找到刚创建的账号，而不是「邮箱未注册」');
});