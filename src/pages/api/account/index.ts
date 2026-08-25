// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, updateProfile, updateEmail } from '../../../lib/db';
import { requireAnyUser, json, checkCsrf } from '../../../lib/auth';
import { hashVerificationCode, generateVerificationCode, sendEmail } from '../../../lib/email';

export const prerender = false;

// GET /api/account/me — 当前用户信息
export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAnyUser(ctx);
  if (!auth.ok) return auth.response;
  return json({
    id: auth.user.id,
    username: auth.user.username,
    display_name: auth.user.display_name,
    email: auth.user.email,
    email_verified: auth.user.email_verified === 1,
    avatar_url: auth.user.avatar_url,
    role: auth.user.role,
    notify_email: auth.user.notify_email === 1,
    created_at: auth.user.created_at,
  });
}

// PUT /api/account/profile — 修改昵称/头像/通知设置
export async function PUT(ctx: APIContext): Promise<Response> {
  const auth = await requireAnyUser(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);

  let body: { display_name?: unknown; avatar_url?: unknown; notify_email?: unknown; email?: unknown };
  try { body = await ctx.request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const profile: { display_name?: string; avatar_url?: string; notify_email?: number } = {};
  if (typeof body.display_name === 'string' && body.display_name.trim()) profile.display_name = body.display_name.trim();
  if (typeof body.avatar_url === 'string') profile.avatar_url = body.avatar_url;
  if (body.notify_email === true) profile.notify_email = 1;
  else if (body.notify_email === false) profile.notify_email = 0;

  if (Object.keys(profile).length > 0) await updateProfile(env.DB, auth.user.id, profile);

  // 更换邮箱：标记为未验证，发送验证码
  if (typeof body.email === 'string' && body.email.trim().toLowerCase() !== auth.user.email) {
    const newEmail = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return json({ error: 'email 格式无效' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(newEmail).first<{ id: number }>();
    if (existing) return json({ error: '该邮箱已被使用' }, 409);
    await updateEmail(env.DB, auth.user.id, newEmail);
    // 发送验证码
    try {
      const code = await generateVerificationCode();
      const codeHash = await hashVerificationCode(code);
      await env.DB.prepare(`INSERT INTO email_verifications (user_id, code_hash, expires_at) VALUES (?, ?, datetime('now', '+5 minutes'))`).bind(auth.user.id, codeHash).run();
      await sendEmail(newEmail, '验证您的邮箱 - 月下独酌', `您的验证码是：${code}\n\n5 分钟内有效。`);
    } catch { /* 邮件发送失败静默 */ }
  }

  return json({ ok: true });
}