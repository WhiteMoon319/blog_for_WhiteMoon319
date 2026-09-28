// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 传输层安全：安全响应头、HSTS、HTTP→HTTPS 跳转判定、cookie 的 Secure 判定。
 * 抽成纯函数以便单测（中间件本身没有测试覆盖，这里补上判定层）。
 */

/** 与传输层无关的基线安全头 */
export const BASE_SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

/**
 * HSTS：一年 + includeSubDomains。
 * 不带 preload —— preload 是难以撤回的长期承诺（进浏览器内置列表），需要单独决定。
 */
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

/** 按请求是否走 HTTPS 给出响应头（HSTS 只在 HTTPS 上有意义） */
export function securityHeaders(isHttps: boolean): Record<string, string> {
  return isHttps ? { ...BASE_SECURITY_HEADERS, 'Strict-Transport-Security': HSTS_VALUE } : { ...BASE_SECURITY_HEADERS };
}

/** 取 x-forwarded-proto 的第一个值（Cloudflare 边缘终结 TLS 时协议看这里） */
export function firstForwardedProto(value: string | null | undefined): string {
  return (value ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
}

/** 该请求是否可视为 HTTPS（协议或 x-forwarded-proto 任一为 https） */
export function isHttpsRequest(protocol: string, forwardedProto: string | null | undefined): boolean {
  if (protocol === 'https:') return true;
  return firstForwardedProto(forwardedProto) === 'https';
}

/** 本地地址不跳转（开发服务器、健康检查） */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
}

/** 是否需要把 HTTP 请求 308 跳到 HTTPS（仅生产，且非本地地址、当前不是 https） */
export function needsHttpsRedirect(opts: {
  isProd: boolean;
  protocol: string;
  hostname: string;
  forwardedProto?: string | null;
  /** HTTPS_REDIRECT=false 时关闭（e2e 用 http://e2e.test，必须能关） */
  disabled?: boolean;
}): boolean {
  if (opts.disabled) return false;
  if (!opts.isProd) return false;
  if (isLocalHostname(opts.hostname)) return false;
  return !isHttpsRequest(opts.protocol, opts.forwardedProto);
}

/** HTTPS_REDIRECT 允许布尔或字符串关闭 */
export function isHttpsRedirectDisabled(value: unknown): boolean {
  return value === false || value === 'false';
}
