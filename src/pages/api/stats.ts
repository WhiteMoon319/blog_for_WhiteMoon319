import type { APIContext } from 'astro';
import { json, requireAuth } from '../../lib/auth.ts';
import { envOf } from '../../lib/db/index.ts';
import { getTrendStats } from '../../lib/db/stats.ts';

export const prerender = false;

// GET /api/stats?days=30 — 阅读趋势汇总（仅管理员）
export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  const rawDays = Number(ctx.url.searchParams.get('days') ?? '30');
  const days = Number.isInteger(rawDays) && rawDays > 0 ? rawDays : 30;
  const stats = await getTrendStats(env.DB, days);
  return json(stats);
}