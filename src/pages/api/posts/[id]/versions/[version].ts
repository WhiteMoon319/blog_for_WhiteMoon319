import type { APIContext } from 'astro';
import { envOf, getPostById, getPostVersion } from '../../../../../lib/db';
import { json, requireAuth } from '../../../../../lib/auth';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
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

  return json({ version: ver });
}