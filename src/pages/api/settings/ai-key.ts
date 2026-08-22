import type { APIContext } from 'astro';
import { envOf, deleteAiCredential } from '../../../lib/db';
import { json, requireAuth, checkCsrf } from '../../../lib/auth';

export const prerender = false;

export async function DELETE(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);

  await deleteAiCredential(env.DB);
  return json({ ok: true });
}