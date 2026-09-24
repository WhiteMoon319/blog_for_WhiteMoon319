// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cpSync, existsSync, rmSync } from 'node:fs';

// 管理员后台与作者写作区是两份独立产物、两个 base（/admin/ 与 /write/），
// 合并时各自落位，互不覆盖。
rmSync('dist/client/admin', { recursive: true, force: true });
cpSync('admin/dist', 'dist/client/admin', { recursive: true });
console.log('admin bundle merged into dist/client/admin');

if (!existsSync('admin/dist-write/index.html')) {
  throw new Error('admin/dist-write/index.html 缺失：请先运行 pnpm --filter blog-admin run build:write');
}
rmSync('dist/client/write', { recursive: true, force: true });
cpSync('admin/dist-write', 'dist/client/write', { recursive: true });
console.log('writer bundle merged into dist/client/write');
