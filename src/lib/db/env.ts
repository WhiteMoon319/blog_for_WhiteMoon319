// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// 运行时环境解析
// ============================================================================
//
// 原来这里硬依赖 `cloudflare:workers` 的模块级 env（Workers 里 env 绑定是
// 隐式注入的全局）。Node 后端没有这个概念，改为「由 server/env.mjs 在启动时
// 注入一个解析器」，业务代码继续调 envOf()，调用点无需改动。
//
// 保留 __setEnvResolver 是给测试用的：tests/helpers 里可以注入假环境。
type EnvResolver = () => Promise<Env>;

/**
 * 惰性默认实现：优先走 Node 后端注入的全局解析器，
 * 都拿不到时抛错（比返回 undefined 更容易定位问题）。
 */
let resolveEnv: EnvResolver = async () => {
  const injected = (globalThis as { __BLOG_ENV_RESOLVER__?: EnvResolver }).__BLOG_ENV_RESOLVER__;
  if (injected) return injected();
  throw new Error(
    'envOf() 未初始化：Node 后端请从 server/index.mjs 启动，或先调用 __setEnvResolver()',
  );
};

export function __setEnvResolver(fn: EnvResolver): void {
  resolveEnv = fn;
}

export async function envOf(): Promise<Env> {
  return resolveEnv();
}
