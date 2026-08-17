import type { APIContext } from 'astro';
import adminHtml from '../../../admin/dist/index.html?raw';
import { envOf } from '../../lib/db';

export const prerender = false;

const ASSET_RE = /\.(?:js|mjs|css|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|txt)$/i;
const HASHED_ASSET_RE = /\/assets\/.+\.(?:js|mjs|css)$/i;

export async function GET(ctx: APIContext): Promise<Response> {
  const path = ctx.params.path;
  if (path && ASSET_RE.test(path)) {
    const env = await envOf();
    const res = await env.ASSETS.fetch(new URL('/admin/' + path, ctx.url));
    if (res.ok) {
      const headers = new Headers(res.headers);
      // vite 带 hash 产物内容不可变，可长缓存
      if (HASHED_ASSET_RE.test(path)) {
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
  }
  return new Response(adminHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}