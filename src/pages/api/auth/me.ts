import type { APIContext } from 'astro';
import { getSession, json } from '../../../lib/auth';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const session = await getSession(ctx);
  if (!session) {
    return json({ authenticated: false }, 401);
  }
  return json({ authenticated: true, sub: session.sub, exp: session.exp });
}