import type { APIContext } from 'astro';
import { envOf, getPostById, getPostVersion, updatePost, isSlugConflict } from '../../../../../../lib/db';
import { json, requireAuth } from '../../../../../../lib/auth';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;

  const id = Number(ctx.params.id);
  const version = Number(ctx.params.version);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(version) || version <= 0) {
    return json({ error: 'invalid id or version' }, 400);
  }

  const env = await envOf();
  const post = await getPostById(env.DB, id);
  if (!post) return json({ error: 'not found' }, 404);

  const ver = await getPostVersion(env.DB, id, version);
  if (!ver) return json({ error: 'version not found' }, 404);

  try {
    const updated = await updatePost(
      env.DB,
      id,
      {
        title: ver.title,
        slug: ver.slug,
        collection_id: ver.collection_id,
        summary: ver.summary,
        content_md: ver.content_md,
        cover_url: ver.cover_url,
        status: ver.status,
      },
      `回滚至 v${ver.version}`,
    );
    if (!updated) return json({ error: 'not found' }, 404);
    return json({ ok: true, post: updated });
  } catch (e) {
    if (isSlugConflict(e)) {
      return json({ error: `slug 冲突：v${version} 的 slug 已被其他文章占用` }, 409);
    }
    throw e;
  }
}