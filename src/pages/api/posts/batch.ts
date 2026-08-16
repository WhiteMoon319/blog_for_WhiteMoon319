import type { APIContext } from 'astro';
import { envOf, updatePost, deletePost, getCollectionById, isSlugConflict } from '../../../lib/db';
import { json, requireAuth } from '../../../lib/auth';

export const prerender = false;

const MAX_IDS = 200;

type Action = 'publish' | 'draft' | 'delete' | 'move';

function parseIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_IDS) return null;
  const ids: number[] = [];
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return null;
    ids.push(v);
  }
  return [...new Set(ids)];
}

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const action = body.action as Action;
  if (action !== 'publish' && action !== 'draft' && action !== 'delete' && action !== 'move') {
    return json({ error: 'invalid action' }, 400);
  }

  const ids = parseIds(body.ids);
  if (!ids) return json({ error: 'invalid ids' }, 400);

  const env = await envOf();

  if (action === 'move') {
    const cid = body.collection_id;
    if (cid !== null && (typeof cid !== 'number' || !Number.isInteger(cid) || cid <= 0)) {
      return json({ error: 'invalid collection_id' }, 400);
    }
    if (cid !== null && !(await getCollectionById(env.DB, cid))) {
      return json({ error: 'collection not found' }, 404);
    }
  }

  let count = 0;
  for (const id of ids) {
    if (action === 'delete') {
      await deletePost(env.DB, id);
    } else if (action === 'move') {
      try {
        await updatePost(env.DB, id, {
          collection_id: body.collection_id === null ? null : (body.collection_id as number),
        });
      } catch (e) {
        if (isSlugConflict(e)) {
          return json({ error: `slug conflict: post #${id}`, processed: count }, 409);
        }
        throw e;
      }
    } else {
      await updatePost(env.DB, id, { status: action === 'publish' ? 'published' : 'draft' });
    }
    count++;
  }

  return json({ ok: true, count });
}