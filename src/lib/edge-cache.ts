// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 边缘缓存策略：纯函数，不碰 env / DB / Request 之外的运行时。
 * 抽出来的理由：这块逻辑原先只写在 middleware.ts 里，而 middleware 没有单测，
 * 于是「裸路径漏判」和「覆盖路由 no-store」两个问题都是靠线上响应头才发现的。
 * 判定与执行分离后，判定部分可以被 tests/edge-cache.test.ts 直接覆盖。
 */

/** 不参与边缘缓存的路径前缀：登录态页面、个性化页面、表单页、接口、后台与写作区外壳 */
export const NO_CACHE_PREFIXES: readonly string[] = [
  '/login',
  '/register',
  '/verify-email',
  '/account',
  '/logout',
  '/preview',
  '/admin',
  '/write',
  '/search',
  '/api',
];

/** 去掉尾部斜杠（根路径除外），让 /admin 与 /admin/ 走同一分支 */
export function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.replace(/\/+$/, '') || '/';
  return path;
}

/** 是否属于「不该被边缘缓存」的路径（按路径段匹配，裸路径与子路径都算命中） */
export function isNoCachePath(path: string): boolean {
  const p = normalizePath(path);
  return NO_CACHE_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/'));
}

/** 是否参与「匿名 GET 公开 HTML」的边缘缓存 */
export function isPublicCacheablePath(path: string): boolean {
  return !isNoCachePath(path);
}

/** EDGE_CACHE 允许布尔或字符串关闭（本地/e2e 用 'false'） */
export function isEdgeCacheDisabled(value: unknown): boolean {
  return value === false || value === 'false';
}

type ResponseLike = { status: number; headers: Headers };

/**
 * 只有「匿名可见、无个性化、路由自己也没说别缓存」的 200 HTML 才允许入缓存。
 * no-store / private / no-cache 与 Set-Cookie 一律拒绝——否则会把路由的缓存语义冲掉，
 * 把个性化页面（或带登录态的响应）钉在边缘。
 */
export function isStorableHtmlResponse(res: ResponseLike): boolean {
  if (res.status !== 200) return false;
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) return false;
  if (res.headers.has('set-cookie')) return false;
  const cc = (res.headers.get('cache-control') || '').toLowerCase();
  if (cc.includes('no-store') || cc.includes('private') || cc.includes('no-cache')) return false;
  return true;
}

export interface EdgeCacheDecision {
  method: string;
  path: string;
  /** 会话 cookie 是否通过签名校验（只看 cookie 是否存在是不安全的：任何人带个假 cookie 就能绕过缓存层） */
  hasVerifiedSession: boolean;
  isProd: boolean;
  edgeCacheFlag: unknown;
}

/** 是否要走「边缘缓存」分支（命中与否由 Cache API 决定） */
export function shouldUseEdgeCache(d: EdgeCacheDecision): boolean {
  if (d.method !== 'GET') return false;
  if (d.hasVerifiedSession) return false;
  if (!d.isProd) return false;
  if (isEdgeCacheDisabled(d.edgeCacheFlag)) return false;
  return isPublicCacheablePath(d.path);
}

/** 入缓存时统一使用的缓存语义（浏览器 60s，边缘 60s） */
export const EDGE_CACHE_MAX_AGE = 60;
