// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 可选署名作者列表：编辑器作者选择器用（作者与管理员均可读，含各自已发布篇数）。

import type { APIContext } from 'astro';
import { envOf, listAuthors } from '../../../lib/db';
import { json, requireAuthor } from '../../../lib/auth';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuthor(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  return json({ authors: await listAuthors(env.DB, 200) });
}
