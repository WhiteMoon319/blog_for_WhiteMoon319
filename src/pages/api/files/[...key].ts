// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { json } from '../../../lib/auth';
import { envOf } from '../../../lib/db';
import { isInlineSafeType } from '../../../lib/upload';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const key = ctx.params.key;
  if (!key) return json({ error: 'not found' }, 404);

  const env = await envOf();
  const object = await env.IMAGES.get(key);
  if (!object) return json({ error: 'not found' }, 404);

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  // key 为 uploads/yyyy/MM/uuid.ext，永不变更，可长缓存
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (!isInlineSafeType(contentType)) {
    const name = key.split('/').pop() ?? 'download';
    headers.set('Content-Disposition', `attachment; filename="${name}"`);
  }
  if (object.size !== undefined) headers.set('Content-Length', String(object.size));

  return new Response(object.body, { headers });
}