import type { APIContext } from 'astro';
import { checkCsrf, json, requireAuth } from '../../../lib/auth.ts';
import { envOf } from '../../../lib/db/index.ts';
import { deletePage, getPageById, pageSlugConflicts, updatePage, validatePageSlug } from '../../../lib/db/pages.ts';

export const prerender = false;

// GET /api/pages/{id} — 管理员查看任意页面（含未发布）
export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  const id = parseInt(ctx.params.id!, 10);
  if (!Number.isFinite(id)) return json({ error: 'invalid id' }, 400);
  const page = await getPageById(env.DB, id);
  if (!page) return json({ error: 'page not found' }, 404);
  return json({ page });
}

// PUT /api/pages/{id}
export async function PUT(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  const id = parseInt(ctx.params.id!, 10);
  if (!Number.isFinite(id)) return json({ error: 'invalid id' }, 400);

  let body: Record<string, unknown>;
  try { body = await ctx.request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const data: Record<string, string | number> = {};
  if (typeof body.title === 'string') data.title = body.title.trim();
  if (typeof body.content_md === 'string') data.content_md = body.content_md;
  if (body.published === 1 || body.published === 0) data.published = body.published as number;
  if (typeof body.slug === 'string') {
    const s = body.slug.trim().toLowerCase();
    if (s) {
      const v = validatePageSlug(s);
      if (!v.ok) return json({ error: v.error }, 400);
      const conflict = await pageSlugConflicts(env.DB, s);
      if (conflict) return json({ error: conflict }, 409);
      data.slug = s;
    }
  }
  if (Object.keys(data).length === 0) return json({ ok: true, message: 'no fields' });

  try {
    const page = await updatePage(env.DB, id, data);
    if (!page) return json({ error: 'page not found' }, 404);
    return json({ page });
  } catch (e) {
    return json({ error: (e as Error).message }, 409);
  }
}

// DELETE /api/pages/{id}
export async function DELETE(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  const id = parseInt(ctx.params.id!, 10);
  if (!Number.isFinite(id)) return json({ error: 'invalid id' }, 400);
  const deleted = await deletePage(env.DB, id);
  return json({ ok: deleted });
}