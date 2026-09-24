// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 私有文集的协作者管理：只有归属人与管理员能看成员与待处理申请、能拉人、
// 能同意/拒绝申请。其他作者只能走 /join 自己申请。

import type { APIContext } from 'astro';
import {
  envOf,
  getUserById,
  listCollectionCollaborators,
  listCollectionInvites,
  addCollectionCollaborator,
  removeCollectionCollaborator,
  decideCollectionInvite,
} from '../../../../lib/db';
import { json, checkCsrf } from '../../../../lib/auth';
import { requireCollectionAccess } from '../../../../lib/api/collection-access.ts';
import { parseId } from '../../../../lib/api/validate';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);
  const env = await envOf();
  const access = await requireCollectionAccess(ctx, env.DB, id);
  if (!access.ok) return access.response;

  const [members, invites] = await Promise.all([
    listCollectionCollaborators(env.DB, id),
    listCollectionInvites(env.DB, id, 'pending'),
  ]);
  return json({ members, invites });
}

export async function POST(ctx: APIContext): Promise<Response> {
  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);
  const access = await requireCollectionAccess(ctx, env.DB, id);
  if (!access.ok) return access.response;

  let body: { user_id?: unknown; approve_id?: unknown; reject_id?: unknown };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // 裁决申请：同意即自动成为协作者
  if (body.approve_id !== undefined || body.reject_id !== undefined) {
    const raw = body.approve_id !== undefined ? body.approve_id : body.reject_id;
    const inviteId = typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 0;
    if (!inviteId) return json({ error: 'invalid invite id' }, 400);
    const agreed = body.approve_id !== undefined;
    // 先核对这条申请确实属于本文集，避免越权裁决他人文集的申请
    const pending = await listCollectionInvites(env.DB, id, 'pending');
    if (!pending.some((p) => p.id === inviteId)) return json({ error: 'invite not found' }, 404);
    const decided = await decideCollectionInvite(env.DB, inviteId, agreed);
    if (!decided) return json({ error: 'invite not found' }, 404);
    return json({ ok: true, invite: decided });
  }

  // 直接拉入协作者
  const userId = typeof body.user_id === 'number' && Number.isInteger(body.user_id) && body.user_id > 0 ? body.user_id : 0;
  if (!userId) return json({ error: 'user_id required' }, 400);
  if (userId === access.collection.created_by) {
    return json({ error: '归属人无需成为协作者' }, 400);
  }
  const target = await getUserById(env.DB, userId);
  if (!target) return json({ error: 'user not found' }, 404);
  if (target.role !== 'author' && target.role !== 'admin') {
    return json({ error: '只能拉入作者或管理员' }, 400);
  }
  await addCollectionCollaborator(env.DB, id, userId);
  return json({ ok: true, user_id: userId });
}

export async function DELETE(ctx: APIContext): Promise<Response> {
  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);
  const access = await requireCollectionAccess(ctx, env.DB, id);
  if (!access.ok) return access.response;

  const userId = parseId(ctx.url.searchParams.get('user_id') ?? undefined);
  if (!userId) return json({ error: 'user_id required' }, 400);
  const removed = await removeCollectionCollaborator(env.DB, id, userId);
  if (!removed) return json({ error: 'not a collaborator' }, 404);
  // 既有文章保留原位：移除协作者只影响后续写入
  return json({ ok: true });
}
