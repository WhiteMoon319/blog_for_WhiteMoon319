#!/usr/bin/env node
// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// 统一构建入口：按 BLOG_TARGET 走不同流水线
// ============================================================================
//
// 两条流水线只在「平台相关」的步骤上不同，其余（后台、Astro 主构建、产物合并）
// 完全一致。把差异收敛在这里，避免维护两份几乎相同的构建命令。
//
//   BLOG_TARGET=cloudflare（默认）
//     cf-config → copy-vendor-css → admin 构建 → astro build
//       → merge-admin → build-worker（打包 scheduled 入口）
//
//   BLOG_TARGET=node
//     copy-vendor-css → admin 构建 → astro build → merge-admin
//     （Node 不用 wrangler 配置，也没有 scheduled 入口要打包，
//       定时任务由 server/index.mjs 的 setInterval 驱动）

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** 读 .env 里的某个键（构建期变量，不是运行时） */
function envValue(key) {
  if (process.env[key]) return process.env[key].trim();
  const envFile = join(ROOT, '.env');
  if (!existsSync(envFile)) return '';
  const m = new RegExp(`^${key}=(.+)$`, 'm').exec(readFileSync(envFile, 'utf8'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

const TARGET = (envValue('BLOG_TARGET') || 'cloudflare').toLowerCase();
if (TARGET !== 'cloudflare' && TARGET !== 'node') {
  console.error(`BLOG_TARGET 只能是 cloudflare 或 node，当前为 "${TARGET}"`);
  process.exit(1);
}

/**
 * 执行一步，失败即中止并保留可读的命令行。
 * @param {string} label
 * @param {string} cmd
 */
function step(label, cmd) {
  console.log(`\n[build] ${label}`);
  console.log(`        ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT });
  } catch (err) {
    console.error(`\n[build] 失败于「${label}」`);
    process.exit(typeof err.status === 'number' ? err.status : 1);
  }
}

console.log(`[build] 目标平台：${TARGET}`);

// ---- 1. 平台配置（仅 Cloudflare 需要生成 wrangler.jsonc）----
if (TARGET === 'cloudflare') {
  step('生成 wrangler 配置', 'node scripts/cf-config.mjs');
}

// ---- 2. 公共步骤 ----
step('复制 vendor CSS', 'node scripts/copy-vendor-css.mjs');
step('构建后台（admin + write）', 'pnpm -C admin run build');
step('构建 Astro 服务端', 'astro build');
step('合并后台产物', 'node scripts/merge-admin.mjs');

// ---- 3. 平台收尾 ----
if (TARGET === 'cloudflare') {
  // 把 worker/worker.ts 打包成 scheduled 入口，并把 wrangler.json 的 main 指过去
  step('打包 Worker scheduled 入口', 'node scripts/build-worker.mjs');
}

// ---- 4. 可选：把产物挪到指定目录 ----
// 发布流程要在一台机器上连做两套（node 与 cloudflare），而两者都写 dist/，
// 后一套会覆盖前一套。用 BLOG_DIST_OUT 指定独立目录即可并存，
// 日常构建不设这个变量，行为完全不变。
const distOut = envValue('BLOG_DIST_OUT');
if (distOut) {
  const dest = join(ROOT, distOut);
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(ROOT, 'dist'), dest, { recursive: true });
  console.log(`\n[build] 产物已复制到 ${distOut}/`);
}

console.log(`\n[build] 完成（${TARGET}）`);
if (TARGET === 'node') {
  console.log('[build] 启动方式：BLOG_TARGET=node pnpm start');
} else {
  console.log('[build] 部署方式：pnpm cf:deploy');
}
