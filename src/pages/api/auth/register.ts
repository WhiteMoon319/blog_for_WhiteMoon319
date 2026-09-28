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
import { hashVerificationCode, generateVerificationCode, sendEmail, verificationEmail } from '../../../lib/email';
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
  if (displayName.length > 30) return json({ error: '昵称最长 30 字' }, 400);

  if (username.length < 2 || username.length > 64) return json({ error: '用户名 2-64 字符' }, 400);
  if (!/^[a-zA-Z0-9]+$/.test(username)) return json({ error: '用户名仅允许英文字母与数字' }, 400);

  if (email.length > 254) return json({ error: 'email 过长' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'email 格式无效' }, 400);

  const pwdErr = passwordStrength(body.password);
  if (pwdErr) return json({ error: pwdErr }, 400);

  if (await getUserByUsername(env.DB, username)) return json({ error: '用户名已被注册' }, 409);
  if (await getUserByEmail(env.DB, email)) return json({ error: '邮箱已被注册' }, 409);

  const passwordHash = await hashPassword(body.password);
  const user = await createUser(env.DB, { username, email, password_hash: passwordHash, display_name: displayName, role: 'reader' });
  if (!user) return json({ error: '注册失败' }, 500);

  // 验证码发送失败不再回滚账号。
  // 原实现是失败即 DELETE FROM users：于是「SMTP 没配好」等于注册整体不可用，
  // 而且重试会直接撞「邮箱已被注册」，用户被永久锁在门外。
  // 现在保留账号、如实告知前端「邮件没发出去」，由注册页引导点「重新发送」。
  let emailSent = true;
  try {
    const code = await generateVerificationCode();
    const codeHash = await hashVerificationCode(code);
    await env.DB.prepare(
      `INSERT INTO email_verifications (user_id, code_hash, expires_at)
       VALUES (?, ?, datetime('now', '+5 minutes'))`,
    ).bind(user.id, codeHash).run();

    const mail = verificationEmail(code, '感谢注册「月下独酌」博客！');
    await sendEmail(email, mail.subject, mail.text);
  } catch {
    emailSent = false;
  }

  return json(
    {
      ok: true,
      user_id: user.id,
      email_sent: emailSent,
      message: emailSent ? '注册成功，请查看邮箱验证码' : '账号已创建，但验证邮件暂时发不出，请稍后点「重新发送」',
    },
    201,
  );
}