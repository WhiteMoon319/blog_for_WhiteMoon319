import type { APIContext } from 'astro';
import { checkPassword, json, setSessionCookie } from '../../../lib/auth';
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
  const attempt = await consumeLoginAttempt(env, clientIp(ctx.request));
  if (!attempt.ok) {
    return new Response(JSON.stringify({ error: 'too many attempts, try again later' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(attempt.retryAfter) },
    });
  }

  if (!checkPassword(env, body.password)) {
    return json({ error: 'invalid credentials' }, 401);
  }
  await setSessionCookie(ctx, 'admin');
  return json({ ok: true });
}