// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 一键部署脚本：构建 → 远程迁移 → 部署 Worker
// 首次部署前需手动设置生产密钥（见 README 部署章节）。
// 使用：pnpm run deploy

import { execSync } from 'node:child_process';

const SEP = '='.repeat(56);

function run(cmd: string, label?: string) {
  console.log(`\n${SEP}\n${label ?? cmd}\n${SEP}`);
  execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
}

// 1. 构建
run('pnpm run build', '构建（cf-config + admin + astro + 合并）');

// 2. 远程迁移
console.log(`\n${SEP}\n远程 D1 迁移\n${SEP}`);
try {
  execSync('pnpm exec wrangler d1 migrations apply blog-db --remote', { stdio: 'inherit', cwd: process.cwd() });
} catch {
  // 迁移失败不阻塞部署（可能已是最新）
  console.log('迁移可能有误，继续部署…');
}

// 3. 部署 Worker
run('pnpm exec wrangler deploy', '部署 Worker');

console.log(`\n${SEP}\n✅ 部署完成\n${SEP}`);
console.log('前台：https://blog.whitemoon319.xyz');
console.log('后台：https://blog.whitemoon319.xyz/admin/');
console.log(`\n首次部署或密钥轮换时还需执行：\n  pnpm exec wrangler secret put BLOG_ADMIN_PASSWORD\n  pnpm exec wrangler secret put BLOG_SESSION_SECRET\n  pnpm exec wrangler secret put R2_PUBLIC_URL\n  pnpm exec wrangler secret put AI_SETTINGS_ENCRYPTION_KEY\n  pnpm exec wrangler secret put SMTP_USER\n  pnpm exec wrangler secret put SMTP_PASS\n  pnpm exec wrangler secret put SMTP_FROM`);