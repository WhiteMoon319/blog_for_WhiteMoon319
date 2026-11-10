// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// `cloudflare:workers` 模块声明垫片
// ============================================================================
//
// src/lib/db/env.ts 在 Cloudflare 分支里用 `import('cloudflare:workers')`
// 取平台注入的 env。这个模块只在 Workers 运行时真实存在：
//
//   - 在 tsconfig.worker.json 下，类型由 @cloudflare/workers-types 提供
//     （那边通过 `types` 字段加载，本文件被 exclude 掉，不会重复声明）；
//   - 在 tsconfig.test.json / 普通 astro check 下没有 workers-types，
//     于是这里补一个最小声明让 tsc 能过。
//
// 注意：本文件**必须**是全局脚本（顶层没有 import/export）。
// 一旦出现 import 或 export，文件会变成模块，`declare module` 就从
// 「全局声明」退化成「模块增补」，tsc 会报
//   Cannot find module 'cloudflare:workers'
// 这正是最初把它写在 src/env.d.ts 里失败的原因（那里末尾有 export {}）。

declare module 'cloudflare:workers' {
  /** Workers 运行时注入的绑定集合（D1 / R2 / 环境变量等） */
  export const env: Env;
}
