// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 构建 Worker 外层入口：esbuild 打包 worker/worker.ts 为 dist/server/scheduled-worker.mjs，
// 并把 dist/server/wrangler.json（vite 插件生成的部署配置）的 main 指向它。
// 必须在 astro build 之后执行（依赖生成的 entry.mjs / wrangler.json），
// 因此位于 pnpm build 流水线的最后一步；no_bundle 部署下 './entry.mjs' 保持为模块清单引用。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('dist/server', { recursive: true });

await build({
  entryPoints: ['worker/worker.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['./entry.mjs'],
  outfile: 'dist/server/scheduled-worker.mjs',
  logLevel: 'info',
});

const configPath = 'dist/server/wrangler.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.main !== 'entry.mjs') {
  throw new Error(`dist/server/wrangler.json 的 main 应为 entry.mjs，实际为 ${config.main}，部署配置未被插件生成？`);
}
config.main = 'scheduled-worker.mjs';
writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('[build-worker] dist/server/scheduled-worker.mjs 已生成，wrangler.json main 已指向（含 scheduled 入口）');