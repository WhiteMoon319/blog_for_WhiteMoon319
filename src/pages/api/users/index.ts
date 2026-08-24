// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, listUsers } from '../../../lib/db';
import { json, requireAdmin } from '../../../lib/auth';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAdmin(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  const users = await listUsers(env.DB);
  return json({ users });
}