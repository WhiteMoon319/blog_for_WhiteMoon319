// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { json, checkCsrf, passwordStrength } from '../../../lib/auth';
import { envOf, createUser, getUserByUsername, getUserByEmail } from '../../../lib/db';
import { hashPassword } from '../../../lib/db/credentials.ts';
import { hashVerificationCode, generateVerificationCode, sendEmail } from '../../../lib/email';
import { clientIp, consumeLoginAttempt } from '../../../lib/ratelimit';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  const attempt = await consumeLoginAttempt(env.DB, `register:${clientIp(ctx.request)}`, {
    max: 3, windowSec: 3600,
  });
  if (!attempt.ok) {
    return new Response(JSON.stringify({ error: 'too many attempts, try again later' }), {
      status: 429, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { username?: unknown; email?: unknown; password?: unknown; display_name?: unknown };
  try { body = await ctx.request.json(); } catch { return json({ error: 'bad request' }, 400); }

  if (typeof body.username !== 'string' || !body.username.trim()) return json({ error: 'username required' }, 400);
  if (typeof body.email !== 'string' || !body.email.trim()) return json({ error: 'email required' }, 400);
  if (typeof body.password !== 'string') return json({ error: 'password required' }, 400);

  const username = body.username.trim().toLowerCase();
  const email = body.email.trim().toLowerCase();
  const displayName = typeof body.display_name === 'string' && body.display_name.trim() ? body.display_name.trim() : username;

  if (username.length < 2 || username.length > 64) return json({ error: '用户名 2-64 字符' }, 400);
  if (!/^[a-zA-Z0-9_\u4e00-\u9fff]+$/.test(username)) return json({ error: '用户名仅允许字母、数字、下划线与中文' }, 400);

  if (email.length > 254) return json({ error: 'email 过长' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'email 格式无效' }, 400);

  const pwdErr = passwordStrength(body.password);
  if (pwdErr) return json({ error: pwdErr }, 400);

  if (await getUserByUsername(env.DB, username)) return json({ error: '用户名已被注册' }, 409);
  if (await getUserByEmail(env.DB, email)) return json({ error: '邮箱已被注册' }, 409);

  const passwordHash = await hashPassword(body.password);
  const user = await createUser(env.DB, { username, email, password_hash: passwordHash, display_name: displayName, role: 'reader' });
  if (!user) return json({ error: '注册失败' }, 500);

  // 发送验证码
  try {
    const code = await generateVerificationCode();
    const codeHash = await hashVerificationCode(code);
    await env.DB.prepare(
      `INSERT INTO email_verifications (user_id, code_hash, expires_at)
       VALUES (?, ?, datetime('now', '+5 minutes'))`,
    ).bind(user.id, codeHash).run();

    await sendEmail(email, '验证您的邮箱 - 月下独酌',
      `感谢注册「月下独酌」博客！\n\n您的验证码是：${code}\n\n5 分钟内有效，请勿泄露给他人。`,
    );
  } catch (e) {
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
    return json({ error: '注册失败，请稍后重试' }, 500);
  }

  return json({ ok: true, user_id: user.id, message: '注册成功，请查看邮箱验证码' }, 201);
}