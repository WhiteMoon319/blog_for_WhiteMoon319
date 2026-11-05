// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// Env 装配：把 Cloudflare 的绑定换成 Node 侧实现
// ============================================================================
//
// Workers 里 env 是平台注入的对象，含 DB(D1) / IMAGES(R2) / ASSETS(Fetcher)
// 以及一堆 vars。Node 后端没有任何注入，全部在这里造出来：
//
//   DB     -> NodeD1Database (node:sqlite)
//   IMAGES -> NodeR2Bucket   (本地文件系统)
//   ASSETS -> NodeAssetsFetcher (dist/client)
//   vars   -> 环境变量（BLOG_ 前缀）+ 默认值
//
// vars 的键名必须与 src/env.d.ts 里的 Cloudflare.Env 完全一致，
// 否则业务代码读 env.SITE_NAME 之类会拿到 undefined。

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NodeD1Database } from './d1.mjs';
import { NodeAssetsFetcher, NodeR2Bucket } from './r2.mjs';

/** 项目根目录 */
const ROOT = resolve(import.meta.dirname, '..');

/**
 * 读取 .env（不覆盖已存在的 process.env）。
 * 不引入 dotenv：这里只需要最基本的 KEY=VALUE，多一个依赖不值得。
 */
function loadDotEnv() {
  const candidates = [join(ROOT, '.env'), join(ROOT, '.env.local')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      // 去掉成对引号
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

/**
 * 从环境变量读字符串，带默认值。
 * @param {string} key
 * @param {string} [fallback]
 */
function envStr(key, fallback = '') {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

/**
 * 从环境变量读数字，非法值回退默认。
 * @param {string} key
 * @param {number} fallback
 */
function envNum(key, fallback) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * 组装业务侧需要的 Env 对象。
 *
 * @param {{ dbPath?: string, blobDir?: string, clientDir?: string }} [options]
 * @returns {{ env: Record<string, unknown>, close: () => void }}
 */
export function createEnv(options = {}) {
  loadDotEnv();

  const dataDir = resolve(envStr('BLOG_DATA_DIR', join(ROOT, 'data')));
  const dbPath = resolve(options.dbPath ?? envStr('BLOG_DB_PATH', join(dataDir, 'blog.db')));
  const blobDir = resolve(options.blobDir ?? envStr('BLOG_BLOB_DIR', join(dataDir, 'blobs')));
  const clientDir = resolve(options.clientDir ?? envStr('BLOG_CLIENT_DIR', join(ROOT, 'dist', 'client')));

  // 目录必须先存在：sqlite 不会自己建父目录，mkdir 失败要让启动直接失败
  mkdirSync(dirname(dbPath), { recursive: true });
  mkdirSync(blobDir, { recursive: true });

  const sqlite = new DatabaseSync(dbPath);
  // WAL：读写并发友好，且崩溃恢复更稳。D1 内部同样是 WAL 类语义。
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('PRAGMA busy_timeout = 5000');

  const db = new NodeD1Database(sqlite, 'blog-db');
  const images = new NodeR2Bucket(blobDir);
  const assets = new NodeAssetsFetcher(clientDir);

  /** 与 src/env.d.ts 的 Cloudflare.Env 一一对应 */
  const env = {
    DB: db,
    IMAGES: images,
    ASSETS: assets,

    // —— 站点信息 ——
    SITE_NAME: envStr('SITE_NAME', '月下独酌'),
    SITE_SLOGAN: envStr('SITE_SLOGAN', '长月夜下，对影成楼。'),
    SITE_POEM: envStr('SITE_POEM', '月下少辞令，醉后自逍遥。'),
    SITE_URL: envStr('SITE_URL', 'http://localhost:4321'),
    SITE_TAGLINE: envStr('SITE_TAGLINE', undefined),
    FOOTER_LINE: envStr('FOOTER_LINE', undefined),
    SEARCH_PLACEHOLDER: envStr('SEARCH_PLACEHOLDER', undefined),
    HERO_NOTE: envStr('HERO_NOTE', undefined),

    // —— 认证 ——
    BLOG_ADMIN_PASSWORD: envStr('BLOG_ADMIN_PASSWORD'),
    BLOG_SESSION_SECRET: envStr('BLOG_SESSION_SECRET'),
    LOGIN_RATE_LIMIT_MAX: envNum('LOGIN_RATE_LIMIT_MAX', 10),
    LOGIN_RATE_LIMIT_WINDOW: envNum('LOGIN_RATE_LIMIT_WINDOW', 300),

    // —— 媒体 ——
    R2_PUBLIC_URL: envStr('R2_PUBLIC_URL', '/api/files'),

    // —— 加密 / 邮件 ——
    AI_SETTINGS_ENCRYPTION_KEY: envStr('AI_SETTINGS_ENCRYPTION_KEY', undefined),
    SMTP_HOST: envStr('SMTP_HOST', undefined),
    SMTP_PORT: envStr('SMTP_PORT', undefined),
    SMTP_USER: envStr('SMTP_USER', undefined),
    SMTP_PASS: envStr('SMTP_PASS', undefined),
    SMTP_FROM: envStr('SMTP_FROM', undefined),

    // —— 运行时开关 ——
    EDGE_CACHE: envStr('EDGE_CACHE', 'true'),
    HTTPS_REDIRECT: envStr('HTTPS_REDIRECT', undefined),
  };

  return {
    env,
    close: () => {
      db.close();
    },
  };
}

export { ROOT };
