import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeLoginAttempt, clientIp } from '../src/lib/ratelimit.ts';
import { makeTestDb } from './helpers/d1.ts';

async function withDb(fn: (db: D1Database) => Promise<void>): Promise<void> {
  const handle = await makeTestDb();
  try {
    await fn(handle.db);
  } finally {
    await handle.dispose();
  }
}

test('登录限流：超过阈值返回 429 且带 Retry-After', async () => {
  await withDb(async (db) => {
    for (let i = 0; i < 3; i++) {
      const r = await consumeLoginAttempt(db, '1.2.3.4', { max: 3, windowSec: 300 });
      assert.equal(r.ok, true);
    }
    const blocked = await consumeLoginAttempt(db, '1.2.3.4', { max: 3, windowSec: 300 });
    assert.equal(blocked.ok, false);
    assert.ok(blocked.retryAfter > 0);
  });
});

test('登录限流：窗口过期后重置计数', async () => {
  await withDb(async (db) => {
    await consumeLoginAttempt(db, '5.6.7.8', { max: 2, windowSec: 300 });
    await consumeLoginAttempt(db, '5.6.7.8', { max: 2, windowSec: 300 });
    const blocked = await consumeLoginAttempt(db, '5.6.7.8', { max: 2, windowSec: 300 });
    assert.equal(blocked.ok, false);

    await db
      .prepare('UPDATE login_attempts SET window_end = ? WHERE key = ?')
      .bind(Math.floor(Date.now() / 1000) - 100, '5.6.7.8')
      .run();
    const r = await consumeLoginAttempt(db, '5.6.7.8', { max: 2, windowSec: 300 });
    assert.equal(r.ok, true, '过期窗口应重置计数');
  });
});

test('登录限流：不同 IP 互不影响', async () => {
  await withDb(async (db) => {
    const a = await consumeLoginAttempt(db, '10.0.0.1', { max: 1, windowSec: 300 });
    assert.equal(a.ok, true);
    const b = await consumeLoginAttempt(db, '10.0.0.2', { max: 1, windowSec: 300 });
    assert.equal(b.ok, true);
  });
});

test('登录限流：并发请求不会全部通过（原子计数）', async () => {
  await withDb(async (db) => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeLoginAttempt(db, '203.0.113.7', { max: 5, windowSec: 300 })),
    );
    const passed = results.filter((r) => r.ok).length;
    assert.ok(passed >= 1, '至少有一个请求通过');
    assert.ok(passed <= 5, `20 个并发请求只有 ${passed} 个通过，不应绕过阈值`);
    assert.equal(results.filter((r) => !r.ok).every((r) => r.retryAfter > 0), true, '被拒请求应带 Retry-After');
  });
});

test('登录限流：存储不可用时 fail-open，不抛 500', async () => {
  const handle = await makeTestDb();
  await handle.dispose();
  const r = await consumeLoginAttempt(handle.db, '9.9.9.9', { max: 3, windowSec: 300 });
  assert.equal(r.ok, true, '存储异常时应放行而不是抛错');
});

test('clientIp：优先 CF-Connecting-IP，不采信伪造转发头', () => {
  const r = new Request('http://local/api/auth/login', {
    headers: {
      'CF-Connecting-IP': '203.0.113.9',
      'x-forwarded-for': '6.6.6.6',
      'x-real-ip': '7.7.7.7',
    },
  });
  assert.equal(clientIp(r), '203.0.113.9');

  const r2 = new Request('http://local/api/auth/login', {
    headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
  });
  assert.equal(clientIp(r2), '1.1.1.1');
});