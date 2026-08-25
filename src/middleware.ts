// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineMiddleware } from 'astro:middleware';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// 不参与 CDN 边缘缓存的路径（含个性化/表单/写操作）
const NO_CACHE_PREFIXES = ['/login', '/register', '/verify-email', '/account', '/logout', '/preview/', '/admin/', '/search/'];
const NO_CACHE_EXACT = ['/login/', '/register/', '/verify-email/', '/account/', '/logout/'];

function shouldCachePublic(path: string): boolean {
  if (NO_CACHE_EXACT.includes(path)) return false;
  return !NO_CACHE_PREFIXES.some((p) => path.startsWith(p));
}

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.append(name, value);
  }

  const method = context.request.method;
  const path = context.url.pathname;
  const contentType = headers.get('content-type') || '';
  const hasSession = !!context.cookies.get('blog_session')?.value;
  const hasCacheHeader = headers.has('Cache-Control');

  // 公开 HTML 页面：CDN 边缘缓存 60s 新鲜 + 后台 5 分钟再验证，浏览器也缓存 60s
  // （文章/首页/归档/标签页等只读公开内容；登录用户带身份信息一律不缓存）
  if ((method === 'GET' || method === 'HEAD') && contentType.includes('text/html') && !hasCacheHeader) {
    if (hasSession) {
      headers.set('Cache-Control', 'private, no-store');
    } else if (shouldCachePublic(path)) {
      const cache = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300';
      headers.set('Cache-Control', cache);
      // Cloudflare 边缘缓存优先读该头；同源双写保证中间缓存/CDN 均可缓存墙
      headers.set('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    } else {
      headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});