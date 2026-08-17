import type { APIContext } from 'astro';
import { envOf, listAllTagCounts } from '../../../lib/db';
import { json } from '../../../lib/auth';

export const prerender = false;

export async function GET(_ctx: APIContext): Promise<Response> {
  const env = await envOf();
  const tags = await listAllTagCounts(env.DB);
  return json({ tags });
}
