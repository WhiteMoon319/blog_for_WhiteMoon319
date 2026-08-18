import type { APIContext } from 'astro';
import {
  envOf,
  createPost,
  getCollectionById,
  purgeOrphanTagsStmt,
  isSlugConflict,
  type PostRow,
} from '../../../lib/db';
import { slugify, isValidSlug } from '../../../lib/utils';
import { json, requireAuth } from '../../../lib/auth';

export const prerender = false;

const MAX_IDS = 200;
const MAX_CREATE = 50;
const MAX_MOVE = 50;

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

    const results: Array<{ ok: boolean; error?: string; post?: PostRow }> = [];
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
      results.push(created ? { ok: true, post: created } : { ok: false, error: lastError });
    }
    return json({ ok: true, results });
  }

  const ids = parseIds(body.ids);
  if (!ids) return json({ error: 'invalid ids' }, 400);

  if (action === 'move') {
    const target = body.collection_id === null ? null : body.collection_id;
    if (target !== null && (typeof target !== 'number' || !Number.isInteger(target) || target <= 0)) {
      return json({ error: 'invalid collection_id' }, 400);
    }
    if (target !== null && !(await getCollectionById(env.DB, target))) {
      return json({ error: 'collection not found' }, 404);
    }
    if (ids.length > MAX_MOVE) {
      return json({ error: `move 单次最多 ${MAX_MOVE} 篇` }, 400);
    }

    const placeholders = ids.map(() => '?').join(', ');
    const rows = await env.DB
      .prepare(`SELECT id, slug, collection_id FROM posts WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<{ id: number; slug: string; collection_id: number | null }>();
    const found = rows.results ?? [];
    if (found.length !== ids.length) {
      return json({ error: '部分文章不存在，本次移动未执行' }, 404);
    }

    // 预检目标范围内的 slug 冲突（含本批文章之间的互撞），全部通过才执行，
    // 执行阶段用单个 D1 事务（batch）保证「全成功或全失败」。
    const taken = new Set<string>();
    const scope = target === null
      ? env.DB.prepare('SELECT slug FROM posts WHERE collection_id IS NULL')
      : env.DB.prepare('SELECT slug FROM posts WHERE collection_id = ?').bind(target);
    const scopeRows = await scope.all<{ slug: string }>();
    for (const r of scopeRows.results ?? []) taken.add(r.slug);
    // 仅在文章本就在目标范围（同范围重定位）时移除其 slug，避免把目标范围内
    // 已存在的同 slug 一并抹掉而漏检真实冲突
    for (const r of found) {
      if (target === null ? r.collection_id === null : r.collection_id === target) {
        taken.delete(r.slug);
      }
    }

    const seen = new Set<string>();
    const conflicts: string[] = [];
    for (const r of found) {
      if (taken.has(r.slug) || seen.has(r.slug)) conflicts.push(r.slug);
      seen.add(r.slug);
      taken.add(r.slug);
    }
    if (conflicts.length > 0) {
      return json({ error: `slug 冲突：${conflicts.join('、')}，本次移动未执行`, conflicts }, 409);
    }

    const stmts: D1PreparedStatement[] = [];
    for (const r of found) {
      stmts.push(
        env.DB
          .prepare(`UPDATE posts SET collection_id = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(target, r.id),
      );
      stmts.push(
        env.DB
          .prepare(
            `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, message)
             SELECT ?, COALESCE((SELECT MAX(version) FROM post_versions WHERE post_id = ?), 0) + 1,
                    title, slug, ?, summary, content_md, cover_url, status, '自动保存'
             FROM posts WHERE id = ?`,
          )
          .bind(r.id, r.id, target, r.id),
      );
    }
    try {
      await env.DB.batch(stmts);
    } catch (e) {
      if (isSlugConflict(e)) {
        return json({ error: 'slug 冲突：目标文集并发变化，本次移动未执行' }, 409);
      }
      throw e;
    }
    return json({ ok: true, count: found.length });
  }

  if (action === 'delete') {
    // 先查实际存在的 id，按存在数删除并计数（避免依赖 meta.changes 的级联行数）
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await env.DB
      .prepare(`SELECT id FROM posts WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<{ id: number }>();
    const existing = (rows.results ?? []).map((r) => r.id);
    if (existing.length === 0) return json({ ok: true, count: 0 });
    const stmts: D1PreparedStatement[] = [];
    for (const id of existing) {
      stmts.push(env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id));
      stmts.push(purgeOrphanTagsStmt(env.DB));
    }
    await env.DB.batch(stmts);
    return json({ ok: true, count: existing.length });
  }

  // 批量 publish/draft 并入单个 D1 batch：全成功或全失败
  const stmts: D1PreparedStatement[] = [];
  for (const id of ids) {
    stmts.push(
      env.DB
        .prepare(`UPDATE posts SET status = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(action === 'publish' ? 'published' : 'draft', id),
    );
  }
  await env.DB.batch(stmts);

  return json({ ok: true, count: ids.length });
}