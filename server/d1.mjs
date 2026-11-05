// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// D1 兼容层：用 node:sqlite 实现 Cloudflare D1Database 的调用子集
// ============================================================================
//
// 为什么要有这一层：全站有 548 处 D1 调用，但业务代码只依赖一套很窄的接口：
//   db.prepare(sql) -> stmt
//   stmt.bind(...args) -> stmt
//   stmt.first() / stmt.all() / stmt.run()
//   db.batch([stmt, ...])
// 返回值只用到 { results, meta.changes, meta.last_row_id }。
//
// 因此不需要改任何业务代码，只要在这里把语义对齐即可。
//
// 已处理的语义差异：
//   1. D1 的 first() 无结果返回 null；node:sqlite 的 get() 返回 undefined
//   2. D1 的 all() 永远有 results 数组（空结果是 []，不是 undefined）
//   3. D1 在 batch 内 meta.changes 是会话累计值；本层返回逐语句真实值
//   4. D1 不支持布尔绑定，统一把 true/false 归一为 1/0
//   5. node:sqlite 返回 null-prototype 对象，统一转成普通对象，避免
//      Object.prototype 方法（hasOwnProperty 等）不可用
//   6. D1 的 batch 是隐式事务、整批失败全回滚；这里用显式 BEGIN/COMMIT 对齐
//   7. D1 的 bind() 返回新语句对象（不可变链式）；本层同样不可变

import { DatabaseSync } from 'node:sqlite';

/**
 * node:sqlite 的绑定只接受 number / bigint / string / null / Uint8Array。
 * 这里做一次归一，避免业务侧传 Date、undefined、布尔、ArrayBuffer 时炸掉。
 * @param {unknown} v
 * @returns {number|bigint|string|null|Uint8Array}
 */
function normalizeBindValue(v) {
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case 'number':
      // NaN / Infinity 不是合法 SQLite 值，退化成 null
      return Number.isFinite(v) ? v : null;
    case 'bigint':
      return v;
    case 'string':
      return v;
    case 'boolean':
      return v ? 1 : 0;
    default:
      if (v instanceof Uint8Array) return v;
      if (v instanceof ArrayBuffer) return new Uint8Array(v);
      if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      if (v instanceof Date) return v.toISOString();
      // 其余对象按 JSON 存储
      return JSON.stringify(v);
  }
}

/**
 * node:sqlite 返回 null-prototype 对象。转成普通对象，
 * 保证 Object.keys / 展开 / JSON 行为与 D1 一致。
 * @param {unknown} row
 */
function toPlainRow(row) {
  if (row === null || typeof row !== 'object') return row;
  const out = {};
  for (const key of Object.keys(row)) {
    out[key] = row[key];
  }
  return out;
}

/**
 * @param {unknown[]} rows
 */
function toPlainRows(rows) {
  return rows.map((r) => toPlainRow(r));
}

/** 空 meta 骨架 */
function emptyMeta() {
  return {
    changes: 0,
    last_row_id: 0,
    duration: 0,
    rows_read: 0,
    rows_written: 0,
    changed_db: false,
    size_after: 0,
  };
}

/**
 * 判断语句是否会返回行（batch 内决定走 all() 还是 run()）。
 * @param {string} sql
 */
function statementReturnsRows(sql) {
  const head = sql.trimStart().slice(0, 16).toUpperCase();
  return (
    head.startsWith('SELECT') ||
    head.startsWith('WITH') ||
    head.startsWith('PRAGMA') ||
    head.startsWith('EXPLAIN') ||
    /\bRETURNING\b/i.test(sql)
  );
}

/**
 * D1PreparedStatement 兼容实现。
 * bind() 不可变：返回新对象，同一语句可多次 bind 而不互相污染。
 */
class NodeD1Statement {
  /** @type {DatabaseSync} */
  #db;
  /** @type {string} */
  #sql;
  /** @type {unknown[]} */
  #params;

  /**
   * @param {DatabaseSync} db
   * @param {string} sql
   * @param {unknown[]} [params]
   */
  constructor(db, sql, params = []) {
    this.#db = db;
    this.#sql = sql;
    this.#params = params;
  }

  /** SQL 原文，调试与日志用 */
  get sql() {
    return this.#sql;
  }

  /**
   * @param {...unknown} values
   * @returns {NodeD1Statement}
   */
  bind(...values) {
    return new NodeD1Statement(this.#db, this.#sql, values);
  }

  /**
   * 取第一行；无结果返回 null（对齐 D1）
   * @param {string} [column]
   */
  async first(column) {
    const stmt = this.#db.prepare(this.#sql);
    const args = this.#params.map(normalizeBindValue);
    const row = args.length > 0 ? stmt.get(...args) : stmt.get();
    if (row === undefined || row === null) return null;
    const plain = toPlainRow(row);
    if (column) {
      const v = plain[column];
      return v === undefined ? null : v;
    }
    return plain;
  }

  /** 取全部行；空结果返回 { results: [] }（对齐 D1） */
  async all() {
    const started = performance.now();
    const stmt = this.#db.prepare(this.#sql);
    const args = this.#params.map(normalizeBindValue);
    const rows = args.length > 0 ? stmt.all(...args) : stmt.all();
    const results = toPlainRows(rows);
    return {
      results,
      success: true,
      meta: { ...emptyMeta(), rows_read: results.length, duration: performance.now() - started },
    };
  }

  /** 执行写语句 */
  async run() {
    const started = performance.now();
    const stmt = this.#db.prepare(this.#sql);
    const args = this.#params.map(normalizeBindValue);
    const info = args.length > 0 ? stmt.run(...args) : stmt.run();
    const changes = Number(info?.changes ?? 0);
    return {
      results: [],
      success: true,
      meta: {
        ...emptyMeta(),
        changes,
        last_row_id: Number(info?.lastInsertRowid ?? 0),
        rows_written: changes,
        duration: performance.now() - started,
        changed_db: changes > 0,
      },
    };
  }

  /** 同步执行，供 batch 内部调用（batch 需要语句之间的原子性） */
  __runSync() {
    const started = performance.now();
    const stmt = this.#db.prepare(this.#sql);
    const args = this.#params.map(normalizeBindValue);

    if (statementReturnsRows(this.#sql)) {
      const rows = args.length > 0 ? stmt.all(...args) : stmt.all();
      const results = toPlainRows(rows);
      return {
        results,
        success: true,
        meta: { ...emptyMeta(), rows_read: results.length, duration: performance.now() - started },
      };
    }

    const info = args.length > 0 ? stmt.run(...args) : stmt.run();
    const changes = Number(info?.changes ?? 0);
    return {
      results: [],
      success: true,
      meta: {
        ...emptyMeta(),
        changes,
        last_row_id: Number(info?.lastInsertRowid ?? 0),
        rows_written: changes,
        duration: performance.now() - started,
        changed_db: changes > 0,
      },
    };
  }
}

/**
 * D1Database 兼容实现。
 * batch() 整批单事务，任一语句失败全部回滚——这是删除文集等逻辑的原子性前提。
 */
export class NodeD1Database {
  /** @type {DatabaseSync} */
  #db;
  /** @type {string} */
  #name;
  /** @type {boolean} */
  #inBatch = false;

  /**
   * @param {DatabaseSync} db
   * @param {string} [name]
   */
  constructor(db, name = 'blog-db') {
    this.#db = db;
    this.#name = name;
  }

  /** 底层连接，迁移/备份/健康检查用 */
  get raw() {
    return this.#db;
  }

  get name() {
    return this.#name;
  }

  /**
   * @param {string} sql
   * @returns {NodeD1Statement}
   */
  prepare(sql) {
    return new NodeD1Statement(this.#db, sql);
  }

  /**
   * D1.batch：顺序执行、单事务、失败全回滚。
   * @param {NodeD1Statement[]} statements
   */
  async batch(statements) {
    if (!Array.isArray(statements)) throw new TypeError('batch() 需要语句数组');
    if (statements.length === 0) return [];

    const out = [];
    // 已在事务中（嵌套调用）时不重复 BEGIN，避免 SQLite 报事务嵌套错误
    const ownTransaction = !this.#inBatch;
    if (ownTransaction) this.#db.exec('BEGIN');
    this.#inBatch = true;
    try {
      for (const stmt of statements) {
        if (typeof stmt?.__runSync !== 'function') {
          throw new TypeError('batch() 只接受本兼容层产生的语句对象');
        }
        out.push(stmt.__runSync());
      }
      if (ownTransaction) this.#db.exec('COMMIT');
      return out;
    } catch (err) {
      if (ownTransaction) {
        try {
          this.#db.exec('ROLLBACK');
        } catch {
          // 回滚失败不掩盖原始错误
        }
      }
      throw err;
    } finally {
      this.#inBatch = false;
    }
  }

  /**
   * D1.exec()：执行多语句脚本（迁移用）
   * @param {string} sql
   */
  async exec(sql) {
    const started = performance.now();
    this.#db.exec(sql);
    return { count: 0, duration: performance.now() - started };
  }

  /** 关闭底层连接 */
  close() {
    try {
      this.#db.close();
    } catch {
      // 已关闭时忽略
    }
  }
}

export { NodeD1Statement };
