// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf } from '../../../lib/db';
import { requireAnyUser, json, checkCsrf } from '../../../lib/auth';
import { clientIp, consumeLoginAttempt } from '../../../lib/ratelimit';
import { publicBase } from '../../../lib/utils';

export const prerender = false;

const ALLOWED = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as const;
const MAX_SIZE = 2 * 1024 * 1024;

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAnyUser(ctx);
  if (!auth.ok) return auth.response;
  if (!auth.emailVerified) return json({ error: 'email_required' }, 403);
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);

  const attempt = await consumeLoginAttempt(env.DB, `commentimg:${clientIp(ctx.request)}`, { max: 10, windowSec: 60 });
  if (!attempt.ok) return json({ error: 'too many uploads' }, 429);

  const form = await ctx.request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string' || file.size === 0) return json({ error: 'file required' }, 400);
  if (file.size > MAX_SIZE) return json({ error: '图片不能超过 2MB' }, 400);

  const buf = new Uint8Array(await file.arrayBuffer());

  // 复用 upload.ts 的 magic byte 嗅探
  const { detectImageType } = await import('../../../lib/upload');
  const detected = detectImageType(buf, file.type);
  if (!detected) return json({ error: '仅支持 png/jpeg/webp/gif 图片' }, 400);

  const ext = detected === 'image/png' ? 'png' : detected === 'image/jpeg' ? 'jpg' : detected === 'image/webp' ? 'webp' : 'gif';

  const key = `comment/${crypto.randomUUID()}.${ext}`;
  await env.IMAGES.put(key, buf, { httpMetadata: { contentType: detected } });
  const url = `${publicBase(env.R2_PUBLIC_URL)}/${key}`;

  return json({ key, url });
}