import type { APIContext } from 'astro';
import { envOf, getPostById, listPostVersions } from '../../../../../lib/db';
import { json, requireAuth } from '../../../../../lib/auth';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 400);

  const env = await envOf();
  const post = await getPostById(env.DB, id);
  if (!post) return json({ error: 'not found' }, 404);

  const versions = await listPostVersions(env.DB, id);
  return json({ versions });
}