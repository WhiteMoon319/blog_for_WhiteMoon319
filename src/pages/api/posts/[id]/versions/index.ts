// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, listPostVersions } from '../../../../../lib/db';
import { json } from '../../../../../lib/auth';
import { requirePostAccess } from '../../../../../lib/api/post-access.ts';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 400);

  const env = await envOf();
  const access = await requirePostAccess(ctx, env.DB, id);
  if (!access.ok) return access.response;

  const versions = await listPostVersions(env.DB, id);
  return json({ versions });
}