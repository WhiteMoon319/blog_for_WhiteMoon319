import type { APIContext } from 'astro';
import { json } from '../../../lib/auth';
import { envOf } from '../../../lib/db';
import { isInlineSafeType } from '../../../lib/upload';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const key = ctx.params.key;
  if (!key) return json({ error: 'not found' }, 404);

  const env = await envOf();
  const object = await env.IMAGES.get(key);
  if (!object) return json({ error: 'not found' }, 404);

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (!isInlineSafeType(contentType)) {
    const name = key.split('/').pop() ?? 'download';
    headers.set('Content-Disposition', `attachment; filename="${name}"`);
  }
  if (object.size !== undefined) headers.set('Content-Length', String(object.size));

  return new Response(object.body, { headers });
}