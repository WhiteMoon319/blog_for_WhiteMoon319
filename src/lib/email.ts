// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 邮件发送适配层：支持 SMTP 中继或 Worker connect() 原生 SMTP。
// 当前使用 HTTP 中继模式（配置 relay_url 即可），也可扩展为原生 SMTP。
// 测试时通过 __setEmailSender 注入 mock。

import { envOf } from './db/index.ts';
import { encryptApiKey, decryptApiKey } from './ai-credentials.ts';
import { getEmailCredential, saveEmailCredential } from './db/email-credentials.ts';

type EmailSender = (to: string, subject: string, text: string) => Promise<void>;

let _senderOverride: EmailSender | null = null;

export function __setEmailSender(fn: EmailSender | null): void {
  _senderOverride = fn;
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (_senderOverride) return _senderOverride(to, subject, text);

  const env = await envOf();
  if (!env.AI_SETTINGS_ENCRYPTION_KEY) throw new Error('email_key_not_configured');

  const cred = await getEmailCredential(env.DB);
  if (!cred || !cred.smtp_host) throw new Error('email_not_configured');

  let password: string;
  try {
    password = await decryptApiKey(env.AI_SETTINGS_ENCRYPTION_KEY, cred.smtp_password_ciphertext);
  } catch {
    throw new Error('email_decrypt_failed');
  }

  // 使用 Worker connect() 原生 SMTP 发送
  // smtp.qq.com:465（SMTPS/SSL）
  const socket = await (globalThis as any).connect({ hostname: cred.smtp_host, port: cred.smtp_port, tls: true });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  async function read(): Promise<string> {
    const { value, done } = await reader.read();
    if (done) return '';
    return decoder.decode(value);
  }
  async function write(line: string): Promise<void> {
    await writer.write(encoder.encode(line + '\r\n'));
  }
  async function cmd(line: string, expected: string): Promise<string> {
    await write(line);
    const resp = await read();
    if (!resp.startsWith(expected)) throw new Error(`SMTP error: ${resp.trim()}`);
    return resp;
  }

  await read(); // banner
  await cmd(`EHLO blog`, '250');
  await cmd(`AUTH LOGIN`, '334');
  await cmd(btoa(cred.smtp_username), '334');
  await cmd(btoa(password), '235');
  await cmd(`MAIL FROM:<${cred.from_email}>`, '250');
  await cmd(`RCPT TO:<${to}>`, '250');
  await cmd(`DATA`, '354');
  await write(`From: ${cred.from_email}`);
  await write(`To: ${to}`);
  await write(`Subject: ${subject}`);
  await write(`Content-Type: text/plain; charset=utf-8`);
  await write('');
  await write(text);
  await cmd(`.`, '250');
  await cmd(`QUIT`, '221');
  writer.close();
  reader.cancel();
}

export async function generateVerificationCode(): Promise<string> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  return code;
}

export async function hashVerificationCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyCodeHash(code: string, hash: string): Promise<boolean> {
  return (await hashVerificationCode(code)) === hash;
}