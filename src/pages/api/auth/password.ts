// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { checkCsrf, checkPassword, clearSessionCookie, json, requireAuth } from '../../../lib/auth.ts';
import { envOf } from '../../../lib/db/index.ts';
import { getCredentials, hashPassword, incrementSessionVersion, setCredentials } from '../../../lib/db/credentials.ts';
import { consumeLoginAttempt, clientIp } from '../../../lib/ratelimit.ts';

export const prerender = false;

const MIN_PASSWORD_LENGTH = 8;

function passwordStrength(password: string): { ok: true } | { ok: false; error: string } {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `密码至少 ${MIN_PASSWORD_LENGTH} 位` };
  }
  // 至少包含两类字符：字母 + (数字或特殊)
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^a-zA-Z\d]/.test(password);
  if (!hasLetter || (!hasDigit && !hasSpecial)) {
    return { ok: false, error: '密码至少包含字母和数字/特殊字符' };
  }
  return { ok: true };
}

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) {
    return json({ error: 'forbidden: invalid origin' }, 403);
  }

  const attempt = await consumeLoginAttempt(env.DB, `pwd:${clientIp(ctx.request)}`, {
    max: 5,
    windowSec: 300,
  });
  if (!attempt.ok) {
    return new Response(JSON.stringify({ error: 'too many attempts, try again later' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(attempt.retryAfter) },
    });
  }

  let body: { old_password?: unknown; new_password?: unknown };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (typeof body.old_password !== 'string' || typeof body.new_password !== 'string') {
    return json({ error: 'old_password and new_password required' }, 400);
  }
  if (body.old_password === body.new_password) {
    return json({ error: '新旧密码不能相同' }, 400);
  }

  const strength = passwordStrength(body.new_password);
  if (!strength.ok) {
    return json({ error: strength.error }, 400);
  }

  if (!(await checkPassword(env, body.old_password))) {
    return json({ error: '原密码错误' }, 401);
  }

  const hash = await hashPassword(body.new_password);
  const existing = await getCredentials(env.DB);
  const newVersion = (existing?.session_version ?? 1) + 1;
  await setCredentials(env.DB, hash, newVersion);

  // 修改密码后清除当前会话，强制重新登录
  clearSessionCookie(ctx);

  return json({ ok: true, message: '密码已更新，请重新登录' });
}