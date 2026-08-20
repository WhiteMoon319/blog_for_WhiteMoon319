import type { APIContext } from 'astro';
import { checkCsrf, json, requireAuth } from '../../../lib/auth.ts';
import { envOf } from '../../../lib/db/index.ts';
import { createPage, listPages, pageSlugConflicts, validatePageSlug } from '../../../lib/db/pages.ts';

export const prerender = false;

// GET /api/pages — 公开列表仅返回已发布页面；管理员带 ?all=1 查询全部
export async function GET(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  const all = ctx.url.searchParams.get('all') === '1';
  if (all) {
    const auth = await requireAuth(ctx);
    if (!auth.ok) return auth.response;
  }
  const pages = await listPages(env.DB, all);
  return json({ pages });
}

// POST /api/pages — 管理员新建
export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) {
    return json({ error: 'forbidden: invalid origin' }, 403);
  }

  let body: { slug?: unknown; title?: unknown; content_md?: unknown; published?: unknown };
  try { body = await ctx.request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const contentMd = typeof body.content_md === 'string' ? body.content_md : '';
  const published = body.published === 1 || body.published === true ? 1 : 0;

  if (!slug || !title) return json({ error: 'slug 与标题不可为空' }, 400);

  const v = validatePageSlug(slug);
  if (!v.ok) return json({ error: v.error }, 400);

  try {
    const conflict = await pageSlugConflicts(env.DB, slug);
    if (conflict) return json({ error: conflict }, 409);
    const page = await createPage(env.DB, { slug, title, content_md: contentMd, published });
    return json({ page }, 201);
  } catch (e) {
    return json({ error: (e as Error).message }, 409);
  }
}