import type { APIContext } from 'astro';
import { json, requireAuth, checkCsrf } from '../../../lib/auth';
import { envOf } from '../../../lib/db';
import { publicBase } from '../../../lib/utils';

export const prerender = false;

const MAX_LIMIT = 200;

function parseLimit(raw: string | null): number {
  const n = Number(raw ?? '100');
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : 100;
}

export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;

  const env = await envOf();
  const cursor = ctx.url.searchParams.get('cursor') ?? undefined;
  const listed = await env.IMAGES.list({ limit: parseLimit(ctx.url.searchParams.get('limit')), cursor });

  const base = publicBase(env.R2_PUBLIC_URL ?? '');
  const files = listed.objects.map((o) => ({
    key: o.key,
    size: o.size,
    uploaded: o.uploaded.toISOString(),
    url: base ? `${base}/${o.key}` : `/api/files/${o.key}`,
  }));

  return json({ files, cursor: listed.truncated ? listed.cursor : undefined });
}

export async function DELETE(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  const key = ctx.url.searchParams.get('key') ?? '';
  if (!key.startsWith('uploads/')) {
    return json({ error: 'invalid key' }, 400);
  }

  await env.IMAGES.delete(key);
  return json({ ok: true });
}