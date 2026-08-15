import type { APIContext } from 'astro';
import adminHtml from '../../../admin/dist/index.html?raw';
import { envOf } from '../../lib/db';

export const prerender = false;

const ASSET_RE = /\.(?:js|mjs|css|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|txt)$/i;

export async function GET(ctx: APIContext): Promise<Response> {
  const path = ctx.params.path;
  if (path && ASSET_RE.test(path)) {
    const env = await envOf();
    const res = await env.ASSETS.fetch(new URL('/admin/' + path, ctx.url));
    if (res.ok) return res;
  }
  return new Response(adminHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}