// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineMiddleware } from 'astro:middleware';
import { envOf } from './lib/db';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// 不参与边缘缓存的路径（含个性化/表单/搜索等动态内容）
const NO_CACHE_EXACT = ['/login/', '/register/', '/verify-email/', '/account/', '/logout/'];
const NO_CACHE_PREFIXES = ['/login', '/register', '/verify-email', '/account', '/logout', '/preview/', '/admin/', '/search/', '/api/'];

function shouldCachePublic(path: string): boolean {
  if (NO_CACHE_EXACT.includes(path)) return false;
  return !NO_CACHE_PREFIXES.some((p) => path.startsWith(p));
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.append(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const method = context.request.method;
  const path = context.url.pathname;
  const hasSession = !!context.cookies.get('blog_session')?.value;

  // ---- 匿名 GET 公开 HTML 页面：Workers Cache API 边缘缓存（60s 新鲜 + SWR）----
  // 仅生产启用；e2e/dev 通过 EDGE_CACHE=false 关闭，避免测试间脏缓存
  // 仅 GET：HEAD 跳过（Cache API put 不接受 HEAD），避免双重渲染
  if (method === 'GET' && !hasSession && import.meta.env.PROD && shouldCachePublic(path)) {
    try {
      const env = await envOf();
      if (env.EDGE_CACHE !== 'false') {
        const cache = (caches as unknown as { default: { match(k: Request): Promise<Response | undefined>; put(k: Request, r: Response): Promise<void> } }).default;
        const cached = await cache.match(context.request);
        if (cached) {
          const headers = new Headers(cached.headers);
          headers.set('X-Cache', 'HIT');
          for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
            if (!headers.has(name)) headers.append(name, value);
          }
          return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
        }

        const response = await next();
        if (response.status === 200 && (response.headers.get('content-type') || '').includes('text/html')) {
          const headers = new Headers(response.headers);
          for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
            if (!headers.has(name)) headers.append(name, value);
          }
          headers.set('Cache-Control', 'public, max-age=60');
          headers.set('CDN-Cache-Control', 'public, s-maxage=60');
          headers.set('X-Cache', 'MISS');
          const res = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
          await cache.put(context.request, res.clone());
          return res;
        }
        return withSecurityHeaders(response);
      }
    } catch {
      // 缓存层异常时降级为直渲染
    }
  }

  // ---- 常规路径：安全头 + 缓存语义 ----
  const response = await next();
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.append(name, value);
  }

  const contentType = headers.get('content-type') || '';
  const hasCacheHeader = headers.has('Cache-Control');

  if ((method === 'GET' || method === 'HEAD') && contentType.includes('text/html') && !hasCacheHeader) {
    if (hasSession) {
      headers.set('Cache-Control', 'private, no-store');
    } else if (!shouldCachePublic(path)) {
      headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    } else {
      headers.set('Cache-Control', 'public, max-age=60');
    }
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});