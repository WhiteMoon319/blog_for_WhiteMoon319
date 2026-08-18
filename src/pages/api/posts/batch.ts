import type { APIContext } from 'astro';
import {
  envOf,
  createPost,
  getCollectionById,
  getCollectionsByIds,
  purgeOrphanTagsStmt,
  isSlugConflict,
  type PostRow,
} from '../../../lib/db';
import { slugify } from '../../../lib/utils';
import {
  parseIds,
  parseCreateItem,
  BATCH_MAX_CREATE,
  BATCH_MAX_MOVE,
  type BatchCreateItem,
} from '../../../lib/api/validate';
import { json, requireAuth } from '../../../lib/auth';

export const prerender = false;

type Action = 'publish' | 'draft' | 'delete' | 'move' | 'create';

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
    if (!Array.isArray(rawPosts) || rawPosts.length === 0 || rawPosts.length > BATCH_MAX_CREATE) {
      return json({ error: 'invalid posts: 每次 1-50 篇' }, 400);
    }
    const fallbackCol = typeof body.collection_id === 'number' ? body.collection_id : null;
    if (fallbackCol !== null && !(await getCollectionById(env.DB, fallbackCol))) {
      return json({ error: 'collection not found' }, 404);
    }

    const parsed = rawPosts.map((raw) => parseCreateItem(raw, fallbackCol));
    const colIds = [
      ...new Set(
        parsed
          .filter((x): x is BatchCreateItem => typeof x !== 'string')
          .map((x) => x.collection_id)
          .filter((x): x is number => x !== null),
      ),
    ];
    if (colIds.length > 0 && (await getCollectionsByIds(env.DB, colIds)).size !== colIds.length) {
      return json({ error: 'collection not found' }, 404);
    }

    const results: Array<{ ok: boolean; error?: string; post?: PostRow }> = [];
    for (const item of parsed) {
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
    if (ids.length > BATCH_MAX_MOVE) {
      return json({ error: `move 单次最多 ${BATCH_MAX_MOVE} 篇` }, 400);
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
    // 先查实际存在的 id，按存在数删除并计数（避免依赖 meta.changes 的级联行数）。
    // D1 单语句绑定参数上限 100：存在性查询按 50 一批；D1 batch 单次上限 100 条语句：
    // 删除按 25 篇一批（每篇 2 条：删除 + 孤儿标签清理）。
    const existing: number[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const rows = await env.DB
        .prepare(`SELECT id FROM posts WHERE id IN (${chunk.map(() => '?').join(',')})`)
        .bind(...chunk)
        .all<{ id: number }>();
      existing.push(...(rows.results ?? []).map((r) => r.id));
    }
    if (existing.length === 0) return json({ ok: true, count: 0 });
    for (let i = 0; i < existing.length; i += 25) {
      const chunk = existing.slice(i, i + 25);
      const stmts: D1PreparedStatement[] = [];
      for (const id of chunk) {
        stmts.push(env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id));
        stmts.push(purgeOrphanTagsStmt(env.DB));
      }
      await env.DB.batch(stmts);
    }
    return json({ ok: true, count: existing.length });
  }

  // 批量 publish/draft：每篇 1 条语句，按 100 篇一批（不跨批事务，部分成功可重试）
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const stmts: D1PreparedStatement[] = [];
    for (const id of chunk) {
      stmts.push(
        env.DB
          .prepare(`UPDATE posts SET status = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(action === 'publish' ? 'published' : 'draft', id),
      );
    }
    await env.DB.batch(stmts);
  }

  return json({ ok: true, count: ids.length });
}