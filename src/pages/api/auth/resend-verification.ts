// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { json, checkCsrf } from '../../../lib/auth';
import { envOf } from '../../../lib/db';
import { hashVerificationCode, generateVerificationCode, sendEmail } from '../../../lib/email';
import { clientIp, consumeLoginAttempt } from '../../../lib/ratelimit';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  let body: { email?: unknown };
  try { body = await ctx.request.json(); } catch { return json({ error: 'bad request' }, 400); }
  if (typeof body.email !== 'string' || !body.email.trim()) return json({ error: 'email required' }, 400);

  const email = body.email.trim().toLowerCase();

  // 60s 冷却
  const coolOk = await consumeLoginAttempt(env.DB, `resend:${email}`, { max: 1, windowSec: 60 });
  if (!coolOk.ok) return json({ error: '请 60 秒后重试' }, 429);

  const user = await env.DB.prepare('SELECT id, email, email_verified FROM users WHERE email = ?').bind(email).first<{ id: number; email: string; email_verified: number }>();
  if (!user || user.email_verified) return json({ error: '邮箱未注册或已验证' }, 400);

  // 作废旧码
  await env.DB.prepare('UPDATE email_verifications SET consumed = 1 WHERE user_id = ? AND consumed = 0').bind(user.id).run();

  const code = await generateVerificationCode();
  const codeHash = await hashVerificationCode(code);
  await env.DB.prepare(
    `INSERT INTO email_verifications (user_id, code_hash, expires_at)
     VALUES (?, ?, datetime('now', '+5 minutes'))`,
  ).bind(user.id, codeHash).run();

  try {
    await sendEmail(email, '验证您的邮箱 - 月下独酌',
      `您的验证码是：${code}\n\n5 分钟内有效。`,
    );
  } catch {
    return json({ error: '邮件发送失败，请稍后重试' }, 500);
  }

  return json({ ok: true });
}