// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// e2e 客户端（按产物自动分流到 Cloudflare / Node 两种实现）
// ============================================================================
//
// 同一套用例、同一份 import（`from './helpers/e2e.ts'`），
// 但底层要按「dist 产物到底为哪个平台构建」来选择实现：
//
//   Cloudflare 产物 → miniflare 跑 Worker（e2e.cloudflare.ts）
//   Node 产物       → 进程内 http.Server（e2e.node.ts）
//
// 为什么不用静态 re-export：
//   e2e.cloudflare.ts 顶层 `import { Miniflare } from 'miniflare'` 是重的
//   （会拉起 workerd）；e2e.node.ts 又完全不需要它。静态导出会让
//   两种产物都背上对方依赖，且在受限环境（如 ARM 容器）里 workerd 起不来时
//   连 Node 模式的测试都会被拖挂。
//
//   所以这里用「运行时动态 import + 类型层显式声明」：
//   类型取自 e2e.node.ts（与 cloudflare 版结构一致），
//   运行时按 BUILD_TARGET 只加载需要的那一份。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
// 类型来自 e2e.node.ts：它把 mf / db 都声明成可选，是两种产物都能满足的超集。
// 用例侧统一 import 这个文件拿类型，避免两套 interface 互相不兼容。
import type { E2eClient, E2eResponse, SeededUser, UploadFile } from './e2e.node.ts';

export type { E2eClient, E2eResponse, SeededUser, UploadFile };

const SERVER_DIR = resolve('dist/server');

/**
 * 判定当前 dist 产物是给哪个平台构建的。
 *
 * 判据：Cloudflare adapter 的产物会把 `import "cloudflare:workers"` 内联进来
 * （Astro 的 CF adapter 需要平台绑定），Node 产物里没有这个协议前缀。
 *
 * 用产物特征而不是环境变量：测试跑的是「已经构建出来的那份东西」，
 * 只有产物自己最清楚它是谁。变量可能和实际产物不一致。
 */
export function detectBuildTarget(): 'cloudflare' | 'node' {
  const entry = resolve(SERVER_DIR, 'entry.mjs');
  if (!existsSync(entry)) return 'cloudflare'; // 无产物时按默认目标，让 requireBuild 报错
  try {
    return readFileSync(entry, 'utf8').includes('cloudflare:workers') ? 'cloudflare' : 'node';
  } catch {
    return 'cloudflare';
  }
}

export const BUILD_TARGET = detectBuildTarget();

/** 有没有可用产物 */
export const HAS_BUILD = existsSync(resolve(SERVER_DIR, 'entry.mjs'));

/**
 * 校验产物存在且不早于源码。
 *
 * 两种产物的目录结构不同（CF 有 scheduled-worker.mjs，Node 没有），
 * 所以按目标分别校验各自必需的文件。
 */
export function requireBuild(): void {
  if (!HAS_BUILD) {
    throw new Error('dist/server/entry.mjs 缺失，请先运行 pnpm run build');
  }

  // 源码时间戳：改代码忘 build 时明确失败，避免 e2e 误测旧产物
  let srcNewest = 0;
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirWithTypes(dir)) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git' || e.name === '.astro') {
        continue;
      }
      const p = resolve(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|vue|js|mjs|json|css|astro|sql)$/i.test(e.name)) {
        const t = statMtime(p);
        if (t > srcNewest) srcNewest = t;
      }
    }
  };
  for (const dir of ['src', 'admin/src', 'scripts', 'db']) walk(dir);

  let distNewest = statMtime(resolve(SERVER_DIR, 'entry.mjs'));

  // 平台特有产物
  if (BUILD_TARGET === 'cloudflare') {
    const workerEntry = resolve(SERVER_DIR, 'scheduled-worker.mjs');
    if (!existsSync(workerEntry)) {
      throw new Error('dist/server/scheduled-worker.mjs 缺失，请先运行 pnpm run build');
    }
    const t = statMtime(workerEntry);
    if (t > distNewest) distNewest = t;
  }

  // 后台产物（两种目标都有）
  const adminDir = resolve('dist/client/admin');
  if (existsSync(adminDir)) {
    for (const f of readdirNames(adminDir)) {
      const t = statMtime(resolve(adminDir, f));
      if (t > distNewest) distNewest = t;
    }
  }

  // 写作区源产物：node 目标下 dist/client/write/index.html 会被主动删除，
  // 所以检查源目录 admin/dist-write 更稳
  const writeSrc = resolve('admin/dist-write/index.html');
  if (!existsSync(writeSrc)) {
    throw new Error('admin/dist-write/index.html 缺失，请先运行 pnpm run build');
  }
  const writeDir = resolve('dist/client/write');
  if (!existsSync(writeDir)) {
    throw new Error('dist/client/write 缺失，请先运行 pnpm run build');
  }
  for (const f of readdirNames(writeDir)) {
    const t = statMtime(resolve(writeDir, f));
    if (t > distNewest) distNewest = t;
  }

  if (distNewest < srcNewest) {
    throw new Error('dist 构建产物早于源码，请先重新运行 pnpm run build');
  }
}

// 目录遍历小工具（readdir withFileTypes + 按名字取 + 取 mtime）
function readdirWithTypes(dir: string) {
  return readdirSync(dir, { withFileTypes: true });
}
function readdirNames(dir: string): string[] {
  return readdirWithTypes(dir).map((e) => e.name);
}
function statMtime(p: string): number {
  return statSync(p).mtimeMs;
}

/**
 * 创建 e2e 客户端。
 *
 * 按 BUILD_TARGET 动态加载对应实现，返回结构完全一致的对象。
 */
export async function makeE2e(): Promise<E2eClient> {
  if (BUILD_TARGET === 'cloudflare') {
    const mod = await import('./e2e.cloudflare.ts');
    // 两种实现的运行时对象结构一致，只有 db（Node 专有）与 mf（CF 专有）不同，
    // 在接口里都是可选的，这里显式收窄成公共接口。
    return (await mod.makeE2e()) as E2eClient;
  }
  const mod = await import('./e2e.node.ts');
  return (await mod.makeE2e()) as E2eClient;
}

/** 造一个可登录账号并返回其会话 cookie（两个实现共用同一套签名） */
export async function seedUserSession(
  client: E2eClient,
  opts: { username: string; role?: 'reader' | 'author' | 'admin'; displayName?: string; bio?: string },
): Promise<SeededUser> {
  if (BUILD_TARGET === 'cloudflare') {
    const mod = await import('./e2e.cloudflare.ts');
    return mod.seedUserSession(client, opts);
  }
  const mod = await import('./e2e.node.ts');
  return mod.seedUserSession(client, opts);
}

/** 切回管理员会话 */
export async function loginAsAdmin(client: E2eClient): Promise<string> {
  if (BUILD_TARGET === 'cloudflare') {
    const mod = await import('./e2e.cloudflare.ts');
    return mod.loginAsAdmin(client);
  }
  const mod = await import('./e2e.node.ts');
  return mod.loginAsAdmin(client);
}

/** 跨域写请求头（用例里大量直接用） */
export const ORIGIN_HEADERS = { Origin: 'http://e2e.test', 'Sec-Fetch-Site': 'same-origin' };
