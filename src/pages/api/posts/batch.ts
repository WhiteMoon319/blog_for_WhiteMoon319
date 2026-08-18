import type { APIContext } from 'astro';
import {
  envOf,
  createPost,
  getCollectionById,
  getCollectionsByIds,
  trashPosts,
  restorePosts,
  purgePosts,
  isSlugConflict,
  type PostRow,
} from '../../../lib/db';
import { slugBase, slugWithSuffix } from '../../../lib/utils';
import {
  parseIds,
  parseCreateItem,
  BATCH_MAX_CREATE,
  type BatchCreateItem,
} from '../../../lib/api/validate';
import { json, requireAuth } from '../../../lib/auth';

export const prerender = false;

type Action = 'publish' | 'draft' | 'delete' | 'trash' | 'restore' | 'purge' | 'move' | 'create';

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
    action !== 'trash' &&
    action !== 'restore' &&
    action !== 'purge' &&
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
      // 自动 slug：截断到 63 且不以连字符结尾（slugBase），冲突后缀同样受 SLUG_MAX 约束
      const base = item.slug || slugBase(item.title) || `post-${Date.now().toString(36)}`;
      let created: Awaited<ReturnType<typeof createPost>> = null;
      let lastError = 'slug already exists';
      for (let attempt = 0; attempt < 20; attempt++) {
        const slug = attempt === 0 ? base : slugWithSuffix(base, attempt + 1);
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

    const placeholders = ids.map(() => '?').join(', ');
    const rows = await env.DB
      .prepare(`SELECT id, slug, collection_id FROM posts WHERE id IN (${placeholders}) AND deleted_at IS NULL`)
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

  // 刊发/撤稿/删除（软删除）/回收站：单请求 id ≤50，整批放进一个 D1 事务（≤100 语句），全成功或全失败。
  // 状态变更同时写入 post_versions（message 标明批量操作），开放中的旧编辑器将收到 409。
  // 计数用预检结果而非 meta.changes：D1 batch 内 changes 是会话累计值，无法按语句取增量。
  if (action === 'delete' || action === 'trash') {
    const count = await trashPosts(env.DB, ids);
    return json({ ok: true, count });
  }
  if (action === 'restore') {
    const count = await restorePosts(env.DB, ids);
    return json({ ok: true, count });
  }
  if (action === 'purge') {
    const count = await purgePosts(env.DB, ids);
    return json({ ok: true, count });
  }

  // publish / draft：仅对实际状态不同且未删除的文章留档（已刊发的重复刊发不产生版本；回收站文章不参与）
  const status = action === 'publish' ? 'published' : 'draft';
  const preflight = await env.DB
    .prepare(`SELECT id FROM posts WHERE id IN (${ids.map(() => '?').join(',')}) AND status <> ? AND deleted_at IS NULL`)
    .bind(...ids, status)
    .all<{ id: number }>();
  const changed = (preflight.results ?? []).map((r) => r.id);
  if (changed.length === 0) return json({ ok: true, count: 0 });
  const message = action === 'publish' ? '批量刊发' : '批量撤稿';
  const stmts: D1PreparedStatement[] = [];
  for (const id of changed) {
    // 版本 INSERT 先于 UPDATE：`status <> ?` 守卫读到的是旧状态（与预检一致），
    // 并发重复刊发/并发删除时守卫落空，不会产生多余版本；
    // 版本内容用显式的新 status（此时 posts.status 仍是旧值）。
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, message)
           SELECT ?, COALESCE((SELECT MAX(version) FROM post_versions WHERE post_id = ?), 0) + 1,
                  title, slug, collection_id, summary, content_md, cover_url, ?, ?
           FROM posts WHERE id = ? AND status <> ?`,
        )
        .bind(id, id, status, message, id, status),
    );
    stmts.push(
      env.DB
        .prepare(`UPDATE posts SET status = ?, updated_at = datetime('now') WHERE id = ? AND status <> ?`)
        .bind(status, id, status),
    );
  }
  await env.DB.batch(stmts);
  return json({ ok: true, count: changed.length });
}