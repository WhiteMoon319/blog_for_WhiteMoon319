// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// 运行时环境解析（双平台）
// ============================================================================
//
// 两种运行时拿 env 的方式完全不同：
//
//   Cloudflare Workers
//     平台注入模块级 env：`import { env } from 'cloudflare:workers'`。
//     这个模块只有在 Workers 上才能解析，Node 里 import 会直接抛错，
//     所以必须用「动态 import + try/catch」，不能写成顶层 import。
//
//   Node.js
//     server/index.mjs 启动时把解析器挂到 globalThis.__BLOG_ENV_RESOLVER__。
//
// 业务代码里的 94 处 envOf() 调用一行都不用改。
type EnvResolver = () => Promise<Env>;

/**
 * Cloudflare 分支：从 cloudflare:workers 读平台注入的 env。
 *
 * 结果缓存成 Promise：envOf() 是每请求热路径，虽然模块本身有缓存，
 * 但反复 await 动态 import 仍有微任务开销。
 */
let cfEnvPromise: Promise<Env> | null = null;

async function resolveFromCloudflare(): Promise<Env> {
  if (!cfEnvPromise) {
    cfEnvPromise = import('cloudflare:workers')
      .then((m) => m.env as Env)
      .catch((err) => {
        // 清掉缓存，让下次还能重试（例如模块加载瞬时失败）
        cfEnvPromise = null;
        throw err;
      });
  }
  return cfEnvPromise;
}

const resolveEnv: EnvResolver = async () => {
  const g = globalThis as { __BLOG_ENV_RESOLVER__?: EnvResolver };

  // 1) Node 后端注入的解析器（有就优先用——说明是 Node 侧启动的）
  if (typeof g.__BLOG_ENV_RESOLVER__ === 'function') {
    return g.__BLOG_ENV_RESOLVER__();
  }

  // 2) Cloudflare Workers：平台注入的 env
  try {
    return await resolveFromCloudflare();
  } catch (err) {
    // 3) 两边都没拿到：给出可操作的错误信息，而不是 undefined 引发下游连环报错
    const isCfRuntime = typeof (globalThis as Record<string, unknown>).WebSocketPair === 'function';
    throw new Error(
      `envOf() 无法取得运行环境（当前判定为 ${isCfRuntime ? 'Cloudflare Workers' : '未知运行时'}）。\n` +
        `- Cloudflare：确认部署在 Workers 上，且 compatibility_flags 含 nodejs_compat\n` +
        `- Node：请通过 server/index.mjs 启动，或先调用 __setEnvResolver()\n` +
        `原始错误：${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

/**
 * 显式覆盖解析器（测试注入用）。
 * 传 null 可清除覆盖、回退到自动探测。
 */
export function __setEnvResolver(fn: EnvResolver | null): void {
  const g = globalThis as { __BLOG_ENV_RESOLVER__?: EnvResolver };
  if (fn) g.__BLOG_ENV_RESOLVER__ = fn;
  else delete g.__BLOG_ENV_RESOLVER__;
}

export async function envOf(): Promise<Env> {
  return resolveEnv();
}
