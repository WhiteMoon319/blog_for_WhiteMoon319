// 自定义 Worker 入口：包装 @astrojs/cloudflare 生成的 entry.mjs（默认导出 fetch 处理器），
// 并承接 Cloudflare scheduled 事件（cron 定时发布，见 wrangler triggers）。
//
// @astrojs/cloudflare 生成的 entry.mjs 只导出 { fetch }，无法直接承接 scheduled，
// 因此由 scripts/build-worker.mjs 在 astro build 之后用 esbuild 打包本文件为
// dist/server/scheduled-worker.mjs，并把 dist/server/wrangler.json 的 main 指向它；
// './entry.mjs' 保持外部引用，运行时按模块清单（no_bundle 部署）解析。
import { publishDuePosts } from '../src/lib/db/scheduling.ts';
import astro from './entry.mjs';

async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  try {
    const result = await publishDuePosts(env.DB, new Date());
    console.log(`[scheduled] 定时刊发 ${result.published} 篇`, result.ids);
  } catch (err) {
    // 失败不抛出：scheduled_at 保留，下一轮 cron 重试
    console.error('[scheduled] 定时刊发失败，等待下一轮重试', err);
  }
}

// 注意：scheduled 必须放在 default 导出对象上——真实 Cloudflare 与
// miniflare 的 /cdn-cgi/local/scheduled（本地触发）都按 default 导出对象取处理器。
export default { ...astro, scheduled };