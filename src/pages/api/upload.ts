import type { APIContext } from 'astro';
import { json, requireAuth } from '../../lib/auth';
import { envOf } from '../../lib/db';
import { detectImageType, EXT_BY_TYPE, type AllowedImageType } from '../../lib/upload';

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024;
const SNIFF_BYTES = 12;

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;

  const form = await ctx.request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return json({ error: 'file required (multipart field "file")' }, 400);
  }
  if (file.size === 0) return json({ error: 'empty file' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'file too large (max 10MB)' }, 413);

  const declared = file.type || '';
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const type = detectImageType(head, declared) as AllowedImageType | null;
  if (!type) {
    return json(
      { error: 'unsupported file type: 仅允许 png/jpeg/webp/gif/avif 图片，且需与文件内容一致' },
      415,
    );
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const key = `uploads/${y}/${m}/${crypto.randomUUID()}${EXT_BY_TYPE[type]}`;

  const env = await envOf();
  await env.IMAGES.put(key, file.stream(), {
    httpMetadata: { contentType: type },
  });

  const base = env.R2_PUBLIC_URL;
  return json({ url: base ? `${base}/${key}` : `/api/files/${key}`, key }, 201);
}