// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf } from '../../../../lib/db';
import { requireAnyUser, json, checkCsrf } from '../../../../lib/auth';

export const prerender = false;

// 切换点赞：已赞变取消，未赞则点赞
export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAnyUser(ctx);
  if (!auth.ok) return auth.response;
  if (!auth.emailVerified) return json({ error: 'email_required' }, 403);
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 400);

  // 检查评论存在且已批准
  const comment = await env.DB.prepare(`SELECT id, status FROM comments WHERE id = ?`).bind(id).first<{ id: number; status: string }>();
  if (!comment || comment.status !== 'approved') return json({ error: 'not found' }, 404);

  // 检查是否已赞
  const existing = await env.DB.prepare(
    `SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?`,
  ).bind(id, auth.user.id).first<{ 1: number }>();

  if (existing) {
    // 取消点赞
    await env.DB.prepare(`DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?`).bind(id, auth.user.id).run();
  } else {
    // 点赞
    await env.DB.prepare(`INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)`).bind(id, auth.user.id).run();
  }

  // 返回新点赞数
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?`).bind(id).first<{ n: number }>();

  return json({ liked: !existing, likes_count: count?.n ?? 0 });
}