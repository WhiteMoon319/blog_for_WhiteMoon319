import type { APIContext } from 'astro';
import adminHtml from '../../../admin/dist/index.html?raw';
import { envOf } from '../../lib/db';

export const prerender = false;

// sourcemap（.map）与编译产物不同，可能含源码路径信息，不对外暴露
const ASSET_RE = /\.(?:js|mjs|css|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|txt)$/i;
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
      // admin 产物无内联脚本，可收紧 CSP（style unsafe-inline 供 Vue 运行时注入样式）
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    },
  });
}