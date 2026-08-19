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

// ---- 站点设置 ----

test('e2e：GET /api/settings 返回合并值（env 兜底）', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const r = await c.get('/api/settings');
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.equal(s.SITE_NAME, '测试书斋');
  assert.equal(s.SITE_SLOGAN, '一角书斋');
});

test('e2e：PUT /api/settings 保存并覆写 env', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const put = await c.put('/api/settings', { SITE_NAME: '新站名' });
  assert.equal(put.status, 200);
  const r = await c.get('/api/settings');
  assert.equal((await r.json()).SITE_NAME, '新站名');
});

test('e2e：非法 SITE_URL 被拒绝', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const r = await c.put('/api/settings', { SITE_URL: 'ftp://bad' });
  assert.equal(r.status, 400);
});

test('e2e：空字符串保存为明确空值', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  await c.put('/api/settings', { SITE_POEM: '' });
  const r = await c.get('/api/settings');
  assert.equal((await r.json()).SITE_POEM, '');
});

test('e2e：未登录访问设置 401', async () => {
  if (!HAS_BUILD) return;
  c.setSession('');
  const r = await c.get('/api/settings');
  assert.equal(r.status, 401);
});

test('e2e：无 Origin 的 PUT 被 CSRF 拒绝（403）', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const r = await c.raw('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ SITE_NAME: 'csrf' }),
  });
  assert.equal(r.status, 403);
});

// ---- 密码修改 ----

async function resetPasswordToDefault() {
  // 清空 DB 凭据和限流记录，回退到 env 密码 admin123
  await c.sql("DELETE FROM admin_credentials");
  await c.sql("DELETE FROM login_attempts WHERE key LIKE 'pwd:%'");
  c.setSession('');
}

test('e2e：修改密码——原密码正确，新密码生效并立即可用', async () => {
  if (!HAS_BUILD) return;
  await resetPasswordToDefault();
  await c.login(); // admin123
  const r = await c.post('/api/auth/password', { old_password: 'admin123', new_password: 'new-secret-9' });
  assert.equal(r.status, 200);
  // 清除旧会话后：原密码不可登录，新密码可登录
  c.setSession('');
  const old = await c.post('/api/auth/login', { password: 'admin123' });
  assert.equal(old.status, 401);
  const ok = await c.post('/api/auth/login', { password: 'new-secret-9' });
  assert.equal(ok.status, 200);
});

test('e2e：修改密码——错误原密码被拒绝', async () => {
  if (!HAS_BUILD) return;
  await resetPasswordToDefault();
  await c.login(); // admin123
  const r = await c.post('/api/auth/password', { old_password: 'wrong-pw', new_password: 'new-secret-9' });
  assert.equal(r.status, 401);
});

test('e2e：修改密码——弱密码被拒绝', async () => {
  if (!HAS_BUILD) return;
  await resetPasswordToDefault();
  await c.login();
  // 太短
  assert.equal((await c.post('/api/auth/password', { old_password: 'admin123', new_password: 'ab' })).status, 400);
  // 纯字母
  assert.equal((await c.post('/api/auth/password', { old_password: 'admin123', new_password: 'abcdefgh' })).status, 400);
});

test('e2e：修改密码——新旧相同拒绝', async () => {
  if (!HAS_BUILD) return;
  await resetPasswordToDefault();
  await c.login();
  const r = await c.post('/api/auth/password', { old_password: 'admin123', new_password: 'admin123' });
  assert.equal(r.status, 400);
});

test('e2e：修改密码后旧会话立即失效', async () => {
  if (!HAS_BUILD) return;
  await resetPasswordToDefault();
  await c.login();
  const meBefore = await c.get('/api/auth/me');
  assert.equal(meBefore.status, 200);
  // 改密码
  await c.post('/api/auth/password', { old_password: 'admin123', new_password: 'pwd-v2-test' });
  // 原 cookie 应失效
  const meAfter = await c.get('/api/auth/me');
  assert.equal(meAfter.status, 401);
});

test('e2e：修改密码——无 Origin 被 CSRF 拒绝', async () => {
  if (!HAS_BUILD) return;
  await resetPasswordToDefault();
  await c.login();
  const r = await c.raw('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_password: 'admin123', new_password: 'new-pw' }),
  });
  assert.equal(r.status, 403);
});

// ---- 登录 CSRF ----

test('e2e：登录——无 Origin 被 CSRF 拒绝', async () => {
  if (!HAS_BUILD) return;
  const r = await c.anon('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin123' }),
  });
  assert.equal(r.status, 403);
});