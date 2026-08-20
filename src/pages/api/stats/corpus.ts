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