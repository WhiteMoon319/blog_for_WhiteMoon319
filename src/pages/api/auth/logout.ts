import type { APIContext } from 'astro';
import { checkCsrf, clearSessionCookie, json } from '../../../lib/auth';
import { envOf } from '../../../lib/db';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) {
    return json({ error: 'forbidden: invalid origin' }, 403);
  }
  clearSessionCookie(ctx);
  return json({ ok: true });
}