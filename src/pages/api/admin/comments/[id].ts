// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf } from '../../../../lib/db';
import { json, requireAdmin, checkCsrf } from '../../../../lib/auth';
import { updateCommentStatus, deleteComment } from '../../../../lib/db/comments';

export const prerender = false;

export async function PUT(ctx: APIContext): Promise<Response> {
  const auth = await requireAdmin(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 400);

  let body: { status?: unknown };
  try { body = await ctx.request.json(); } catch { return json({ error: 'bad request' }, 400); }
  if (body.status !== 'approved' && body.status !== 'rejected') return json({ error: 'status must be approved or rejected' }, 400);

  const ok = await updateCommentStatus(env.DB, id, body.status);
  if (!ok) return json({ error: 'not found or already processed' }, 404);
  return json({ ok: true });
}

export async function DELETE(ctx: APIContext): Promise<Response> {
  const auth = await requireAdmin(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 400);

  await deleteComment(env.DB, id);
  return json({ ok: true });
}