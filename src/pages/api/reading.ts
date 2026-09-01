// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf } from '../../lib/db';
import { requireAnyUser, json, checkCsrf } from '../../lib/auth';
import { saveReading } from '../../lib/db/reading';

export const prerender = false;

// 静默记录阅读进度（离开页面时由 sendBeacon 调用）
export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAnyUser(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);

  let body: { postId?: unknown; scrollPct?: unknown };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const postId = Number(body.postId);
  if (!Number.isInteger(postId) || postId <= 0) return json({ error: 'invalid postId' }, 400);

  // scrollPct：必须是数字；允许 -1（仅记录已读）；正常范围 0-100
  const rawPct = body.scrollPct;
  if (typeof rawPct !== 'number' || !Number.isFinite(rawPct)) {
    return json({ error: 'invalid scrollPct' }, 400);
  }
  const scrollPct = Math.max(-1, Math.min(100, Math.round(rawPct)));

  // 仅记录已发布文章
  const post = await env.DB.prepare(`SELECT id, status, deleted_at FROM posts WHERE id = ?`).bind(postId).first<{ id: number; status: string; deleted_at: string | null }>();
  if (!post || post.status !== 'published' || post.deleted_at) return json({ error: 'not found' }, 404);

  await saveReading(env.DB, auth.user.id, postId, scrollPct);
  return json({ ok: true });
}
