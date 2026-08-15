import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeLoginAttempt, clientIp } from '../src/lib/ratelimit.ts';

class FakeKV {
  private map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

function env(max: number) {
  return {
    RATE_LIMIT: new FakeKV() as unknown as KVNamespace,
    LOGIN_RATE_LIMIT_MAX: max,
    LOGIN_RATE_LIMIT_WINDOW: 300,
  };
}

test('登录限流：超过阈值返回 429 且带 Retry-After', async () => {
  const e = env(3);
  for (let i = 0; i < 3; i++) {
    const r = await consumeLoginAttempt(e, '1.2.3.4');
    assert.equal(r.ok, true);
  }
  const blocked = await consumeLoginAttempt(e, '1.2.3.4');
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0);
});

test('登录限流：窗口过期后重置计数', async () => {
  const e = env(2);
  await consumeLoginAttempt(e, '5.6.7.8');
  await consumeLoginAttempt(e, '5.6.7.8');
  const blocked = await consumeLoginAttempt(e, '5.6.7.8');
  assert.equal(blocked.ok, false);

  const kv = e.RATE_LIMIT as unknown as FakeKV;
  const old = JSON.stringify({ count: 1, start: Math.floor(Date.now() / 1000) - 400 });
  await kv.put('login:5.6.7.8', old);
  const r = await consumeLoginAttempt(e, '5.6.7.8');
  assert.equal(r.ok, true);
});

test('登录限流：不同 IP 互不影响', async () => {
  const e = env(1);
  const a = await consumeLoginAttempt(e, '10.0.0.1');
  assert.equal(a.ok, true);
  const b = await consumeLoginAttempt(e, '10.0.0.2');
  assert.equal(b.ok, true);
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