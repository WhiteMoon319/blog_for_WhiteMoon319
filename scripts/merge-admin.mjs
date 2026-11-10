// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';

// 管理员后台与作者写作区是两份独立产物、两个 base（/admin/ 与 /write/），
// 合并时各自落位，互不覆盖。
//
// 是否删除 SPA 外壳 index.html，取决于目标平台：
//
//   Cloudflare：外壳留在 dist/client 里是原设计。Workers Assets 配了
//               run_worker_first，请求先进 Worker，路由会自己返回带安全头的
//               外壳；磁盘上的那份只作为兜底，不抢路由。
//
//   Node：@astrojs/node 的 standalone handler 是 static 先跑，命中磁盘外壳就
//         直接返回原文，会绕过 no-store / X-Robots-Tag / CSP。所以必须删掉。

/** 读 BLOG_TARGET，与 scripts/build.mjs、astro.config.mjs 保持同一套判定 */
function buildTarget() {
  if (process.env.BLOG_TARGET) return process.env.BLOG_TARGET.trim().toLowerCase();
  if (existsSync('.env')) {
    const m = /^BLOG_TARGET=(.+)$/m.exec(readFileSync('.env', 'utf8'));
    if (m)
      return m[1]
        .trim()
        .replace(/^["']|["']$/g, '')
        .toLowerCase();
  }
  return 'cloudflare';
}

const TARGET = buildTarget();
const stripShells = TARGET === 'node';

rmSync('dist/client/admin', { recursive: true, force: true });
cpSync('admin/dist', 'dist/client/admin', { recursive: true });
console.log('admin bundle merged into dist/client/admin');
if (stripShells) {
  rmSync('dist/client/admin/index.html', { force: true });
  console.log('  （Node 目标：已移除 admin/index.html，避免静态 handler 抢走路由）');
}
if (!existsSync('admin/dist-write/index.html')) {
  throw new Error('admin/dist-write/index.html 缺失：请先运行 pnpm --filter blog-admin run build:write');
}
rmSync('dist/client/write', { recursive: true, force: true });
cpSync('admin/dist-write', 'dist/client/write', { recursive: true });
console.log('writer bundle merged into dist/client/write');
if (stripShells) {
  rmSync('dist/client/write/index.html', { force: true });
  console.log('  （Node 目标：已移除 write/index.html，避免静态 handler 抢走路由）');
}
