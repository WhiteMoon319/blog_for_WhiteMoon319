// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { requireAuth } from '../../../lib/auth.ts';
import { envOf } from '../../../lib/db';
import { json } from '../../../lib/auth.ts';
import { getCorpusStats } from '../../../lib/db/stats.ts';

export const prerender = false;

// GET /api/stats/corpus?collection=<id|none> — 字数统计（仅管理员），独立于趋势，供文集切换时按需刷新
export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();

  const rawCollection = ctx.url.searchParams.get('collection');
  let collectionScope: number | null | undefined;
  if (rawCollection === null || rawCollection === '') {
    collectionScope = undefined;
  } else if (rawCollection === 'none') {
    collectionScope = null;
  } else {
    const n = Number(rawCollection);
    collectionScope = Number.isInteger(n) && n > 0 ? n : undefined;
  }

  return json(await getCorpusStats(env.DB, collectionScope));
}