import type { APIContext } from 'astro';
import { envOf, getPostById, getLatestPostVersion, updatePostWithTags, deletePost, listPostOwnTags, getCollectionById, isSlugConflict, parseTagsStrict } from '../../../lib/db';
import { getSession, json, requireAuth, isAdmin } from '../../../lib/auth';
import { isValidSlug } from '../../../lib/utils';
import { parseId } from '../../../lib/api/validate';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);

  const env = await envOf();
  const post = await getPostById(env.DB, id);
  if (!post) return json({ error: 'not found' }, 404);

  const session = await getSession(ctx);
  if (post.status === 'draft' && !isAdmin(session)) {
    return json({ error: 'not found' }, 404);
  }
  const tags = await listPostOwnTags(env.DB, id);
  const version = await getLatestPostVersion(env.DB, id);
  return json({ post, tags, version });
}

export async function PUT(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;

  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);

  let body: Record<string, unknown>;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const patch: Record<string, string | number | null> = {};
  let versionMessage: string | undefined;
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.slug === 'string' && body.slug.trim()) {
    if (!isValidSlug(body.slug.trim())) {
      return json({ error: 'invalid slug: 仅允许中英文、数字与连字符，且不以连字符起止' }, 400);
    }
    patch.slug = body.slug.trim();
  }
  if ('collection_id' in body) {
    patch.collection_id =
      typeof body.collection_id === 'number' && Number.isInteger(body.collection_id)
        ? body.collection_id
        : null;
  }
  if (typeof body.summary === 'string') patch.summary = body.summary;
  if (typeof body.content_md === 'string') patch.content_md = body.content_md;
  if (typeof body.cover_url === 'string') patch.cover_url = body.cover_url;
  if (body.status === 'published' || body.status === 'draft') patch.status = body.status;
  if (typeof body.version_message === 'string' && body.version_message.trim()) {
    versionMessage = body.version_message.trim();
  }
  const baseVersion =
    typeof body.base_version === 'number' && Number.isInteger(body.base_version) && body.base_version >= 0
      ? body.base_version
      : undefined;

  // 携带 tags 时严格校验（非法/超限 400，绝不静默丢弃）；未携带则不动标签
  const parsedTags = body.tags === undefined ? null : parseTagsStrict(body.tags);
  if (parsedTags !== null && !parsedTags.ok) return json({ error: parsedTags.error }, 400);

  try {
    const env = await envOf();
    if ('collection_id' in patch && patch.collection_id !== null && !(await getCollectionById(env.DB, Number(patch.collection_id)))) {
      return json({ error: 'collection not found' }, 404);
    }
    const updated = await updatePostWithTags(
      env.DB,
      id,
      patch,
      parsedTags === null ? null : parsedTags.tags,
      versionMessage,
      baseVersion,
    );
    if (updated === 'conflict') {
      return json({ error: '版本冲突：该文章已在别处被修改，请刷新后重试' }, 409);
    }
    if (!updated) return json({ error: 'not found' }, 404);
    return json({ post: updated.post, tags: updated.tags, version: await getLatestPostVersion(env.DB, id) });
  } catch (e) {
    if (isSlugConflict(e)) return json({ error: 'slug already exists' }, 409);
    throw e;
  }
}

export async function DELETE(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;

  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);

  const env = await envOf();
  const deleted = await deletePost(env.DB, id);
  if (!deleted) return json({ error: 'not found' }, 404);
  return json({ ok: true });
}