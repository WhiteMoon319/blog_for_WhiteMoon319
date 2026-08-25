// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, updatePassword } from '../../../lib/db';
import { requireAnyUser, json, checkCsrf } from '../../../lib/auth';
import { hashPassword } from '../../../lib/db/credentials';
import { clientIp, consumeLoginAttempt } from '../../../lib/ratelimit';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAnyUser(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);

  const attempt = await consumeLoginAttempt(env.DB, `pwd:${clientIp(ctx.request)}`, { max: 5, windowSec: 300 });
  if (!attempt.ok) return json({ error: 'too many attempts, try again later' }, 429);

  let body: { old_password?: unknown; new_password?: unknown };
  try { body = await ctx.request.json(); } catch { return json({ error: 'bad request' }, 400); }
  if (typeof body.old_password !== 'string' || typeof body.new_password !== 'string') return json({ error: 'old_password and new_password required' }, 400);
  if (body.old_password === body.new_password) return json({ error: '新旧密码不能相同' }, 400);
  if (body.new_password.length < 8) return json({ error: '密码至少 8 位' }, 400);
  if (!/[a-zA-Z]/.test(body.new_password) || (!/\d/.test(body.new_password) && !/[^a-zA-Z0-9]/.test(body.new_password))) {
    return json({ error: '密码至少包含字母和数字/特殊字符' }, 400);
  }

  // 验证旧密码
  const { verifyPasswordHash } = await import('../../../lib/db/credentials.ts');
  let passwordOk = false;
  if (auth.user.password_hash) {
    passwordOk = await verifyPasswordHash(body.old_password, auth.user.password_hash);
  } else if (auth.user.role === 'admin') {
    const expected = env.BLOG_ADMIN_PASSWORD;
    if (typeof expected === 'string' && expected.length >= 4 && expected.length === body.old_password.length) {
      let diff = 0;
      for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ body.old_password.charCodeAt(i);
      passwordOk = diff === 0;
    }
  }
  if (!passwordOk) return json({ error: '原密码错误' }, 401);

  const hash = await hashPassword(body.new_password);
  await updatePassword(env.DB, auth.user.id, hash);
  return json({ ok: true, message: '密码已更新，请重新登录' });
}