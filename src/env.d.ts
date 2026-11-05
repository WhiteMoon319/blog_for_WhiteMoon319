// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// 环境类型定义（Node 后端版）
// ============================================================================
//
// 原来这里声明的是 Cloudflare 的 Env（D1Database / R2Bucket 来自
// @cloudflare/workers-types）。Node 后端不依赖 Cloudflare 类型包，
// 改为在 src/types/bindings.ts 里自建等价的最小接口，
// 这样业务代码的 `const db: D1Database` 之类的写法无需改动。

/// <reference types="astro/client" />

import type {
  D1Database as D1DatabaseType,
  D1PreparedStatement as D1PreparedStatementType,
  D1Result as D1ResultType,
  Fetcher as FetcherType,
  R2Bucket as R2BucketType,
} from './types/bindings.ts';

declare global {
  // ---- 全局类型别名 ----
  // @cloudflare/workers-types 提供了全局的 D1Database / D1PreparedStatement / D1Result，
  // 业务代码大量直接引用这些名字（不 import）。去掉那个包后必须在这里补上等价声明，
  // 否则 30+ 文件的类型标注全部失效。
  type D1Database = D1DatabaseType;
  type D1PreparedStatement<T = Record<string, unknown>> = D1PreparedStatementType<T>;
  type D1Result<T = Record<string, unknown>> = D1ResultType<T>;
  type R2Bucket = R2BucketType;
  type Fetcher = FetcherType;

  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      IMAGES: R2Bucket;
      ASSETS: Fetcher;
      SITE_NAME: string;
      SITE_SLOGAN: string;
      SITE_POEM: string;
      SITE_URL: string;
      SITE_TAGLINE?: string;
      FOOTER_LINE?: string;
      SEARCH_PLACEHOLDER?: string;
      HERO_NOTE?: string;
      BLOG_ADMIN_PASSWORD: string;
      BLOG_SESSION_SECRET: string;
      R2_PUBLIC_URL: string;
      LOGIN_RATE_LIMIT_MAX: number;
      LOGIN_RATE_LIMIT_WINDOW: number;
      AI_SETTINGS_ENCRYPTION_KEY?: string;
      SMTP_HOST?: string;
      SMTP_PORT?: string;
      SMTP_USER?: string;
      SMTP_PASS?: string;
      SMTP_FROM?: string;
      EDGE_CACHE?: string;
      /** 'false' 关闭「HTTP→HTTPS 强制跳转」（e2e 用 http://e2e.test 时必须关闭） */
      HTTPS_REDIRECT?: string;
    }
  }
  interface Env extends Cloudflare.Env {}

  /** 由 server/index.mjs 注入 */
  // eslint-disable-next-line no-var
  var __BLOG_ENV_RESOLVER__: (() => Promise<Env>) | undefined;
  // eslint-disable-next-line no-var
  var __BLOG_PAGE_CACHE__: unknown;
}

declare module '*.html?raw' {
  const content: string;
  export default content;
}

export {};