// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// server/d1.mjs 的类型声明。
// 实现是纯 JS（.mjs），TypeScript 无法从中推断泛型，因此这里手写声明，
// 保证 NodeD1Database 在结构上精确满足 src/types/bindings.ts 的 D1Database。

import type { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1Result } from '../src/types/bindings.ts';

/** D1 预编译语句的 Node 实现 */
export declare class NodeD1Statement<T = unknown> {
  constructor(db: DatabaseSync, sql: string, params?: unknown[]);
  /** SQL 原文 */
  readonly sql: string;
  bind(...values: unknown[]): NodeD1Statement<T>;
  first<R = T>(column?: string): Promise<R | null>;
  all<R = T>(): Promise<D1Result<R>>;
  run<R = T>(): Promise<D1Result<R>>;
  /** batch 内部使用，同步执行 */
  __runSync(): D1Result<T>;
}

/** D1Database 的 Node 实现（node:sqlite 驱动） */
export declare class NodeD1Database implements D1Database {
  constructor(db: DatabaseSync, name?: string);
  /** 底层 sqlite 连接 */
  readonly raw: DatabaseSync;
  readonly name: string;
  prepare(sql: string): NodeD1Statement;
  batch<T = unknown>(statements: NodeD1Statement<T>[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
  close(): void;
}
