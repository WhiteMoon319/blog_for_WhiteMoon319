// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { json, requireAuth } from '../../lib/auth.ts';
import { envOf } from '../../lib/db/index.ts';
import { getCorpusStats, getTrendStats } from '../../lib/db/stats.ts';

export const prerender = false;

// GET /api/stats?days=30&collection=3 — 阅读趋势汇总 + 字数统计（仅管理员）。
// collection 可选：数字 id 限某文集；none 表示未分类文章；缺省为全站。
export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  const rawDays = Number(ctx.url.searchParams.get('days') ?? '30');
  const days = Number.isInteger(rawDays) && rawDays > 0 ? rawDays : 30;

  const rawCollection = ctx.url.searchParams.get('collection');
  let collectionScope: number | null | undefined;
  if (rawCollection === null || rawCollection === '') {
    collectionScope = undefined; // 全站
  } else if (rawCollection === 'none') {
    collectionScope = null; // 未分类
  } else {
    const n = Number(rawCollection);
    collectionScope = Number.isInteger(n) && n > 0 ? n : undefined;
  }

  const [stats, corpus] = await Promise.all([
    getTrendStats(env.DB, days),
    getCorpusStats(env.DB, collectionScope),
  ]);
  return json({ ...stats, corpus });
}