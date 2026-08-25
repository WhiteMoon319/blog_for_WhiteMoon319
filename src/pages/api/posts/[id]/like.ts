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

// 切换文章点赞：未登录/未验证邮箱需先处理认证
export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAnyUser(ctx);
  if (!auth.ok) return auth.response;
  if (!auth.emailVerified) return json({ error: 'email_required' }, 403);
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 400);

  // 文章必须存在且已发布
  const post = await env.DB.prepare(`SELECT id, status, deleted_at FROM posts WHERE id = ?`).bind(id).first<{ id: number; status: string; deleted_at: string | null }>();
  if (!post || post.status !== 'published' || post.deleted_at) return json({ error: 'not found' }, 404);

  // 检查是否已赞
  const existing = await env.DB.prepare(`SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`).bind(id, auth.user.id).first<{ 1: number }>();
  if (existing) {
    await env.DB.prepare(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`).bind(id, auth.user.id).run();
  } else {
    await env.DB.prepare(`INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)`).bind(id, auth.user.id).run();
  }

  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?`).bind(id).first<{ n: number }>();
  return json({ liked: !existing, likes_count: count?.n ?? 0 });
}