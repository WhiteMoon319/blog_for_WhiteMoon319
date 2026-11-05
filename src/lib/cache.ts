// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// 页面缓存适配层
// ============================================================================
//
// 原来 middleware 直接调用 Workers 的全局 `caches.default`（Cache API）。
// Node 后端没有这个 API，改为「由 server 注入一个缓存实现」：
//   - 生产：server/cache.mjs 提供带 TTL 的内存 LRU
//   - 测试/e2e：注入空实现，或 EDGE_CACHE=false 直接不走缓存分支
//
// 接口只保留 middleware 用到的两个方法：match / put。
// 语义与 Cache API 对齐：match 未命中返回 undefined，put 覆盖同 key 条目。

export interface PageCache {
  /** 命中返回 Response，未命中返回 undefined */
  match(request: Request): Promise<Response | undefined>;
  /** 写入缓存（实现内部负责 clone，调用方不必担心 body 被消费） */
  put(request: Request, response: Response): Promise<void>;
  /** 清空（后台刷新用） */
  clear?(): Promise<void>;
}

/** 空实现：不缓存任何东西 */
const NOOP_CACHE: PageCache = {
  async match() {
    return undefined;
  },
  async put() {
    // 故意为空
  },
};

/**
 * 解析当前生效的缓存实现。
 * 优先级：全局注入 > 空实现。
 * 用函数而不用模块级常量，保证 server 注入发生在 import 之后也能生效。
 */
export function pageCache(): PageCache {
  const injected = (globalThis as { __BLOG_PAGE_CACHE__?: PageCache }).__BLOG_PAGE_CACHE__;
  return injected ?? NOOP_CACHE;
}

/** 测试与 server 启动时注入实现 */
export function __setPageCache(cache: PageCache | null): void {
  if (cache) {
    (globalThis as { __BLOG_PAGE_CACHE__?: PageCache }).__BLOG_PAGE_CACHE__ = cache;
  } else {
    delete (globalThis as { __BLOG_PAGE_CACHE__?: PageCache }).__BLOG_PAGE_CACHE__;
  }
}
