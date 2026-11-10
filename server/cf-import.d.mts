// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// server/cf-import.mjs 的类型声明（实现是纯 JS，TypeScript 无法推断）。

export interface CloudflareTokenInfo {
  id: string;
  status: 'active' | 'disabled' | 'expired';
  expires_on?: string;
  not_before?: string;
}

export interface D1DatabaseInfo {
  uuid: string;
  name: string;
  created_at?: string;
  version?: string;
}

export interface R2BucketInfo {
  name: string;
  creation_date?: string;
}

export interface R2ObjectInfo {
  key: string;
  size?: number;
  etag?: string;
  last_modified?: string;
  http_metadata?: {
    contentType?: string;
    cacheControl?: string;
  };
  custom_metadata?: Record<string, string>;
}

export interface ProgressOptions {
  onProgress?: (msg: string) => void;
}

export declare class CloudflareError extends Error {
  status?: number;
  code?: number;
  errors?: Array<{ code: number; message: string }>;
}

export declare function verifyToken(token: string): Promise<CloudflareTokenInfo>;

export declare function listDatabases(token: string, accountId: string): Promise<D1DatabaseInfo[]>;

export declare function listBuckets(token: string, accountId: string): Promise<R2BucketInfo[]>;

export declare function exportDatabase(
  token: string,
  accountId: string,
  databaseId: string,
  opts?: ProgressOptions,
): Promise<{ url: string; filename: string }>;

export declare function downloadExport(token: string, url: string): Promise<string>;

export declare function listAllObjects(
  token: string,
  accountId: string,
  bucket: string,
  opts?: ProgressOptions,
): Promise<R2ObjectInfo[]>;

export declare function getObject(
  token: string,
  accountId: string,
  bucket: string,
  key: string,
): Promise<{ buf: Buffer; contentType: string }>;

export declare function inspectLocalDatabase(dbPath: string): { tables: string[]; isNew: boolean };

export declare function backupDatabase(dbPath: string): string;

export declare function applyDump(dbPath: string, sqlText: string, opts?: ProgressOptions): { appliedCount: number };

export declare function markMigrationsApplied(dbPath: string, migrationNames: string[]): number;

export declare function downloadObjects(
  blobDir: string,
  objects: R2ObjectInfo[],
  fetcher: (key: string) => Promise<{ buf: Buffer; contentType: string }>,
  opts?: ProgressOptions,
): Promise<{ count: number; bytes: number }>;

export declare function listMigrationNames(): string[];

export declare function parseArgs(argv: string[]): Record<string, string | boolean>;
