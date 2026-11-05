// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// Node 后端启动入口
// ============================================================================
//
// 与 Cloudflare 版的分工差异：
//   Cloudflare：worker/worker.ts 包装 entry.mjs，env 由平台注入，cron 由 triggers 触发
//   Node：      本文件在「导入 dist/server/entry.mjs 之前」完成 env / 缓存注入，
//               再由 entry.mjs 的 standalone 适配器起 HTTP 服务；
//               定时发布由本文件的 setInterval 承担（替代 wrangler crons）
//
// 启动顺序很关键：@astrojs/node 的 standalone 模式在模块加载时就会 listen，
// 所以所有注入必须在动态 import 之前完成，业务代码第一次 envOf() 才能拿到 env。

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MemoryPageCache } from './cache.mjs';
import { createEnv } from './env.mjs';
import { runMigrations } from './migrate.mjs';

const ROOT = resolve(import.meta.dirname, '..');

// 必须在 import dist/server/entry.mjs 之前设好：entry.mjs 顶层会读这个变量，
// 读到 'disabled' 才不自动 listen（我们要自己起 server 以便挂健康检查与优雅关闭）。
// @astrojs/node 11.1.9 的 standalone() 调用 app.getLogger()，而 astro 7.2 已移除该
// 方法，走自动启动会在 listen 之后抛 TypeError 并以退出码 1 结束进程。
process.env.ASTRO_NODE_AUTOSTART = 'disabled';

/** 是否生产模式（决定 edge cache 与迁移行为） */
const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * 统一日志前缀，方便 systemd / docker logs 过滤
 * @param {...unknown} args
 */
function log(...args) {
  console.log('[blog]', ...args);
}

/**
 * @param {...unknown} args
 */
function logError(...args) {
  console.error('[blog][error]', ...args);
}

/**
 * 启动前健康检查：缺少关键配置时给出明确提示而不是运行期才炸。
 * @param {Record<string, unknown>} env
 */
function checkConfig(env) {
  const warnings = [];
  if (!env.BLOG_SESSION_SECRET) {
    warnings.push('BLOG_SESSION_SECRET 未设置：会话签名为空，任何重启后登录态全部失效');
  }
  if (!env.BLOG_ADMIN_PASSWORD) {
    warnings.push('BLOG_ADMIN_PASSWORD 未设置：首次初始化管理员需要它（或用 db/seed.sql）');
  }
  if (env.SITE_URL === 'http://localhost:4321' && IS_PROD) {
    warnings.push('SITE_URL 仍是默认值：RSS / sitemap / canonical 会指向 localhost');
  }
  for (const w of warnings) logError(w);
  return warnings.length;
}

/**
 * 定时发布：替代 Cloudflare 的 cron triggers（wrangler 里配的是每 5 分钟一次）。
 * 通过内部 API 路由触发，与业务逻辑（publishDuePosts）走同一条路径，
 * 避免在构建产物里按文件名去猜 chunk。
 *
 * @param {{ port: number, token?: string, env: Record<string, unknown> }} options
 */
function startScheduler(options) {
  const intervalMs = Number(process.env.BLOG_SCHEDULER_INTERVAL_MS ?? 5 * 60 * 1000);
  const url = `http://127.0.0.1:${options.port}/api/internal/publish-due`;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // 必须带 Origin：全站写接口（含这条内部路由）都过 CSRF 校验，
      // 缺 Origin 的 POST 会被 Astro 的跨站检查直接 403
      const origin = options.env.SITE_URL?.replace(/\/$/, '') || `http://127.0.0.1:${options.port}`;
      const headers = { 'Content-Type': 'application/json', Origin: origin };
      if (options.token) headers['x-scheduler-token'] = options.token;
      const res = await fetch(url, { method: 'POST', headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        logError(`定时刊发失败（HTTP ${res.status}）`, body?.error ?? '');
        return;
      }
      if (body.published > 0) {
        log(`定时刊发 ${body.published} 篇`, body.ids);
      }
    } catch (err) {
      // 失败不抛出：scheduled_at 保留，下一轮重试
      logError('定时刊发请求失败，等待下一轮重试', err?.message ?? err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  // 启动后 15s 先跑一轮，补偿进程重启期间错过的时段
  const kickoff = setTimeout(tick, 15_000);
  kickoff.unref?.();

  return {
    stop() {
      clearInterval(timer);
      clearTimeout(kickoff);
    },
  };
}

/**
 * 主流程
 */
async function main() {
  log(`启动中（NODE_ENV=${process.env.NODE_ENV ?? 'development'}）`);

  // ---- 1. 装配 env（同时套用迁移） ----
  const { env, close } = createEnv();
  log(`数据库：${env.DB.name}`);
  log(`站点：${env.SITE_NAME} @ ${env.SITE_URL}`);

  // 迁移策略：
  //   - 显式 BLOG_AUTO_MIGRATE=false → 不迁移（交给 pnpm migrate 手动控制）
  //   - 生产环境 → 总是迁移（部署后重启即可完成升级）
  //   - 开发环境 → 数据库里一张业务表都没有时迁移（首次运行开箱可用），
  //     已有数据时不动，避免开发中误改 schema
  const explicitAutoMigrate = process.env.BLOG_AUTO_MIGRATE;
  const sqlite = env.DB.raw;
  let shouldMigrate;
  if (explicitAutoMigrate === 'false') {
    shouldMigrate = false;
  } else if (explicitAutoMigrate === 'true' || IS_PROD) {
    shouldMigrate = true;
  } else {
    // 判断是否空库：没有任何业务表就认为是首次启动
    try {
      const row = sqlite
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .get();
      shouldMigrate = Number(row?.n ?? 0) === 0;
    } catch {
      shouldMigrate = true;
    }
  }

  if (shouldMigrate) {
    try {
      const result = runMigrations(sqlite);
      if (result.applied.length > 0) {
        log(`迁移完成：新应用 ${result.applied.length} 个（跳过 ${result.skipped} 个）`);
      } else {
        log(`迁移检查完成：全部 ${result.skipped} 个已应用`);
      }
    } catch (err) {
      logError('迁移失败，启动中止：', err.message);
      close();
      process.exit(1);
    }
  } else {
    log('跳过自动迁移（BLOG_AUTO_MIGRATE=false 或数据库已有数据）');
  }

  checkConfig(env);

  // ---- 2. 注入缓存实现 ----
  const cacheEnabled = env.EDGE_CACHE !== 'false';
  if (cacheEnabled) {
    const maxBytes = Number(process.env.BLOG_CACHE_MAX_BYTES ?? 64 * 1024 * 1024);
    const cache = new MemoryPageCache({ maxBytes, maxAgeSec: 60 });
    globalThis.__BLOG_PAGE_CACHE__ = cache;
    log(`页面缓存已启用（LRU ${Math.round(maxBytes / 1024 / 1024)}MB，TTL 60s）`);
  } else {
    log('页面缓存已禁用（EDGE_CACHE=false）');
  }

  // ---- 3. 注入 env 解析器（必须在 entry.mjs 导入前） ----
  globalThis.__BLOG_ENV_RESOLVER__ = async () => env;

  // --- 4. 启动 HTTP 服务 ---
  //
  // 关闭 adapter 的自动启动（ASTRO_NODE_AUTOSTART=disabled），改为自己起 http.Server：
  //   - @astrojs/node 11.1.9 的 standalone() 会调 app.getLogger()，而 astro 7.2 的
  //     App 已无此方法，直接自动启动会在 listen 之后抛错并退出
  //   - 自定义服务器才能实现「后台外壳优先走 SSR」与健康检查、优雅关闭
  process.env.ASTRO_NODE_AUTOSTART = 'disabled';
  const entryPath = join(ROOT, 'dist', 'server', 'entry.mjs');
  if (!existsSync(entryPath)) {
    logError(`构建产物不存在：${entryPath}`);
    logError('请先运行 pnpm run build');
    close();
    process.exit(1);
  }
  log('加载 Astro 入口…');
  const mod = await import(entryPath);
  const handler = mod.handler;
  if (typeof handler !== 'function') {
    logError('dist/server/entry.mjs 未导出 handler，adapter 版本不匹配');
    close();
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? 4321);
  const host = process.env.HOST ?? '0.0.0.0';
  const clientDir = resolve(env.BLOG_CLIENT_DIR ?? join(ROOT, 'dist', 'client'));

  const { createServer } = await import('node:http');
  const { createReadStream } = await import('node:fs');
  const { contentTypeOf, resolveStaticFile, staticCacheControl } = await import('./static.mjs');

  const server = createServer((req, res) => {
    // 健康检查：给 systemd / 负载均衡探活用，不打 SSR
    if (req.url === '/__health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
      return;
    }

    // ---- 静态资源（SSR-first 的静态分支）----
    // 只在自己确认是「真实存在的带扩展名文件」时才走这条，
    // 其余一律交给 SSR，避免 adapter 的 static handler 抢走路由。
    try {
      const urlPath = (req.url ?? '/').split('?')[0].split('#')[0];
      const file = resolveStaticFile(clientDir, urlPath);
      if (file) {
        res.writeHead(200, {
          'Content-Type': contentTypeOf(file),
          'Cache-Control': staticCacheControl(urlPath),
          'X-Content-Type-Options': 'nosniff',
        });
        createReadStream(file).pipe(res);
        return;
      }
    } catch {
      // 静态判定异常时降级给 SSR，不要让请求挂掉
    }

    try {
      const ret = handler(req, res);
      // handler 若返回 Promise，兜住 rejection，避免挂起请求
      if (ret && typeof ret.catch === 'function') {
        ret.catch((err) => {
          logError('请求处理异常：', err);
          if (!res.headersSent) res.writeHead(500);
          res.end('Internal Server Error');
        });
      }
    } catch (err) {
      logError('请求处理异常：', err);
      if (!res.headersSent) res.writeHead(500);
      res.end('Internal Server Error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  log(`HTTP 服务已监听 http://${host}:${port}`);

  // ---- 5. 定时任务 ----
  const schedulerEnabled = process.env.BLOG_SCHEDULER !== 'false';
  let scheduler = null;
  if (schedulerEnabled) {
    scheduler = startScheduler({
      port,
      token: process.env.BLOG_SCHEDULER_TOKEN,
      env,
    });
    log('定时发布调度已启动（每 5 分钟）');
  }

  // ---- 6. 优雅关闭 ----
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`收到 ${signal}，开始优雅关闭…`);
    try {
      scheduler?.stop();
      // 先停止接受新连接，再等存量请求收尾
      await new Promise((resolve) => {
        server.close(() => resolve(undefined));
        // 兜底：5s 内没关干净就强制断开
        setTimeout(() => {
          server.closeAllConnections?.();
          resolve(undefined);
        }, 5000).unref?.();
      });
      close();
    } catch (err) {
      logError('关闭时出错：', err?.message ?? err);
    }
    log('已关闭');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // 未捕获异常：记录但不立刻退出，避免单次请求异常打挂整站
  process.on('unhandledRejection', (reason) => {
    logError('未处理的 Promise 拒绝：', reason);
  });
  process.on('uncaughtException', (err) => {
    logError('未捕获异常：', err);
  });
}

main().catch((err) => {
  logError('启动失败：', err);
  process.exit(1);
});
