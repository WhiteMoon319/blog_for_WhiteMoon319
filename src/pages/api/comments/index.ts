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
import { createComment } from '../../../lib/db/comments';
import { getAllSettings } from '../../../lib/db/settings';
import { clientIp, consumeLoginAttempt } from '../../../lib/ratelimit';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAnyUser(ctx);
  if (!auth.ok) return auth.response;
  if (!auth.emailVerified) return json({ error: 'email_required' }, 403);

  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);

  const attempt = await consumeLoginAttempt(env.DB, `comment:${clientIp(ctx.request)}`, { max: 10, windowSec: 60 });
  if (!attempt.ok) return json({ error: 'too many comments' }, 429);

  let body: { post_id?: unknown; parent_id?: unknown; body?: unknown; attachments?: unknown };
  try { body = await ctx.request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const postId = Number(body.post_id);
  if (!Number.isInteger(postId) || postId <= 0) return json({ error: 'post_id required' }, 400);
  if (typeof body.body !== 'string' || !body.body.trim()) return json({ error: 'body required' }, 400);
  const commentBody = body.body.trim();
  if (commentBody.length > 2000) return json({ error: 'body too long' }, 400);

  const post = await env.DB.prepare(`SELECT id, status, deleted_at FROM posts WHERE id = ?`).bind(postId).first<{ id: number; status: string; deleted_at: string | null }>();
  if (!post || post.status !== 'published' || post.deleted_at) return json({ error: 'post not found' }, 404);

  let parentId: number | null = null;
  if (body.parent_id !== undefined && body.parent_id !== null) {
    parentId = Number(body.parent_id);
    if (!Number.isInteger(parentId) || parentId <= 0) return json({ error: 'invalid parent_id' }, 400);
    const parent = await env.DB.prepare(`SELECT id, parent_id, status FROM comments WHERE id = ? AND post_id = ?`).bind(parentId, postId).first<{ id: number; parent_id: number | null; status: string }>();
    if (!parent || parent.status !== 'approved') return json({ error: 'parent not found' }, 404);
    if (parent.parent_id !== null) return json({ error: 'nested reply too deep' }, 400);
  }

  let attachments: string[] = [];
  if (Array.isArray(body.attachments)) {
    attachments = body.attachments.filter((k) => typeof k === 'string' && /^comment\/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif)$/i.test(k));
    if (attachments.length > 3) return json({ error: '最多 3 张图片' }, 400);
  }

  const comment = await createComment(env.DB, {
    post_id: postId,
    parent_id: parentId,
    user_id: auth.user.id,
    body: body.body.trim(),
    attachments,
  });

  // 命中敏感关键词 → 保持 pending 人工审核；未命中 → 直接展示
  const settings = await getAllSettings(env.DB);
  const keywords = settings.comment_review_keywords ?? '';
  const needsReview = keywords
    ? keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean).some((w) => commentBody.toLowerCase().includes(w))
    : false;
  if (!needsReview) {
    await env.DB.prepare(`UPDATE comments SET status = 'approved' WHERE id = ?`).bind(comment!.id).run();
  }

  return json({ comment }, 201);
}