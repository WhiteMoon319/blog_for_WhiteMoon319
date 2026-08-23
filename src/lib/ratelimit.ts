// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

const MAX_DEFAULT = 10;
const WINDOW_DEFAULT = 300;

export interface RateLimitResult {
  ok: boolean;
  retryAfter: number;
}

export function clientIp(request: Request): string {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf && cf.trim()) return cf.trim();
  const xff = request.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  if (first) return first;
  return 'unknown';
}

export interface ConsumeOptions {
  max?: number;
  windowSec?: number;
}

/**
 * 登录限流：基于 D1 的原子单语句 upsert（login_attempts 表）。
 * 并发请求由 SQLite 写事务串行化，计数不会丢失更新；
 * 存储不可用时 fail-open（放行并记录告警），避免登录功能整体不可用。
 */
export async function consumeLoginAttempt(
  db: D1Database,
  ip: string,
  opts: ConsumeOptions = {},
): Promise<RateLimitResult> {
  const max = opts.max && opts.max > 0 ? opts.max : MAX_DEFAULT;
  const windowSec = opts.windowSec && opts.windowSec > 0 ? opts.windowSec : WINDOW_DEFAULT;
  const now = Math.floor(Date.now() / 1000);
  const windowEnd = now + windowSec;

  try {
    const [attempt] = await db.batch([
      db
        .prepare(
          `INSERT INTO login_attempts (key, count, window_start, window_end)
           VALUES (?, 1, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             count = CASE WHEN login_attempts.window_end <= ? THEN 1 ELSE login_attempts.count + 1 END,
             window_start = CASE WHEN login_attempts.window_end <= ? THEN ? ELSE login_attempts.window_start END,
             window_end = CASE WHEN login_attempts.window_end <= ? THEN ? ELSE login_attempts.window_end END
           RETURNING count, window_end`,
        )
        .bind(ip, now, windowEnd, now, now, now, now, windowEnd),
      db.prepare(`DELETE FROM login_attempts WHERE window_end < ?`).bind(now),
    ]);
    const row = attempt.results?.[0] as { count: number; window_end: number } | undefined;
    const count = row?.count ?? 1;
    if (count > max) {
      return { ok: false, retryAfter: Math.max(1, (row?.window_end ?? windowEnd) - now) };
    }
    return { ok: true, retryAfter: 0 };
  } catch (e) {
    console.error('[ratelimit] 存储异常，本次放行:', e);
    return { ok: true, retryAfter: 0 };
  }
}
