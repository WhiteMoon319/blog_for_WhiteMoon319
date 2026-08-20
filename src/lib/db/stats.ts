import type { D1Database } from '@cloudflare/workers-types';
import { clientIp } from '../ratelimit.ts';

// 去重口径：同一 IP 访问同一篇文章，同一自然日（UTC）只计 1 次。
// 机器人流量：UA 命中常见爬虫/脚本指纹的请求不进入日聚合（view_count 保持原样）。
// 隐私：去重只存 IP 的 SHA-256 摘要，不存原始 IP。

const BOT_UA_RE =
  /googlebot|bingbot|baiduspider|yandex|duckduckbot|slurp|facebookexternalhit|twitterbot|curl|wget|python-requests|axios|node-fetch|headlesschrome|semrush|ahrefs|mj12bot|petalbot|bytespider|monitoring/i;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_DEDUP_DAYS = 90;

export function isBotRequest(request: Request): boolean {
  const ua = request.headers.get('user-agent') ?? '';
  return BOT_UA_RE.test(ua);
}

export function viewDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = viewDay();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS);
    out.push(viewDay(d));
  }
  return out;
}

async function sha256hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 记录一次去重后的日浏览：机器人跳过；同 IP 同文同日已计过则跳过。
export async function recordDailyView(db: D1Database, postId: number, request: Request): Promise<void> {
  if (isBotRequest(request)) return;
  const ip = clientIp(request) || 'unknown';
  const day = viewDay();
  const ipHash = await sha256hex(ip);

  const dedup = await db
    .prepare('INSERT OR IGNORE INTO daily_view_ips (post_id, day, ip_hash) VALUES (?, ?, ?)')
    .bind(postId, day, ipHash)
    .run();
  if (dedup.meta.changes === 0) return; // 已计过

  await db
    .prepare(
      `INSERT INTO daily_views (post_id, day, views) VALUES (?, ?, 1)
       ON CONFLICT(post_id, day) DO UPDATE SET views = views + 1`,
    )
    .bind(postId, day)
    .run();

  // 概率性清理过期的去重指纹，控制表体积
  if (Math.random() < 0.01) {
    await db
      .prepare('DELETE FROM daily_view_ips WHERE day < date(?, ?)')
      .bind(viewDay(new Date(Date.now() - KEEP_DEDUP_DAYS * DAY_MS)), '-1 day')
      .run();
  }
}

export interface DailyViewRow {
  day: string;
  views: number;
}

export interface TopPostViews {
  id: number;
  title: string;
  slug: string;
  views: number;
}

export interface TrendStats {
  days: number;
  start_day: string;
  end_day: string;
  total_views: number;
  daily: DailyViewRow[];
  top_posts: TopPostViews[];
}

// 近 N 日趋势汇总：全站日浏览序列（缺日补 0）+ 热文 TOP 10（关联文章标题，软删除/彻底删除的文章仍保留统计）。
export async function getTrendStats(db: D1Database, days: number): Promise<TrendStats> {
  const n = Math.min(Math.max(days, 1), 365);
  const startDay = lastNDays(n)[0];
  const endDay = lastNDays(1)[0];

  const [daily, top, total] = await Promise.all([
    db
      .prepare(
        `SELECT day, SUM(views) AS views FROM daily_views
         WHERE day >= ? GROUP BY day ORDER BY day`,
      )
      .bind(startDay)
      .all<{ day: string; views: number }>(),
    db
      .prepare(
        `SELECT dv.post_id AS id, COALESCE(p.title, '(已删除)') AS title, COALESCE(p.slug, 'deleted') AS slug, SUM(dv.views) AS views
         FROM daily_views dv LEFT JOIN posts p ON p.id = dv.post_id
         WHERE dv.day >= ? GROUP BY dv.post_id ORDER BY views DESC LIMIT 10`,
      )
      .bind(startDay)
      .all<TopPostViews>(),
    db
      .prepare(`SELECT COALESCE(SUM(views), 0) AS total FROM daily_views WHERE day >= ?`)
      .bind(startDay)
      .first<{ total: number }>(),
  ]);

  const byDay = new Map((daily.results ?? []).map((r) => [r.day, Number(r.views)]));
  const series = lastNDays(n).map((day) => ({ day, views: byDay.get(day) ?? 0 }));

  return {
    days: n,
    start_day: startDay,
    end_day: endDay,
    total_views: total?.total ?? 0,
    daily: series,
    top_posts: (top.results ?? []).map((t) => ({ ...t, views: Number(t.views) })),
  };
}