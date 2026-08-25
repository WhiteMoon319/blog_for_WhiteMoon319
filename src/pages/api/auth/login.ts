// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { checkCsrf, json, setSessionCookie } from '../../../lib/auth';
import { envOf, getUserByUsername, getUserByEmail } from '../../../lib/db';
import { hashPassword, verifyPasswordHash } from '../../../lib/db/credentials';
import { clientIp, consumeLoginAttempt } from '../../../lib/ratelimit';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (typeof body.password !== 'string') {
    return json({ error: 'password required' }, 400);
  }

  // 统一登录：默认管理员登录（旧客户端不传 username 时回退 admin）
  const raw = typeof body.username === 'string' && body.username.trim() ? body.username.trim() : 'admin';
  const ident = raw.toLowerCase();

  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) {
    return json({ error: 'forbidden: invalid origin' }, 403);
  }

  const attempt = await consumeLoginAttempt(env.DB, clientIp(ctx.request), {
    max: env.LOGIN_RATE_LIMIT_MAX,
    windowSec: env.LOGIN_RATE_LIMIT_WINDOW,
  });
  if (!attempt.ok) {
    return new Response(JSON.stringify({ error: 'too many attempts, try again later' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(attempt.retryAfter) },
    });
  }

const user = (await getUserByUsername(env.DB, ident)) ?? (await getUserByEmail(env.DB, ident));
  let ok = false;
  if (user && user.password_hash) {
    ok = await verifyPasswordHash(body.password, user.password_hash);
  } else if (user && !user.password_hash && user.role === 'admin') {
    // 管理员空密码哈希（种子占位）：回退到 env BLOG_ADMIN_PASSWORD 明文比对
    const expected = env.BLOG_ADMIN_PASSWORD;
    if (typeof expected === 'string' && expected.length >= 4) {
      if (expected.length === body.password.length) {
        let diff = 0;
        for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ body.password.charCodeAt(i);
        ok = diff === 0;
      }
    }
  } else {
    // 用户不存在：执行等价 PBKDF2 消除计时侧信道（防用户名枚举）
    await hashPassword(body.password);
  }
  if (!user || !ok) {
    return json({ error: 'invalid credentials' }, 401);
  }
  if (user.status !== 'active') {
    return json({ error: 'account disabled' }, 403);
  }
  await setSessionCookie(ctx, `user:${user.id}`, user.session_version);
  return json({ ok: true, role: user.role, username: user.username });
}