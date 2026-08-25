// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 邮件发送适配层：使用 nodemailer 通过 SMTP 发送。
// 凭据优先使用环境变量（SMTP_HOST/SMTP_USER/SMTP_PASS 等），
// 未设置时回退到 DB email_credentials 表（管理后台配置，加密存储）。
// 测试时通过 __setEmailSender 注入 mock。

import nodemailer from 'nodemailer';
import { envOf } from './db/index.ts';
import { decryptApiKey } from './ai-credentials.ts';
import { getEmailCredential } from './db/email-credentials.ts';

type EmailSender = (to: string, subject: string, text: string) => Promise<void>;

let _senderOverride: EmailSender | null = null;

export function __setEmailSender(fn: EmailSender | null): void {
  _senderOverride = fn;
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (_senderOverride) return _senderOverride(to, subject, text);

  const env = await envOf();
  if (!to || !to.includes('@')) throw new Error('invalid_recipient');

  // 优先使用环境变量（生产部署配置 SMTP_USER/SMTP_PASS 等）
  let transporter: nodemailer.Transporter;
  let from: string;

  if (env.SMTP_USER) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST || 'smtp.qq.com',
      port: Number(env.SMTP_PORT) || 465,
      secure: (env.SMTP_PORT || '465') === '465',
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
    from = env.SMTP_FROM || env.SMTP_USER;
  } else {
    // 回退到 DB 配置
    if (!env.AI_SETTINGS_ENCRYPTION_KEY) throw new Error('email_key_not_configured');
    const cred = await getEmailCredential(env.DB);
    if (!cred || !cred.from_email) throw new Error('email_not_configured');

    const ciphertext = cred.api_key_ciphertext || cred.smtp_password_ciphertext;
    if (!ciphertext) throw new Error('email_not_configured');

    let password: string;
    try { password = await decryptApiKey(env.AI_SETTINGS_ENCRYPTION_KEY, ciphertext); } catch { throw new Error('email_decrypt_failed'); }

    transporter = nodemailer.createTransport({
      host: cred.smtp_host || 'smtp.qq.com',
      port: cred.smtp_port || 465,
      secure: (cred.smtp_port || 465) === 465,
      auth: { user: cred.smtp_username || '3287047638@qq.com', pass: password },
    });
    from = cred.from_email;
  }

  await transporter.sendMail({ from: `"月下独酌" <${from}>`, to, subject, text });
}

export async function testSmtpCreds(host: string, port: number, user: string, pass: string, from: string, to: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: `"月下独酌" <${from}>`,
    to,
    subject: '测试邮件 - 月下独酌',
    text: '这是一封测试邮件，来自月下独酌博客。\n\n如果收到，说明邮件配置正常。',
  });
}

export async function generateVerificationCode(): Promise<string> {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function hashVerificationCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyCodeHash(code: string, hash: string): Promise<boolean> {
  return (await hashVerificationCode(code)) === hash;
}

export function sanitizeEmailError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('email_not_configured')) return '尚未配置邮件';
  if (msg.includes('email_decrypt_failed')) return '凭据解密失败';
  if (msg.includes('email_key_not_configured')) return '加密密钥未配置';
  if (msg.includes('invalid_recipient')) return '收件地址无效';
  if (msg.includes('Invalid login') || msg.includes('535') || msg.includes('authentication')) return 'SMTP 鉴权失败';
  if (msg.includes('connect ECONNREFUSED') || msg.includes('ENOTFOUND')) return 'SMTP 服务器不可达';
  return `邮件发送失败：${msg.slice(0, 120)}`;
}