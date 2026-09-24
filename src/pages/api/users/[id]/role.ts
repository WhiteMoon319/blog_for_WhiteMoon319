// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用户角色调整：把读者提为作者（或降回读者），是作者身份的唯一入口。
// 管理员角色不可通过本接口获得或失去。

import type { APIContext } from 'astro';
import { envOf, getUserById, setUserRole } from '../../../../lib/db';
import { json, requireAdmin, checkCsrf } from '../../../../lib/auth';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAdmin(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 400);

  let body: { role?: unknown };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const role = body.role;
  if (role !== 'reader' && role !== 'author') {
    return json({ error: 'role 只能是 reader 或 author' }, 400);
  }

  const target = await getUserById(env.DB, id);
  if (!target) return json({ error: 'not found' }, 404);
  // 管理员角色是既定事实，不允许在本接口里出现（含"最后一个管理员"自锁风险）
  if (target.role === 'admin') {
    return json({ error: '不能修改管理员角色' }, 403);
  }
  if (target.role === role) return json({ ok: true, id, role });

  const ok = await setUserRole(env.DB, id, role);
  if (!ok) return json({ error: 'role update failed' }, 409);
  return json({ ok: true, id, role });
}
