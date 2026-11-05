// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// 页面缓存：带 TTL 的内存 LRU（替代 Workers Cache API）
// ============================================================================
//
// Workers 的 caches.default 是边缘共享缓存。单机 Node 部署没有边缘层，
// 用进程内 LRU 提供等价收益（挡住匿名 GET 的重复 SSR + D1 查询）。
//
// 与 Cache API 的语义对齐点：
//   - match(request) 未命中返回 undefined
//   - put 覆盖同 key
//   - 只缓存 GET（middleware 侧已保证）
//
// 差异（有意为之）：
//   - 不跨进程/跨机共享。多实例部署时各实例各自持有缓存，
//     数据一致性仍由 Cache-Control: max-age=60 保证，不影响正确性。
//   - 条目按 URL 全串做 key（含 query），与 Cache API 一致。

import { createHash } from 'node:crypto';

/**
 * 把 Request 归一成缓存 key。
 * 与 Cache API 一致：只取 URL，忽略 header 差异（Vary 由业务侧 Cache-Control 控制）。
 * @param {Request} request
 */
function keyOf(request) {
  return request.url;
}

/**
 * 估算 Response 的内存占用，用于 LRU 容量控制。
 * 只看已读入的 body 字节数，头信息按常量估算。
 * @param {Buffer} body
 */
function costOf(body) {
  return body.byteLength + 512;
}

/**
 * 一个缓存条目
 * @typedef {{ body: Buffer, status: number, statusText: string, headers: [string,string][], expiresAt: number, cost: number }} Entry
 */

/**
 * 内存 LRU 缓存，实现 src/lib/cache.ts 的 PageCache 接口。
 */
export class MemoryPageCache {
  /** @type {Map<string, Entry>} */
  #store = new Map();
  /** @type {number} */
  #maxBytes;
  /** @type {number} */
  #maxAgeSec;
  /** @type {number} */
  #bytes = 0;
  /** @type {{ hits: number, misses: number, evictions: number }} */
  #stats = { hits: 0, misses: 0, evictions: 0 };

  /**
   * @param {{ maxBytes?: number, maxAgeSec?: number }} [options]
   */
  constructor(options = {}) {
    this.#maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.#maxAgeSec = options.maxAgeSec ?? 60;
  }

  /**
   * @param {Request} request
   * @returns {Promise<Response | undefined>}
   */
  async match(request) {
    const key = keyOf(request);
    const entry = this.#store.get(key);
    if (!entry) {
      this.#stats.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      // 过期即删
      this.#store.delete(key);
      this.#bytes -= entry.cost;
      this.#stats.misses += 1;
      return undefined;
    }
    // 触碰即提到最近使用（Map 保序，删了再插到末尾）
    this.#store.delete(key);
    this.#store.set(key, entry);
    this.#stats.hits += 1;
    const headers = new Headers();
    for (const [k, v] of entry.headers) headers.append(k, v);
    return new Response(entry.body, { status: entry.status, statusText: entry.statusText, headers });
  }

  /**
   * @param {Request} request
   * @param {Response} response
   */
  async put(request, response) {
    const key = keyOf(request);
    let body;
    try {
      body = Buffer.from(await response.clone().arrayBuffer());
    } catch {
      return;
    }
    const cost = costOf(body);
    // 单条就超过总容量：不缓存，避免把别的条目全挤掉
    if (cost > this.#maxBytes) return;

    const headers = [];
    for (const [k, v] of response.headers) headers.push([k, v]);

    const entry = {
      body,
      status: response.status,
      statusText: response.statusText,
      headers,
      expiresAt: Date.now() + this.#maxAgeSec * 1000,
      cost,
    };

    const existing = this.#store.get(key);
    if (existing) {
      this.#bytes -= existing.cost;
      this.#store.delete(key);
    }
    this.#store.set(key, entry);
    this.#bytes += cost;

    // LRU 淘汰：从头开始删直到容量达标
    while (this.#bytes > this.#maxBytes && this.#store.size > 0) {
      const [oldestKey, oldest] = this.#store.entries().next().value;
      this.#store.delete(oldestKey);
      this.#bytes -= oldest.cost;
      this.#stats.evictions += 1;
    }
  }

  /** 清空全部缓存（后台内容变更时调用） */
  async clear() {
    this.#store.clear();
    this.#bytes = 0;
  }

  /** 运行状态，健康检查与调试用 */
  stats() {
    return {
      entries: this.#store.size,
      bytes: this.#bytes,
      maxBytes: this.#maxBytes,
      maxAgeSec: this.#maxAgeSec,
      ...this.#stats,
    };
  }
}

void createHash;
