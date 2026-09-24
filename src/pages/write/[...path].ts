// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import writeHtml from '../../../admin/dist-write/index.html?raw';
import { envOf } from '../../lib/db';

export const prerender = false;

// 作者写作区（/write/）入口：与 /admin/ 同构但不共用产物。
// 静态资源与深链都落到这里：命中 dist/client/write 下的文件就透传，否则返回写作区 HTML，
// 由前端路由接管（/write/editor、/write/collections 等刷新可用）。
const ASSET_RE = /\.(?:js|mjs|css|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|txt)$/i;
// ctx.params.path 不带前导斜杠（assets/xxx.js），故这里匹配段首的 assets/
const HASHED_ASSET_RE = /(?:^|\/)assets\/.+\.(?:js|mjs|css)$/i;

export async function GET(ctx: APIContext): Promise<Response> {
  const path = ctx.params.path;
  if (path && ASSET_RE.test(path)) {
    const env = await envOf();
    const res = await env.ASSETS.fetch(new URL('/write/' + path, ctx.url));
    if (res.ok) {
      const headers = new Headers(res.headers);
      if (HASHED_ASSET_RE.test(path)) {
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
  }
  return new Response(writeHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 写作区入口不缓存：角色与内容随时可变，避免拿到旧壳
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    },
  });
}
