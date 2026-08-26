// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

declare global {
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
    }
  }

  interface Env extends Cloudflare.Env {}
}

declare module '*.html?raw' {
  const content: string;
  export default content;
}

export {};