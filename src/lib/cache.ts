// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// 页面缓存（双平台）
// ============================================================================
//
// 同一套接口，两种底层实现：
//
//   Cloudflare Workers → 全局 caches.default（边缘共享缓存）
//   Node.js            → server/cache.mjs 注入的进程内 LRU
//
// middleware 只调 pageCache().match() / .put()，不关心底层是什么。
//
// 优先级：
//   1. Node 注入的 __BLOG_PAGE_CACHE__（有就说明是 Node 侧）
//   2. Cloudflare 的 caches.default（能力探测）
//   3. NOOP（都没有时降级：站点仍可用，只是不缓存）

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
 * Cloudflare Cache API 的适配层。
 *
 * middleware 侧已保证只对匿名 GET 的公开 HTML 调用，这里再做几层防御：
 *   - 带 Set-Cookie 的响应不缓存（Cache API 也会拒绝）
 *   - put 失败静默忽略，不影响响应本身
 */
function cloudflareCache(): PageCache | null {
  const g = globalThis as {
    caches?: {
      default?: { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> };
    };
  };
  const def = g.caches?.default;
  if (!def) return null;

  return {
    match: (req) => def.match(req),
    async put(req, res) {
      if (res.headers.has('set-cookie')) return;
      try {
        await def.put(req, res.clone());
      } catch {
        // 缓存写入失败不应影响响应（例如响应体已被消费）
      }
    },
    async clear() {
      // Cache API 没有"清空全部"的接口；后台内容变更靠
      // Cache-Control 的 max-age（60s）自然失效
    },
  };
}

/**
 * 解析当前生效的缓存实现。
 * 用函数而不是模块级常量，保证 Node 侧注入发生在 import 之后也能生效。
 */
export function pageCache(): PageCache {
  const injected = (globalThis as { __BLOG_PAGE_CACHE__?: PageCache }).__BLOG_PAGE_CACHE__;
  if (injected) return injected;

  const cf = cloudflareCache();
  if (cf) return cf;

  return NOOP_CACHE;
}

/** 测试与 server 启动时注入实现；传 null 清除 */
export function __setPageCache(cache: PageCache | null): void {
  if (cache) {
    (globalThis as { __BLOG_PAGE_CACHE__?: PageCache }).__BLOG_PAGE_CACHE__ = cache;
  } else {
    delete (globalThis as { __BLOG_PAGE_CACHE__?: PageCache }).__BLOG_PAGE_CACHE__;
  }
}
