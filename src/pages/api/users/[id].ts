// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 管理员编辑他人资料（昵称、作者简介）；本人自助修改走 /api/account。

import type { APIContext } from 'astro';
import { envOf, getUserById, updateProfile } from '../../../lib/db';
import { json, requireAdmin, checkCsrf } from '../../../lib/auth';

export const prerender = false;

/** 作者简介长度上限：作者页会整段展示，过长会挤掉文章列表 */
const BIO_MAX = 200;

export async function PUT(ctx: APIContext): Promise<Response> {
  const auth = await requireAdmin(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 400);

  let body: { display_name?: unknown; bio?: unknown };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const patch: { display_name?: string; bio?: string } = {};
  if (typeof body.display_name === 'string' && body.display_name.trim()) {
    if (body.display_name.trim().length > 30) return json({ error: '昵称最长 30 字' }, 400);
    patch.display_name = body.display_name.trim();
  }
  if (typeof body.bio === 'string') {
    const bio = body.bio.trim();
    if (bio.length > BIO_MAX) return json({ error: `简介最长 ${BIO_MAX} 字` }, 400);
    // '' 是合法值：用于清空简介
    patch.bio = bio;
  }
  if (Object.keys(patch).length === 0) return json({ error: '没有可更新的字段' }, 400);

  const target = await getUserById(env.DB, id);
  if (!target) return json({ error: 'not found' }, 404);
  const ok = await updateProfile(env.DB, id, patch);
  if (!ok) return json({ error: 'update failed' }, 500);
  return json({ ok: true, id, display_name: patch.display_name ?? target.display_name, bio: patch.bio ?? target.bio });
}
