import type { PostInput, PostPatch, PostRow, PostWithCollection, TagRow } from './types.ts';
import {
  ensureTagsStmts,
  purgeOrphanTagsStmt,
  setPostOwnTagsStmts,
  listPostOwnTags,
} from './tags.ts';
import { getLatestPostVersion } from './versions.ts';
import { isValidSlug } from '../utils.ts';

export async function listPublishedPosts(
  db: D1Database,
  opts: { collectionId?: number | null; limit?: number; offset?: number; order?: 'asc' | 'desc'; pinned?: boolean } = {},
): Promise<PostRow[]> {
  let sql = `SELECT * FROM posts WHERE status = 'published' AND deleted_at IS NULL`;
  const args: (number | string | null)[] = [];
  if (opts.pinned) sql += ` AND is_pinned = 1`;
  if (opts.collectionId !== undefined) {
    if (opts.collectionId === null) {
      sql += ` AND collection_id IS NULL`;
    } else {
      sql += ` AND collection_id = ?`;
      args.push(opts.collectionId);
    }
  }
  sql += opts.order === 'asc' ? ` ORDER BY created_at ASC, id ASC` : ` ORDER BY created_at DESC, id DESC`;
  if (opts.limit) {
    sql += ` LIMIT ?`;
    args.push(opts.limit);
    if (opts.offset) {
      sql += ` OFFSET ?`;
      args.push(opts.offset);
    }
  }
  return db.prepare(sql).bind(...args).all<PostRow>().then((r) => r.results ?? []);
}

export async function countPublishedPosts(
  db: D1Database,
  opts: { collectionId?: number | null } = {},
): Promise<number> {
  let sql = `SELECT COUNT(*) AS n FROM posts WHERE status = 'published' AND deleted_at IS NULL`;
  const args: (number | null)[] = [];
  if (opts.collectionId !== undefined) {
    if (opts.collectionId === null) {
      sql += ` AND collection_id IS NULL`;
    } else {
      sql += ` AND collection_id = ?`;
      args.push(opts.collectionId);
    }
  }
  const row = await db.prepare(sql).bind(...args).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getPublishedPostBySlug(db: D1Database, slug: string): Promise<PostRow | null> {
  return db
    .prepare(
      `SELECT * FROM posts WHERE slug = ? AND status = 'published' AND deleted_at IS NULL AND collection_id IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(slug)
    .first<PostRow>();
}

// 跨文集查已刊同名文章：用于旧路径 /posts/{slug}/ 的 301 转正（未分类优先，已收录则跳文集路径）
export async function getPublishedPostBySlugAny(db: D1Database, slug: string): Promise<PostRow | null> {
  return db
    .prepare(`SELECT * FROM posts WHERE slug = ? AND status = 'published' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`)
    .bind(slug)
    .first<PostRow>();
}

export async function getPublishedPostInCollection(
  db: D1Database,
  collectionId: number,
  slug: string,
): Promise<PostRow | null> {
  return db
    .prepare(`SELECT * FROM posts WHERE collection_id = ? AND slug = ? AND status = 'published' AND deleted_at IS NULL`)
    .bind(collectionId, slug)
    .first<PostRow>();
}

export async function listPosts(
  db: D1Database,
  opts: { collectionId?: number; status?: 'draft' | 'published' | 'all'; limit?: number; offset?: number; trashOnly?: boolean } = {},
): Promise<PostRow[]> {
  const where: string[] = [];
  const args: (number | string)[] = [];
  if (opts.collectionId !== undefined) {
    where.push('collection_id = ?');
    args.push(opts.collectionId);
  }
  if (opts.status && opts.status !== 'all') {
    where.push('status = ?');
    args.push(opts.status);
  }
  // 回收站是显式管理视图：status=all 绝不携带已删内容；只有 trashOnly 才查已删
  where.push(opts.trashOnly ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL');
  let sql = 'SELECT * FROM posts';
  if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY created_at DESC';
  if (opts.limit) {
    sql += ' LIMIT ?';
    args.push(opts.limit);
  }
  if (opts.offset) {
    // SQLite 不允许无 LIMIT 的 OFFSET：无 limit 时用 LIMIT -1（表示不限条数）
    sql += opts.limit ? ' OFFSET ?' : ' LIMIT -1 OFFSET ?';
    args.push(opts.offset);
  }
  return db.prepare(sql).bind(...args).all<PostRow>().then((r) => r.results ?? []);
}

export async function getPostById(db: D1Database, id: number): Promise<PostRow | null> {
  // 已删除（回收站）文章对一切业务路径不可见：编辑、预览、公开 GET 全部 404；
  // 回收站的查看/恢复/彻底删除走专门的管理查询。
  return db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').bind(id).first<PostRow>();
}

export async function createPost(db: D1Database, data: PostInput): Promise<PostRow | null> {
  // 内部兜底：自动生成的 slug 也必须通过校验，非法长度直接拒绝（而非写坏数据）
  if (!isValidSlug(data.slug)) throw new Error(`invalid slug: ${data.slug}`);
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO posts (collection_id, title, slug, summary, content_md, cover_url, status, meta_keywords, is_pinned, scheduled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        data.collection_id ?? null,
        data.title,
        data.slug,
        data.summary ?? '',
        data.content_md ?? '',
        data.cover_url ?? '',
        data.status ?? 'draft',
        data.meta_keywords ?? '',
        data.is_pinned ?? 0,
        data.scheduled_at ?? null,
      ),
    db.prepare('SELECT * FROM posts WHERE id = last_insert_rowid()'),
    db
      .prepare(
        `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, message)
         SELECT id, 1, title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, '创建'
         FROM posts WHERE id = last_insert_rowid()`,
      ),
  ]);
  return results[1].results?.[0] as PostRow | undefined ?? null;
}

// 创建 + 打标签原子写：主体、初始版本、标签 ensure/关联、孤儿清理放进同一个 D1 batch。
// 任一语句失败（如 slug 冲突）整批回滚，标签不会半途落库。
export async function createPostWithTags(
  db: D1Database,
  data: PostInput,
  tagNames: string[],
): Promise<{ post: PostRow; tags: TagRow[] } | null> {
  if (!isValidSlug(data.slug)) throw new Error(`invalid slug: ${data.slug}`);
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO posts (collection_id, title, slug, summary, content_md, cover_url, status, meta_keywords, is_pinned, scheduled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        data.collection_id ?? null,
        data.title,
        data.slug,
        data.summary ?? '',
        data.content_md ?? '',
        data.cover_url ?? '',
        data.status ?? 'draft',
        data.meta_keywords ?? '',
        data.is_pinned ?? 0,
        data.scheduled_at ?? null,
      ),
    db.prepare('SELECT * FROM posts WHERE id = last_insert_rowid()'),
    db
      .prepare(
        `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, message)
         SELECT id, 1, title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, '创建'
         FROM posts WHERE id = last_insert_rowid()`,
      ),
  ];
  const unique = [...new Set(tagNames.map((n) => n.trim().replace(/\s+/g, ' ')).filter((n) => n.length > 0))];
  if (unique.length > 0) {
    // 新文章尚无 post_tags，无需 DELETE；用 slug+collection 子查询定位（版本 INSERT 已改变 last_insert_rowid）
    stmts.push(...ensureTagsStmts(db, unique));
    for (const name of unique) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO post_tags (post_id, tag_id)
             SELECT p.id, t.id FROM posts p, tags t
             WHERE p.collection_id IS ? AND p.slug = ? AND t.name = ?`,
          )
          .bind(data.collection_id ?? null, data.slug, name),
      );
    }
    stmts.push(purgeOrphanTagsStmt(db));
  }
  const results = await db.batch(stmts);
  const post = results[1].results?.[0] as PostRow | undefined ?? null;
  if (!post) return null;
  return { post, tags: await listPostOwnTags(db, post.id) };
}

export async function updatePost(
  db: D1Database,
  id: number,
  patch: PostPatch,
  versionMessage?: string,
  baseVersion?: number,
): Promise<PostRow | 'conflict' | null> {
  const current = await getPostById(db, id);
  if (!current) return null;
  // 手动刊发：scheduled_at 仅在草稿时有意义，强制清空定时值
  if (patch.status === 'published' && !('scheduled_at' in patch)) {
    patch.scheduled_at = null;
  }
  const keys = Object.keys(patch).filter((k) =>
    ['title', 'slug', 'collection_id', 'summary', 'content_md', 'cover_url', 'status', 'meta_keywords', 'is_pinned', 'scheduled_at'].includes(k),
  );
  if (keys.length === 0) return current;
  const changed = keys.filter((k) => {
    const pv = patch[k as keyof PostPatch];
    const cv = current[k as keyof PostRow];
    return String(pv ?? null) !== String(cv ?? null);
  });
  if (changed.length === 0) {
    // 无实质变化时仍需校验乐观锁基线，避免掩盖另一端的并发写入
    if (baseVersion !== undefined && (await getLatestPostVersion(db, id)) !== baseVersion) return 'conflict';
    return current;
  }
  const sets = changed.map((k) => `${k} = ?`).join(', ');
  const values = changed.map((k) => patch[k as keyof PostPatch]);
  // 文章更新与版本留档放入同一个 D1 事务（batch 原子执行）：
  // 版本写入失败时文章更新一并回滚；版本号由同一事务内 MAX(version)+1 计算，写事务串行化保证不冲突。
  // baseVersion 提供时做乐观锁：当前版本不匹配则整批不生效并返回 'conflict'。
  const versionMatch =
    baseVersion !== undefined
      ? `AND (SELECT COALESCE(MAX(version), 0) FROM post_versions WHERE post_id = ?) = ?`
      : '';
  const versionArgs = baseVersion !== undefined ? [id, baseVersion] : [];
  const results = await db.batch([
    db
      .prepare(`UPDATE posts SET ${sets}, updated_at = datetime('now') WHERE id = ? ${versionMatch} RETURNING *`)
      .bind(...values, id, ...versionArgs),
    db
      .prepare(
        `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, message)
         SELECT ?, ${baseVersion !== undefined ? '?' : `COALESCE((SELECT MAX(version) FROM post_versions WHERE post_id = ?), 0) + 1`},
                title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, ?
         FROM posts WHERE id = ? ${versionMatch}`,
      )
      .bind(
        id,
        ...(baseVersion !== undefined ? [baseVersion + 1, versionMessage ?? '自动保存'] : [id, versionMessage ?? '自动保存']),
        id,
        ...versionArgs,
      ),
  ]);
  const row = results[0].results?.[0] as PostRow | undefined;
  if (!row) return baseVersion !== undefined ? 'conflict' : null;
  return row;
}

// 更新 + 打标签原子写：正文变更、版本留档、标签替换、孤儿清理在同一 batch。
// tagNames 为 null 表示请求未携带 tags（不动标签）；携带则严格替换。
export async function updatePostWithTags(
  db: D1Database,
  id: number,
  patch: PostPatch,
  tagNames: string[] | null,
  versionMessage?: string,
  baseVersion?: number,
): Promise<{ post: PostRow; tags: TagRow[] } | 'conflict' | null> {
  const current = await getPostById(db, id);
  if (!current) return null;
  // 手动刊发：scheduled_at 仅在草稿时有意义，强制清空定时值
  if (patch.status === 'published' && !('scheduled_at' in patch)) {
    patch.scheduled_at = null;
  }
  const keys = Object.keys(patch).filter((k) =>
    ['title', 'slug', 'collection_id', 'summary', 'content_md', 'cover_url', 'status', 'meta_keywords', 'is_pinned', 'scheduled_at'].includes(k),
  );
  const changed = keys.filter((k) => {
    const pv = patch[k as keyof PostPatch];
    const cv = current[k as keyof PostRow];
    return String(pv ?? null) !== String(cv ?? null);
  });
  const tagsOnly = changed.length === 0;
  if (tagsOnly) {
    // 无实质变更仍需校验乐观锁基线；仅换标签不产生版本记录（版本史记录的是内容）
    if (baseVersion !== undefined && (await getLatestPostVersion(db, id)) !== baseVersion) return 'conflict';
    if (tagNames === null) return { post: current, tags: await listPostOwnTags(db, id) };
    await db.batch(setPostOwnTagsStmts(db, id, tagNames));
    return { post: current, tags: await listPostOwnTags(db, id) };
  }
  const sets = changed.map((k) => `${k} = ?`).join(', ');
  const values = changed.map((k) => patch[k as keyof PostPatch]);
  const versionMatch =
    baseVersion !== undefined
      ? `AND (SELECT COALESCE(MAX(version), 0) FROM post_versions WHERE post_id = ?) = ?`
      : '';
  const versionArgs = baseVersion !== undefined ? [id, baseVersion] : [];
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE posts SET ${sets}, updated_at = datetime('now') WHERE id = ? ${versionMatch} RETURNING *`)
      .bind(...values, id, ...versionArgs),
    db
      .prepare(
        `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, message)
         SELECT ?, ${baseVersion !== undefined ? '?' : `COALESCE((SELECT MAX(version) FROM post_versions WHERE post_id = ?), 0) + 1`},
                title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, ?
         FROM posts WHERE id = ? ${versionMatch}`,
      )
      .bind(
        id,
        ...(baseVersion !== undefined ? [baseVersion + 1, versionMessage ?? '自动保存'] : [id, versionMessage ?? '自动保存']),
        id,
        ...versionArgs,
      ),
  ];
  if (tagNames !== null) stmts.push(...setPostOwnTagsStmts(db, id, tagNames));
  const results = await db.batch(stmts);
  const row = results[0].results?.[0] as PostRow | undefined;
  if (!row) return baseVersion !== undefined ? 'conflict' : null;
  return { post: row, tags: await listPostOwnTags(db, id) };
}

export async function deletePost(db: D1Database, id: number): Promise<boolean> {
  // 先单独删文章行：solo 的 meta.changes 可靠（batch 内为会话累计值，无法判断是否命中）
  const del = await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  await purgeOrphanTagsStmt(db).run();
  return (del.meta.changes ?? 0) > 0;
}

// ---- 回收站（软删除）：trash/restore 每篇 2 语句（版本 + 更新），50 篇 = 100 恰好落在 D1 batch 上限内 ----

const TRASH_VERSION_SQL = `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, message)
SELECT ?, COALESCE((SELECT MAX(version) FROM post_versions WHERE post_id = ?), 0) + 1,
       title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, ?
FROM posts WHERE id = ?`;

function trashVersionStmt(db: D1Database, id: number, message: string, guard: string): D1PreparedStatement {
  // 版本 INSERT 先于 UPDATE：guard（deleted_at 旧状态）读到的是变更前状态；
  // 并发重复执行时 guard 落空，不会重复留档。
  return db.prepare(`${TRASH_VERSION_SQL} ${guard}`).bind(id, id, message, id);
}

// trash（fromTrashed=false）/restore（fromTrashed=true）共用：预检计数 + 每篇 [版本留档, 状态更新]。
// 回收期间文章 slug 仍占据唯一索引位（UNIQUE(collection_id, slug) 不受 deleted_at 影响），
// 恢复不会发生 slug 冲突，无需重命名。
async function trashStateStmts(
  db: D1Database,
  ids: number[],
  fromTrashed: boolean,
): Promise<{ stmts: D1PreparedStatement[]; count: number }> {
  const sql =
    fromTrashed
      ? `SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`
      : `SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`;
  const pre = await db.prepare(sql).bind(...ids).first<{ n: number }>();
  const stmts: D1PreparedStatement[] = [];
  const count = pre?.n ?? 0;
  if (count > 0) {
    const guard = fromTrashed ? 'AND deleted_at IS NOT NULL' : 'AND deleted_at IS NULL';
    const message = fromTrashed ? '恢复' : '移入回收站';
    const setSql = fromTrashed ? 'deleted_at = NULL' : `deleted_at = datetime('now')`;
    for (const id of ids) {
      stmts.push(trashVersionStmt(db, id, message, guard));
      stmts.push(
        db.prepare(`UPDATE posts SET ${setSql}, updated_at = datetime('now') WHERE id = ? ${guard}`).bind(id),
      );
    }
  }
  return { stmts, count };
}

// 移入回收站：保留文章与全部版本；幂等（已删的再次 trash 不计）。
export async function trashPosts(db: D1Database, ids: number[]): Promise<number> {
  const { stmts, count } = await trashStateStmts(db, ids, false);
  if (stmts.length > 0) await db.batch(stmts);
  return count;
}

// 恢复：清除 deleted_at，文章回到原状态（含回收期间保持的 slug 与阅读量）。
export async function restorePosts(db: D1Database, ids: number[]): Promise<number> {
  const { stmts, count } = await trashStateStmts(db, ids, true);
  if (stmts.length > 0) await db.batch(stmts);
  return count;
}

// 彻底删除：仅回收站文章可 purge（防误删）；版本/关联随 CASCADE 一并清除，随后清理孤儿标签。
export async function purgePosts(db: D1Database, ids: number[]): Promise<number> {
  const pre = await db
    .prepare(`SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .first<{ n: number }>();
  const stmts = ids.map((id) =>
    db.prepare('DELETE FROM posts WHERE id = ? AND deleted_at IS NOT NULL').bind(id),
  );
  stmts.push(purgeOrphanTagsStmt(db));
  await db.batch(stmts);
  return pre?.n ?? 0;
}

// 置顶/取消置顶：仅作用于未删除文章，目标状态守卫保证幂等（重复操作计数为 0）。
// 置顶不产生版本记录（版本史记录的是内容快照，置顶属展示性组织信息）。
export async function setPostsPinned(db: D1Database, ids: number[], pinned: boolean): Promise<number> {
  const from = pinned ? 0 : 1;
  const pre = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NULL AND is_pinned = ? AND id IN (${ids.map(() => '?').join(',')})`,
    )
    .bind(from, ...ids)
    .first<{ n: number }>();
  if ((pre?.n ?? 0) > 0) {
    await db
      .prepare(
        `UPDATE posts SET is_pinned = ?, updated_at = datetime('now') WHERE deleted_at IS NULL AND is_pinned = ? AND id IN (${ids.map(() => '?').join(',')})`,
      )
      .bind(pinned ? 1 : 0, from, ...ids)
      .run();
  }
  return pre?.n ?? 0;
}

export async function incrementViewCount(db: D1Database, id: number): Promise<number> {
  const row = await db
    .prepare(`UPDATE posts SET view_count = view_count + 1 WHERE id = ? RETURNING view_count`)
    .bind(id)
    .first<{ view_count: number }>();
  return row?.view_count ?? 0;
}

export async function listArchivedPosts(
  db: D1Database,
  opts: { limit?: number; offset?: number } = {},
): Promise<PostRow[]> {
  let sql = `SELECT * FROM posts WHERE status = 'published' AND deleted_at IS NULL ORDER BY created_at ASC`;
  if (opts.limit) {
    sql += ` LIMIT ?`;
    if (opts.offset) sql += ` OFFSET ?`;
  }
  const args = opts.limit
    ? opts.offset
      ? [opts.limit, opts.offset]
      : [opts.limit]
    : [];
  return db.prepare(sql).bind(...args).all<PostRow>().then((r) => r.results ?? []);
}

export async function countArchivedPosts(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM posts WHERE status = 'published' AND deleted_at IS NULL`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getAdjacentPosts(
  db: D1Database,
  post: PostRow,
): Promise<{ prev: PostWithCollection | null; next: PostWithCollection | null }> {
  // 一条窗口函数查询同时求出同组（collection_id 一致，未分类彼此成组）与全站的相邻 id：
  // LAG/LEAD 在 (created_at, id) 升序上取值，语义与原逐查一致；组内有才用组内值，否则回退全站。
  const window = await db
    .prepare(
      `WITH ranked AS (
         SELECT p.id,
                LAG(p.id) OVER (PARTITION BY p.collection_id ORDER BY p.created_at ASC, p.id ASC) AS in_prev_id,
                LEAD(p.id) OVER (PARTITION BY p.collection_id ORDER BY p.created_at ASC, p.id ASC) AS in_next_id,
                LAG(p.id) OVER (ORDER BY p.created_at ASC, p.id ASC) AS global_prev_id,
                LEAD(p.id) OVER (ORDER BY p.created_at ASC, p.id ASC) AS global_next_id
         FROM posts p
         WHERE p.status = 'published' AND p.deleted_at IS NULL
       )
       SELECT * FROM ranked WHERE id = ?`,
    )
    .bind(post.id)
    .first<{ in_prev_id: number | null; in_next_id: number | null; global_prev_id: number | null; global_next_id: number | null }>();
  if (!window) return { prev: null, next: null };
  const prevId = window.in_prev_id ?? window.global_prev_id;
  const nextId = window.in_next_id ?? window.global_next_id;
  const ids = [...new Set([prevId, nextId].filter((x): x is number => x !== null))];
  if (ids.length === 0) return { prev: null, next: null };
  const rows = await db
    .prepare(
      `SELECT p.*, c.slug AS collection_slug FROM posts p LEFT JOIN collections c ON c.id = p.collection_id WHERE p.id IN (${ids.map(() => '?').join(',')})`,
    )
    .bind(...ids)
    .all<PostWithCollection>();
  const byId = new Map<number, PostWithCollection>((rows.results ?? []).map((r) => [r.id, r]));
  return { prev: prevId ? byId.get(prevId) ?? null : null, next: nextId ? byId.get(nextId) ?? null : null };
}