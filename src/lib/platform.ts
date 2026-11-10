// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// 运行平台探测
// ============================================================================
//
// 同一份源码要跑在两种运行时上：
//   - Cloudflare Workers：平台注入模块级 `cloudflare:workers` 的 env，
//                         有全局 caches.default（Cache API）
//   - Node.js：没有平台注入，由 server/index.mjs 启动时挂全局钩子，
//              缓存是进程内 LRU
//
// 业务代码只调 envOf() / pageCache()，不关心跑在哪里；分流全部收在本文件。
//
// 判定方式用「能力探测」而不是环境变量：
//   环境变量容易被遗忘（部署时漏配就静默走错分支）；
//   能力探测问的是「这个运行时到底有没有这个 API」，答案唯一且即时。

/**
 * 当前是否运行在 Cloudflare Workers 上。
 *
 * 判据优先级：
 *   1. 有 __BLOG_ENV_RESOLVER__ → 明确是 Node 后端（自己注入的）
 *   2. 有全局 caches.default 且有 WebSocketPair
 *      → Workers 独有 API（Cache API + WebSocket），Cloudflare 必有
 *
 * 只用 caches 判断不够：Node 20+ 也有全局 caches（虽然行为不同），
 * 加上 WebSocketPair 才能可靠区分。
 */
export function isCloudflareWorkers(): boolean {
  const g = globalThis as Record<string, unknown>;
  // Node 后端启动时会注入这个钩子，看到它就说明不是 Workers
  if (typeof g.__BLOG_ENV_RESOLVER__ === 'function') return false;
  // Workers 独有：WebSocketPair 构造器 + caches 全局对象
  const hasCaches = Boolean(g.caches);
  const hasWebSocketPair = typeof g.WebSocketPair === 'function';
  return hasCaches && hasWebSocketPair;
}

/**
 * 当前是否运行在 Node 后端（由 server/index.mjs 启动）。
 * 与 isCloudflareWorkers 互补，便于两侧写清楚各自的分支。
 */
export function isNodeBackend(): boolean {
  return !isCloudflareWorkers();
}

/** 平台名，日志与错误信息里用 */
export function runtimeName(): 'cloudflare-workers' | 'node' {
  return isCloudflareWorkers() ? 'cloudflare-workers' : 'node';
}
