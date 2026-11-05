// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// 绑定接口：替换 @cloudflare/workers-types
// ============================================================================
//
// 业务代码里到处是 `import type { D1Database } from '@cloudflare/workers-types'`。
// 去掉那个依赖后，这里提供同名同形状的最小接口，让 TypeScript 继续能检查，
// 同时 server/d1.mjs、server/r2.mjs 的实现也按这套接口对齐。
//
// 只声明业务实际用到的成员，不用把 Cloudflare 的整棵类型树搬过来。

/** 绑定的标量类型 */
export type D1Value = string | number | boolean | null | Uint8Array | ArrayBuffer;

/** D1 单语句执行元信息 */
export interface D1Meta {
  changes: number;
  last_row_id: number;
  duration: number;
  rows_read: number;
  rows_written: number;
  changed_db: boolean;
  size_after: number;
}

/**
 * D1 执行结果。
 * 泛型默认值是 unknown（与 @cloudflare/workers-types 一致）：
 * 业务代码里大量 `results[0] as SomeRow` 断言，只有 unknown 才能这么转，
 * 换成 Record<string, unknown> 会让这批断言全部报 TS2352。
 */
export interface D1Result<T = unknown> {
  results: T[];
  success: true;
  meta: D1Meta;
}

/** D1 预编译语句 */
export interface D1PreparedStatement<T = unknown> {
  bind(...values: unknown[]): D1PreparedStatement<T>;
  first<R = T>(column?: string): Promise<R | null>;
  all<R = T>(): Promise<D1Result<R>>;
  run<R = T>(): Promise<D1Result<R>>;
}

/** D1 数据库 */
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement<T>[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
}

/** R2 对象元信息 */
export interface R2HTTPMetadata {
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
}

/** R2 列表项 */
export interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

/** R2 取回的对象（带 body） */
export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

/** R2 列表结果 */
export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

/** R2 存储桶 */
export interface R2Bucket {
  put(
    key: string,
    value: unknown,
    options?: {
      httpMetadata?: R2HTTPMetadata;
      customMetadata?: Record<string, string>;
    },
  ): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
  list(options?: { limit?: number; cursor?: string; prefix?: string }): Promise<R2Objects>;
  delete(keys: string | string[]): Promise<void>;
}

/** 静态资源绑定（Workers Assets） */
export interface Fetcher {
  fetch(input: Request | URL | string): Promise<Response>;
}
