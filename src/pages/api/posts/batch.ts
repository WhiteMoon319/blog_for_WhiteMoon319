import type { APIContext } from 'astro';
import {
  envOf,
  updatePost,
  deletePost,
  createPost,
  getCollectionById,
  isSlugConflict,
} from '../../../lib/db';
import { slugify, ensureSlug, isValidSlug } from '../../../lib/utils';
import { json, requireAuth } from '../../../lib/auth';

export const prerender = false;

const MAX_IDS = 200;
const MAX_CREATE = 50;

type Action = 'publish' | 'draft' | 'delete' | 'move' | 'create';

function parseIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_IDS) return null;
  const ids: number[] = [];
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return null;
    ids.push(v);
  }
  return [...new Set(ids)];
}

interface CreateItem {
  title: string;
  slug: string;
  summary: string;
  content_md: string;
  collection_id: number | null;
  status: 'draft' | 'published';
}

function parseCreateItem(raw: unknown, fallbackCollection: number | null): CreateItem | string {
  if (typeof raw !== 'object' || raw === null) return 'invalid item';
  const o = raw as Record<string, unknown>;

  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (!title) return '标题不能为空';

  const status = o.status === 'published' ? 'published' : 'draft';

  const rawCol = o.collection_id === undefined ? fallbackCollection : o.collection_id;
  let collection_id: number | null = null;
  if (rawCol !== null && rawCol !== undefined) {
    if (typeof rawCol !== 'number' || !Number.isInteger(rawCol) || rawCol <= 0) {
      return 'invalid collection_id';
    }
    collection_id = rawCol;
  }

  let slug = '';
  if (typeof o.slug === 'string' && o.slug.trim()) {
    if (!isValidSlug(o.slug.trim())) return 'invalid slug';
    slug = o.slug.trim();
  }

  return {
    title,
    slug,
    summary: typeof o.summary === 'string' ? o.summary : '',
    content_md: typeof o.content_md === 'string' ? o.content_md : '',
    collection_id,
    status,
  };
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
  if (
    action !== 'publish' &&
    action !== 'draft' &&
    action !== 'delete' &&
    action !== 'move' &&
    action !== 'create'
  ) {
    return json({ error: 'invalid action' }, 400);
  }

  const env = await envOf();

  if (action === 'create') {
    const rawPosts = body.posts;
    if (!Array.isArray(rawPosts) || rawPosts.length === 0 || rawPosts.length > MAX_CREATE) {
      return json({ error: 'invalid posts: 每次 1-50 篇' }, 400);
    }
    const fallbackCol = typeof body.collection_id === 'number' ? body.collection_id : null;
    if (fallbackCol !== null && !(await getCollectionById(env.DB, fallbackCol))) {
      return json({ error: 'collection not found' }, 404);
    }

    const results: Array<{ ok: boolean; error?: string; post?: Record<string, unknown> }> = [];
    for (const raw of rawPosts) {
      const item = parseCreateItem(raw, fallbackCol);
      if (typeof item === 'string') {
        results.push({ ok: false, error: item });
        continue;
      }
      const base = item.slug || slugify(item.title) || `post-${Date.now().toString(36)}`;
      let created: Awaited<ReturnType<typeof createPost>> = null;
      let lastError = 'slug already exists';
      for (let attempt = 0; attempt < 20; attempt++) {
        const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
        try {
          created = await createPost(env.DB, { ...item, slug });
          break;
        } catch (e) {
          if (isSlugConflict(e)) {
            lastError = 'slug already exists';
            continue;
          }
          lastError = e instanceof Error ? e.message : 'create failed';
          break;
        }
      }
      results.push(created ? { ok: true, post: created as Record<string, unknown> } : { ok: false, error: lastError });
    }
    return json({ ok: true, results });
  }

  const ids = parseIds(body.ids);
  if (!ids) return json({ error: 'invalid ids' }, 400);

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