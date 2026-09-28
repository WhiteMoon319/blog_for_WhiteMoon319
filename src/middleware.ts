// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineMiddleware } from 'astro:middleware';
import { envOf } from './lib/db';
import { verifyTokenShape } from './lib/auth';
import { EDGE_CACHE_MAX_AGE, isEdgeCacheDisabled, isStorableHtmlResponse, shouldUseEdgeCache } from './lib/edge-cache';
import { isHttpsRedirectDisabled, isHttpsRequest, needsHttpsRedirect, securityHeaders } from './lib/http-security';

function withSecurityHeaders(response: Response, isHttps: boolean): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders(isHttps))) {
    if (!headers.has(name)) headers.append(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * 会话判定：不能只看 cookie 是否存在。
 * 只看存在性时，任何人带一个 `blog_session=x` 就能让每个请求都跳过边缘缓存，
 * 变成「每请求全量 SSR + 打 D1」的成本放大面。这里改用「签名 + 过期」判定，
 * 不查库（查库会让缓存失去意义），只作为缓存决策依据，不用于任何鉴权。
 * 判定异常时按「有会话」处理（放弃缓存），避免把个性化响应钉在边缘。
 */
async function hasVerifiedSessionCookie(token: string, secret: string | undefined): Promise<boolean> {
  try {
    return (await verifyTokenShape(secret, token)) !== null;
  } catch {
    return true;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const method = context.request.method;
  const path = context.url.pathname;
  const forwardedProto = context.request.headers.get('x-forwarded-proto');
  const isHttps = isHttpsRequest(context.url.protocol, forwardedProto);

  let env: Env | null = null;
  try {
    env = await envOf();
  } catch {
    // env 解析失败不应让请求整体失败；后续按「无 env」降级
    env = null;
  }

  // ---- 传输层：HTTP 一律 308 跳 HTTPS（生产、且非本地地址；HTTPS_REDIRECT=false 可关）----
  // 站上有账号体系，明文 HTTP 是明面上的缺口；顺带保证 cookie 的 Secure 生效
  if (
    needsHttpsRedirect({
      isProd: import.meta.env.PROD,
      protocol: context.url.protocol,
      hostname: context.url.hostname,
      forwardedProto,
      disabled: isHttpsRedirectDisabled(env?.HTTPS_REDIRECT as unknown),
    })
  ) {
    const target = new URL(context.url);
    target.protocol = 'https:';
    return new Response(null, { status: 308, headers: { Location: target.toString(), ...securityHeaders(isHttps) } });
  }

  const token = context.cookies.get('blog_session')?.value ?? '';
  const hasSession = token ? await hasVerifiedSessionCookie(token, env?.BLOG_SESSION_SECRET) : false;

  // ---- 匿名 GET 公开 HTML 页面：Workers Cache API 边缘缓存（60s 新鲜 + SWR）----
  // 仅生产启用；e2e/dev 通过 EDGE_CACHE=false 关闭，避免测试间脏缓存
  // 仅 GET：HEAD 跳过（Cache API put 不接受 HEAD），避免双重渲染
  if (
    env &&
    shouldUseEdgeCache({
      method,
      path,
      hasVerifiedSession: hasSession,
      isProd: import.meta.env.PROD,
      edgeCacheFlag: env.EDGE_CACHE as unknown,
    })
  ) {
    try {
      const cache = (
        caches as unknown as {
          default: { match(k: Request): Promise<Response | undefined>; put(k: Request, r: Response): Promise<void> };
        }
      ).default;
      const cached = await cache.match(context.request);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('X-Cache', 'HIT');
        for (const [name, value] of Object.entries(securityHeaders(isHttps))) {
          if (!headers.has(name)) headers.append(name, value);
        }
        return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
      }

      const response = await next();
      // 路由自己声明了 no-store / private、或带 Set-Cookie 的响应一律不入缓存：
      // 否则会把「不缓存」的语义冲掉，把后台外壳之类钉在边缘。
      if (isStorableHtmlResponse(response)) {
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(securityHeaders(isHttps))) {
          if (!headers.has(name)) headers.append(name, value);
        }
        headers.set('Cache-Control', `public, max-age=${EDGE_CACHE_MAX_AGE}`);
        headers.set('CDN-Cache-Control', `public, s-maxage=${EDGE_CACHE_MAX_AGE}`);
        headers.set('X-Cache', 'MISS');
        const res = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
        await cache.put(context.request, res.clone());
        return res;
      }
      return withSecurityHeaders(response, isHttps);
    } catch {
      // 缓存层异常时降级为直渲染
    }
  }

  // ---- 常规路径：安全头 + 缓存语义 ----
  const response = await next();
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(securityHeaders(isHttps))) {
    if (!headers.has(name)) headers.append(name, value);
  }

  const contentType = headers.get('content-type') || '';
  const hasCacheHeader = headers.has('Cache-Control');

  // 路由已声明缓存语义时一律尊重，不再覆盖
  if ((method === 'GET' || method === 'HEAD') && contentType.includes('text/html') && !hasCacheHeader) {
    if (hasSession) {
      headers.set('Cache-Control', 'private, no-store');
    } else {
      // 免缓存路径：允许浏览器缓存但每次回源校验（原本这里对裸路径 /admin、/search 会漏判成 60s 公开缓存）
      headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
