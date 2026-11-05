// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// 定时发布调度器（Node 后端专用入口）
// ============================================================================
//
// 为什么需要这个文件：
//   scheduling.ts 原来只被 worker/worker.ts 的 scheduled() 引用。
//   Node 后端不再打包 worker（wrangler 已移除），Astro 构建时按路由图做
//   tree-shaking，publishDuePosts 就整个被摇掉了。
//
// 解决方式：把调度逻辑做成一个 Astro API 路由，让构建图天然包含它。
//   - POST /api/internal/publish-due  由 server/index.mjs 的定时器调用
//   - 用共享密钥校验，避免暴露成公开的「帮我发文章」按钮
//   - 复用 publishDuePosts，语义与 Workers 版 cron 完全一致

import type { APIContext } from 'astro';
import { envOf } from '../../../lib/db';
import { publishDuePosts } from '../../../lib/db/scheduling';

export const prerender = false;

/** 运行时校验：请求头必须带调度密钥（来自环境变量，进程内比对） */
function isAuthorized(ctx: APIContext): boolean {
  const expected = process.env.BLOG_SCHEDULER_TOKEN;
  // 未配置密钥时只允许本机回环调用：定时器就在同一进程里，够用且不对外开洞
  if (!expected) {
    const addr = ctx.clientAddress ?? '';
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  }
  return ctx.request.headers.get('x-scheduler-token') === expected;
}

/** 执行一轮到期草稿的刊发 */
export async function POST(ctx: APIContext): Promise<Response> {
  if (!isAuthorized(ctx)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const env = await envOf();
    const result = await publishDuePosts(env.DB, new Date());
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    // 失败返回 500：定时器会记录并等下一轮重试（scheduled_at 未清空）
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
