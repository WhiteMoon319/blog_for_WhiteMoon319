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

export async function consumeLoginAttempt(
  env: Pick<Env, 'RATE_LIMIT' | 'LOGIN_RATE_LIMIT_MAX' | 'LOGIN_RATE_LIMIT_WINDOW'>,
  ip: string,
): Promise<RateLimitResult> {
  const max = env.LOGIN_RATE_LIMIT_MAX > 0 ? env.LOGIN_RATE_LIMIT_MAX : MAX_DEFAULT;
  const windowSec = env.LOGIN_RATE_LIMIT_WINDOW > 0 ? env.LOGIN_RATE_LIMIT_WINDOW : WINDOW_DEFAULT;
  const now = Math.floor(Date.now() / 1000);
  const key = `login:${ip}`;

  let count = 0;
  let start = now;
  const raw = await env.RATE_LIMIT.get(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { count?: unknown; start?: unknown };
      if (typeof parsed.count === 'number' && Number.isInteger(parsed.count)) count = parsed.count;
      if (typeof parsed.start === 'number') start = parsed.start;
    } catch {
      count = 0;
    }
  }

  if (now - start >= windowSec) {
    count = 0;
    start = now;
  }
  count += 1;
  const windowEnd = start + windowSec;

  if (count > max) {
    return { ok: false, retryAfter: Math.max(1, windowEnd - now) };
  }

  await env.RATE_LIMIT.put(key, JSON.stringify({ count, start }), {
    expirationTtl: Math.max(60, windowEnd - now),
  });
  return { ok: true, retryAfter: 0 };
}