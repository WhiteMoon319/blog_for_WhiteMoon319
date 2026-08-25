// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, getEmailCredential, saveEmailCredential, deleteEmailCredential } from '../../../lib/db';
import { json, requireAuth, checkCsrf } from '../../../lib/auth';
import { encryptApiKey } from '../../../lib/ai-credentials';
import { testSmtpCreds, sanitizeEmailError } from '../../../lib/email';

export const prerender = false;

// GET /api/settings/email — 当前邮件配置状态（不含密码）
export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  const cred = await getEmailCredential(env.DB);
  if (!cred || !cred.smtp_host) return json({ configured: false });
  return json({
    configured: true,
    smtp_host: cred.smtp_host,
    smtp_port: cred.smtp_port,
    smtp_username: cred.smtp_username,
    from_email: cred.from_email,
  });
}

// POST /api/settings/email — 用表单凭据发一封真实测试邮件，成功后加密保存
export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);
  if (!env.AI_SETTINGS_ENCRYPTION_KEY) return json({ error: 'encryption_key_not_configured' }, 500);

  let body: { smtp_host?: unknown; smtp_port?: unknown; smtp_username?: unknown; smtp_password?: unknown; from_email?: unknown; test_email?: unknown };
  try { body = await ctx.request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const host = typeof body.smtp_host === 'string' ? body.smtp_host.trim() : '';
  const port = Number(body.smtp_port) || 465;
  const username = typeof body.smtp_username === 'string' ? body.smtp_username.trim() : '';
  const password = typeof body.smtp_password === 'string' ? body.smtp_password.trim() : '';
  const fromEmail = typeof body.from_email === 'string' ? body.from_email.trim() : '';
  const testEmail = (typeof body.test_email === 'string' && body.test_email.trim()) ? body.test_email.trim() : fromEmail;

  if (!host) return json({ error: 'SMTP 服务器必填' }, 400);
  if (!username || !password) return json({ error: '用户名与授权码必填' }, 400);
  if (!fromEmail || !fromEmail.includes('@')) return json({ error: '发件邮箱格式无效' }, 400);
  if (!testEmail.includes('@')) return json({ error: '测试收件邮箱格式无效' }, 400);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return json({ error: '端口无效' }, 400);

  // 真实发送测试邮件
  try {
    await testSmtpCreds(host, port, username, password, fromEmail, testEmail);
  } catch (e) {
    return json({ ok: false, error: sanitizeEmailError(e) });
  }

  // 测试通过后加密落库
  let ciphertext: string;
  try {
    ciphertext = await encryptApiKey(env.AI_SETTINGS_ENCRYPTION_KEY, password);
  } catch {
    return json({ error: '加密失败' }, 500);
  }
  await saveEmailCredential(env.DB, { smtp_host: host, smtp_port: port, smtp_username: username, ciphertext, from_email: fromEmail });

  return json({ ok: true, configured: true });
}

// DELETE /api/settings/email — 清除邮件配置
export async function DELETE(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);
  await deleteEmailCredential(env.DB);
  return json({ ok: true });
}