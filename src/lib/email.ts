// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 邮件发送适配层：Worker connect() 原生 SMTP 客户端。
// - SMTPS（465，隐式 TLS）与 STARTTLS（587）自适应
// - AUTH LOGIN 鉴权
// - 支持中文 UTF-8 正文（8bit）
// 测试时通过 __setEmailSender 注入 mock；未配置 SMTP 凭据时抛 email_not_configured。

import { connect } from 'cloudflare:sockets';
import { envOf } from './db/index.ts';
import { decryptApiKey } from './ai-credentials.ts';
import { getEmailCredential } from './db/email-credentials.ts';

type EmailSender = (to: string, subject: string, text: string) => Promise<void>;

let _senderOverride: EmailSender | null = null;

export function __setEmailSender(fn: EmailSender | null): void {
  _senderOverride = fn;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

async function makeLineReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{ nextLine: () => Promise<string> }> {
  let buffer = '';
  return {
    async nextLine() {
      for (;;) {
        const nl = buffer.indexOf('\n');
        if (nl !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          return line;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('smtp_connection_closed');
        buffer += decoder.decode(value, { stream: true });
      }
    },
  };
}

export interface SmtpCreds {
  host: string;
  port: number;
  username: string;
  password: string;
  fromEmail: string;
}

// 与 SMTP 服务器完成握手 + 鉴权，随后调用 action（在其中完成 MAIL/RCPT/DATA/QUIT 或仅收尾）。
export async function smtpSession(
  cred: SmtpCreds,
  action: (api: { write: (s: string) => Promise<void>; nextLine: () => Promise<string> }) => Promise<void>,
): Promise<void> {
  const port = cred.port || 465;
  const secureTransport = port === 465 ? 'on' : 'starttls';

  const socket = connect({ hostname: cred.host, port } as any, { secureTransport } as any);
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const { nextLine } = await makeLineReader(reader);

  const write = async (s: string) => { await writer.write(encoder.encode(s)); };

  const expectReply = async (wants: string[], ctx: string) => {
    const line = await nextLine();
    if (!wants.some((want) => line.startsWith(want))) throw new Error(`smtp_${ctx}_failed: ${line}`);
    return line;
  };

  try {
    await expectReply(['220'], 'greeting');

    await write(`EHLO ${cred.host}\r\n`);
    // EHLO 多行：直到行首含 "250 "（非 "250-"）
    for (;;) {
      const line = await nextLine();
      const done = !line.startsWith('250-');
      if (done) break;
    }

    if (port !== 465) {
      await write('STARTTLS\r\n');
      await expectReply(['220'], 'starttls');
      socket.startTls();
    }

    await write('AUTH LOGIN\r\n');
    await expectReply(['334'], 'auth');
    await write(`${b64(cred.username)}\r\n`);
    await expectReply(['334'], 'auth');
    await write(`${b64(cred.password)}\r\n`);
    await expectReply(['235'], 'auth');

    await action({ write, nextLine });

    try { await writer.close(); } catch { /* ignore */ }
  } catch (e) {
    try { await writer.close(); } catch { /* ignore */ }
    throw e;
  }
}

// 正式发送：需 DB 中已保存凭据
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (_senderOverride) return _senderOverride(to, subject, text);
  const env = await envOf();
  if (!env.AI_SETTINGS_ENCRYPTION_KEY) throw new Error('email_key_not_configured');
  if (!to || !to.includes('@')) throw new Error('invalid_recipient');

  const cred = await getEmailCredential(env.DB);
  if (!cred || !cred.smtp_host || !cred.smtp_username || !cred.smtp_password_ciphertext || !cred.from_email) throw new Error('email_not_configured');

  let password: string;
  try {
    password = await decryptApiKey(env.AI_SETTINGS_ENCRYPTION_KEY, cred.smtp_password_ciphertext);
  } catch {
    throw new Error('email_decrypt_failed');
  }

  const body =
    `From: ${cred.from_email}\r\n` +
    `To: <${to}>\r\n` +
    `Subject: ${subject}\r\n` +
    `Date: ${new Date().toUTCString()}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `Content-Transfer-Encoding: 8bit\r\n` +
    `\r\n` +
    `${text}\r\n` +
    `.\r\n`;

  await smtpSession(
    { host: cred.smtp_host, port: cred.smtp_port || 465, username: cred.smtp_username, password, fromEmail: cred.from_email },
    async ({ write, nextLine }) => {
      await write(`MAIL FROM:<${cred.from_email}>\r\n`);
      await expectReplyHelper(write, nextLine, ['250'], 'mailfrom');
      await write(`RCPT TO:<${to}>\r\n`);
      await expectReplyHelper(write, nextLine, ['250', '251'], 'rcpt');
      await write('DATA\r\n');
      await expectReplyHelper(write, nextLine, ['354'], 'data');
      await write(body);
      await expectReplyHelper(write, nextLine, ['250'], 'data_end');
      await write('QUIT\r\n');
    },
  );
}

// 配置测试：用表单凭据建立会话完成 AUTH 即视为通过（不发信）
export async function testSmtp(creds: SmtpCreds): Promise<void> {
  await smtpSession(creds, async ({ write }) => {
    await write('QUIT\r\n');
  });
}

async function expectReplyHelper(
  write: (s: string) => Promise<void>,
  nextLine: () => Promise<string>,
  wants: string[],
  ctx: string,
): Promise<string> {
  void write;
  const line = await nextLine();
  if (!wants.some((want) => line.startsWith(want))) throw new Error(`smtp_${ctx}_failed: ${line}`);
  return line;
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
  if (msg.includes('email_not_configured')) return '尚未配置 SMTP 凭据';
  if (msg.includes('smtp_auth_failed')) return 'SMTP 鉴权失败（用户名或授权码错误）';
  if (msg.includes('smtp_greeting_failed')) return 'SMTP 服务器不可达';
  if (msg.includes('smtp_starttls_failed')) return 'STARTTLS 升级失败';
  if (msg.includes('smtp_connection_closed')) return 'SMTP 连接中断';
  if (msg.includes('invalid_recipient')) return '收件地址无效';
  return '邮件发送失败';
}