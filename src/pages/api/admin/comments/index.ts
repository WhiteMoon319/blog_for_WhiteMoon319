// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, listPosts } from '../../../../lib/db';
import { json, requireAdmin } from '../../../../lib/auth';
import { listCommentsForAdmin } from '../../../../lib/db/comments';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAdmin(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();

  const url = new URL(ctx.request.url);
  const status = url.searchParams.get('status') ?? 'pending';
  if (!['pending', 'approved', 'rejected'].includes(status)) return json({ error: 'invalid status' }, 400);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const postId = Number(url.searchParams.get('post_id')) || undefined;

  const { comments, total } = await listCommentsForAdmin(env.DB, status, page, 20, postId);
  return json({ comments, total, page });
}