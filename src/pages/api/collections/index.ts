import type { APIContext } from 'astro';
import { envOf, listCollections, createCollection, isSlugConflict } from '../../../lib/db';
import { json, requireAuth } from '../../../lib/auth';
import { ensureSlug, isValidSlug } from '../../../lib/utils';

export const prerender = false;

export async function GET(_ctx: APIContext): Promise<Response> {
  const env = await envOf();
  const collections = await listCollections(env.DB);
  return json({ collections });
}

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  if (typeof body.title !== 'string' || !body.title.trim()) {
    return json({ error: 'title required' }, 400);
  }

  const slug = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : undefined;
  if (slug && !isValidSlug(slug)) {
    return json({ error: 'invalid slug: 仅允许中英文、数字与连字符，且不以连字符起止' }, 400);
  }

  try {
    const env = await envOf();
    const created = await createCollection(env.DB, {
      title: body.title.trim(),
      slug: ensureSlug(slug, body.title, 'collection'),
      summary: typeof body.summary === 'string' ? body.summary : '',
      theme_color: typeof body.theme_color === 'string' && body.theme_color ? body.theme_color : '#c23a30',
      sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
    });
    return json({ collection: created }, 201);
  } catch (e) {
    if (isSlugConflict(e)) return json({ error: 'slug already exists' }, 409);
    throw e;
  }
}