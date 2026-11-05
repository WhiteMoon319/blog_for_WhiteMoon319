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
// 删掉 SPA 外壳 index.html：它已被 src/pages/admin/[...path].ts 以 `?raw` 内联进服务端，
// 若留在 dist/client 里，@astrojs/node 的 static handler 会先命中它并直接返回磁盘原文，
// 从而绕过该路由设置的 no-store / X-Robots-Tag / CSP 响应头（Cloudflare 版靠
// run_worker_first 避免，Node adapter 没有等价开关）。同理处理 write。
rmSync('dist/client/admin/index.html', { force: true });

if (!existsSync('admin/dist-write/index.html')) {
  throw new Error('admin/dist-write/index.html 缺失：请先运行 pnpm --filter blog-admin run build:write');
}
rmSync('dist/client/write', { recursive: true, force: true });
cpSync('admin/dist-write', 'dist/client/write', { recursive: true });
console.log('writer bundle merged into dist/client/write');
// 同 admin：外壳由路由以 `?raw` 提供，留在静态目录会绕过 no-store / CSP
rmSync('dist/client/write/index.html', { force: true });
