// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { json, checkCsrf } from '../../../lib/auth';
import { envOf, setUserEmailVerified } from '../../../lib/db';
import { verifyCodeHash } from '../../../lib/email';
import { clientIp, consumeLoginAttempt } from '../../../lib/ratelimit';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  let body: { user_id?: unknown; code?: unknown };
  try { body = await ctx.request.json(); } catch { return json({ error: 'bad request' }, 400); }
  if (typeof body.user_id !== 'number' || typeof body.code !== 'string') {
    return json({ error: 'user_id and code required' }, 400);
  }

  // 双重限流：IP + user_id
  const ip = clientIp(ctx.request);
  const ipOk = await consumeLoginAttempt(env.DB, `verify:${ip}`, { max: 10, windowSec: 300 });
  if (!ipOk.ok) return json({ error: 'too many attempts, try again later' }, 429);
  const userOk = await consumeLoginAttempt(env.DB, `verify:uid:${body.user_id}`, { max: 10, windowSec: 300 });
  if (!userOk.ok) return json({ error: 'too many attempts, try again later' }, 429);

  const row = await env.DB.prepare(
    `SELECT id, code_hash, expires_at, consumed FROM email_verifications
     WHERE user_id = ? AND consumed = 0 AND expires_at > datetime('now')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(body.user_id).first<{ id: number; code_hash: string; expires_at: string; consumed: number }>();

  if (!row) {
    // 不区分"错误"与"已过期"
    return json({ error: '验证码无效或已过期' }, 400);
  }

  if (!(await verifyCodeHash(body.code, row.code_hash))) {
    return json({ error: '验证码无效或已过期' }, 400);
  }

  // 标记已使用
  await env.DB.prepare('UPDATE email_verifications SET consumed = 1 WHERE id = ?').bind(row.id).run();
  await setUserEmailVerified(env.DB, body.user_id);

  return json({ ok: true });
}