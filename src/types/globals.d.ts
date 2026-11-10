// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// 全局绑定类型（Node / 通用编译使用）
// ============================================================================
//
// 为什么需要这个文件：
//
//   业务代码大量直接写 `db: D1Database`、`stmt: D1PreparedStatement`
//   （不 import），这些名字在云版由 @cloudflare/workers-types 全局提供。
//
//   Node 侧不加载 workers-types，所以要自己补一份同名全局声明。
//
// 为什么不直接写 `type X = Y` 转发：
//
//   `type D1PreparedStatement<T = unknown> = BindingsD1PreparedStatement<T>`
//   这种转发的写法在我们的最小复现里能工作，但在本项目里会因为
//   「类型 X 与 Y 不兼容」的 assignability 检查而失败——
//   `db.batch([...stmt])` 里 stmt 来自全局别名，参数期望的是 bindings.ts 的
//   原始接口，两者被 TS 视为不同的 nominal 类型。
//
//   所以这里**不转发，而是直接声明完整成员**，让全局类型和
//   bindings.ts 的导出类型在结构上完全一致，可互相赋值。
//
// 与 worker 编译的关系：
//
//   tsconfig.worker.json 排除了本文件，worker/worker.ts 用 workers-types
//   的原生全局声明（它有 dump / withSession / raw 等真实成员）。

declare global {
  /** 绑定的标量类型 */
  type D1Value = string | number | boolean | null | Uint8Array | ArrayBuffer;

  /** D1 单语句执行元信息 */
  interface D1Meta {
    changes: number;
    last_row_id: number;
    duration: number;
    rows_read: number;
    rows_written: number;
    changed_db: boolean;
    size_after: number;
  }

  /** D1 执行结果 */
  interface D1Result<T = unknown> {
    results: T[];
    success: true;
    meta: D1Meta;
  }

  /** D1 预编译语句 */
  interface D1PreparedStatement<T = unknown> {
    bind(...values: unknown[]): D1PreparedStatement<T>;
    first<R = T>(column?: string): Promise<R | null>;
    all<R = T>(): Promise<D1Result<R>>;
    run<R = T>(): Promise<D1Result<R>>;
  }

  /** D1 数据库 */
  interface D1Database {
    prepare(sql: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement<T>[]): Promise<D1Result<T>[]>;
    exec(sql: string): Promise<{ count: number; duration: number }>;
  }

  /** R2 对象元信息 */
  interface R2HTTPMetadata {
    contentType?: string;
    cacheControl?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    contentLanguage?: string;
  }

  /** R2 列表项 */
  interface R2Object {
    key: string;
    size: number;
    uploaded: Date;
    httpMetadata?: R2HTTPMetadata;
    customMetadata?: Record<string, string>;
  }

  /** R2 取回的对象（带 body） */
  interface R2ObjectBody extends R2Object {
    body: ReadableStream;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
  }

  /** R2 列表结果 */
  interface R2Objects {
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }

  /** R2 存储桶 */
  interface R2Bucket {
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
  interface Fetcher {
    fetch(input: Request | URL | string): Promise<Response>;
  }
}

export {};
