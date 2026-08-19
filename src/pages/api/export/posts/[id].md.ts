import type { APIContext } from 'astro';
import { envOf, exportPostMarkdown } from '../../../../lib/db';
import { requireAuth, json } from '../../../../lib/auth';

export const prerender = false;

// 单篇 Markdown 导出（快照语义，含回收站文章）；仅登录可用；no-store 禁止 CDN 缓存。
export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 400);

  const env = await envOf();
  const out = await exportPostMarkdown(env.DB, id);
  if (!out) return json({ error: 'not found' }, 404);

  return new Response(out.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
    },
  });
}
