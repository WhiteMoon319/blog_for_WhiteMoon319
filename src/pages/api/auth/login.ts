import type { APIContext } from 'astro';
import { checkPassword, checkCsrf, json, setSessionCookie } from '../../../lib/auth';
import { envOf } from '../../../lib/db';
import { clientIp, consumeLoginAttempt } from '../../../lib/ratelimit';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  let body: { password?: unknown };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (typeof body.password !== 'string') {
    return json({ error: 'password required' }, 400);
  }

  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) {
    return json({ error: 'forbidden: invalid origin' }, 403);
  }

  const attempt = await consumeLoginAttempt(env.DB, clientIp(ctx.request), {
    max: env.LOGIN_RATE_LIMIT_MAX,
    windowSec: env.LOGIN_RATE_LIMIT_WINDOW,
  });
  if (!attempt.ok) {
    return new Response(JSON.stringify({ error: 'too many attempts, try again later' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(attempt.retryAfter) },
    });
  }

  if (!(await checkPassword(env, body.password))) {
    return json({ error: 'invalid credentials' }, 401);
  }
  await setSessionCookie(ctx, 'admin');
  return json({ ok: true });
}