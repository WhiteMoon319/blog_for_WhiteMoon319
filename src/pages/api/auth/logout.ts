import type { APIContext } from 'astro';
import { clearSessionCookie, json } from '../../../lib/auth';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  clearSessionCookie(ctx);
  return json({ ok: true });
}