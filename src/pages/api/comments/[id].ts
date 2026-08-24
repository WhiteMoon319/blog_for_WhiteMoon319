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
import { deleteComment } from '../../../lib/db/comments';

export const prerender = false;

export async function DELETE(ctx: APIContext): Promise<Response> {
  const auth = await requireAnyUser(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 400);

  const comment = await env.DB.prepare(`SELECT id, user_id, status FROM comments WHERE id = ?`).bind(id).first<{ id: number; user_id: number; status: string }>();
  if (!comment) return json({ error: 'not found' }, 404);
  if (comment.user_id !== auth.user.id) return json({ error: 'forbidden' }, 403);
  if (comment.status === 'approved') return json({ error: 'approved comments cannot be deleted by user' }, 403);

  await deleteComment(env.DB, id);
  return json({ ok: true });
}