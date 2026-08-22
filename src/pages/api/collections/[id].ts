import type { APIContext } from 'astro';
import {
  envOf,
  getCollectionById,
  updateCollectionWithTags,
  deleteCollection,
  listCollectionTags,
  isSlugConflict,
  parseTagsStrict,
} from '../../../lib/db';
import { json, requireAuth, checkCsrf } from '../../../lib/auth';
import { isValidSlug } from '../../../lib/utils';
import { parseId } from '../../../lib/api/validate';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);
  const env = await envOf();
  const collection = await getCollectionById(env.DB, id);
  if (!collection) return json({ error: 'not found' }, 404);
  const tags = await listCollectionTags(env.DB, id);
  return json({ collection, tags });
}

export async function PUT(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);

  let body: Record<string, unknown>;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const patch: Record<string, string | number> = {};
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.slug === 'string' && body.slug.trim()) {
    if (!isValidSlug(body.slug.trim())) {
      return json({ error: 'invalid slug: 仅允许中英文、数字与连字符，且不以连字符起止' }, 400);
    }
    patch.slug = body.slug.trim();
  }
  if (typeof body.summary === 'string') patch.summary = body.summary;
  if (typeof body.theme_color === 'string' && body.theme_color) {
    if (!/^#[0-9a-fA-F]{6}$/.test(body.theme_color)) {
      return json({ error: 'invalid theme_color: 需为 #RRGGBB 格式' }, 400);
    }
    patch.theme_color = body.theme_color;
  }
  if (typeof body.sort_order === 'number') patch.sort_order = body.sort_order;
  if (typeof body.post_order === 'string') {
    if (body.post_order !== 'asc' && body.post_order !== 'desc') {
      return json({ error: 'invalid post_order: 仅允许 asc（旧在前）或 desc（新在前）' }, 400);
    }
    patch.post_order = body.post_order;
  }
  if (typeof body.ref_summaries === 'number') {
    patch.ref_summaries = body.ref_summaries === 1 ? 1 : 0;
  }

  // 携带 tags 时严格校验（非法/超限 400）；未携带则不动标签
  const parsedTags = body.tags === undefined ? null : parseTagsStrict(body.tags);
  if (parsedTags !== null && !parsedTags.ok) return json({ error: parsedTags.error }, 400);

  try {
    const updated = await updateCollectionWithTags(env.DB, id, patch, parsedTags === null ? null : parsedTags.tags);
    if (!updated) return json({ error: 'not found' }, 404);
    return json({ collection: updated.collection, tags: updated.tags });
  } catch (e) {
    if (isSlugConflict(e)) return json({ error: 'slug already exists' }, 409);
    throw e;
  }
}

export async function DELETE(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);

  const deleted = await deleteCollection(env.DB, id);
  if (!deleted) return json({ error: 'not found' }, 404);
  return json({ ok: true });
}