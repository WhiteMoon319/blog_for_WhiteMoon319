// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 申请协作：私有文集不接受陌生作者写入，作者本人可在写作区发起申请，
// 归属人（或管理员）在文集面板同意后成为协作者。

import type { APIContext } from 'astro';
import {
  envOf,
  getCollectionById,
  isCollectionCollaborator,
  listInvitesByUser,
  requestCollectionInvite,
} from '../../../../lib/db';
import { json, requireAuthor, checkCsrf } from '../../../../lib/auth';
import { parseId } from '../../../../lib/api/validate';

export const prerender = false;

const MESSAGE_MAX = 200;

export async function POST(ctx: APIContext): Promise<Response> {
  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);
  const auth = await requireAuthor(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  const collection = await getCollectionById(env.DB, id);
  if (!collection) return json({ error: 'not found' }, 404);

  // 可写的人不需要申请：公用文集直接写，归属人与管理员本就有权
  if (auth.user.role === 'admin' || collection.created_by === auth.user.id || collection.is_public === 1) {
    return json({ error: '该文集本就允许写入，无需申请' }, 400);
  }
  if (await isCollectionCollaborator(env.DB, id, auth.user.id)) {
    return json({ error: '你已是该文集的协作者' }, 400);
  }

  let body: { message?: unknown } = {};
  try {
    body = await ctx.request.json();
  } catch {
    // 允许空 body：申请可以不写理由
  }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MESSAGE_MAX) : '';

  const result = await requestCollectionInvite(env.DB, id, auth.user.id, message);
  if (result === 'accepted') return json({ error: '你已是该文集的协作者' }, 400);
  const mine = (await listInvitesByUser(env.DB, auth.user.id)).find((i) => i.collection_id === id);
  return json({ ok: true, status: mine?.status ?? 'pending', resubmitted: result === 'resubmitted' }, 201);
}
