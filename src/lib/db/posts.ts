import type { PostInput, PostPatch, PostRow, PostWithCollection } from './types.ts';
import { purgeOrphanTagsStmt } from './tags.ts';

export async function listPublishedPosts(
  db: D1Database,
  opts: { collectionId?: number | null; limit?: number; offset?: number; order?: 'asc' | 'desc' } = {},
): Promise<PostRow[]> {
  let sql = `SELECT * FROM posts WHERE status = 'published'`;
  const args: (number | string | null)[] = [];
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
  let sql = `SELECT COUNT(*) AS n FROM posts WHERE status = 'published'`;
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
      `SELECT * FROM posts WHERE slug = ? AND status = 'published' AND collection_id IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(slug)
    .first<PostRow>();
}

export async function getPublishedPostInCollection(
  db: D1Database,
  collectionId: number,
  slug: string,
): Promise<PostRow | null> {
  return db
    .prepare(`SELECT * FROM posts WHERE collection_id = ? AND slug = ? AND status = 'published'`)
    .bind(collectionId, slug)
    .first<PostRow>();
}

export async function listPosts(
  db: D1Database,
  opts: { collectionId?: number; status?: 'draft' | 'published' | 'all'; limit?: number; offset?: number } = {},
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
  return db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>();
}

export async function createPost(db: D1Database, data: PostInput): Promise<PostRow | null> {
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO posts (collection_id, title, slug, summary, content_md, cover_url, status)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(
        data.collection_id ?? null,
        data.title,
        data.slug,
        data.summary ?? '',
        data.content_md ?? '',
        data.cover_url ?? '',
        data.status ?? 'draft',
      ),
    db
      .prepare(
        `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, message)
         SELECT id, 1, title, slug, collection_id, summary, content_md, cover_url, status, '创建'
         FROM posts WHERE id = last_insert_rowid()`,
      ),
  ]);
  return results[0].results?.[0] as PostRow | undefined ?? null;
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
  const keys = Object.keys(patch).filter((k) =>
    ['title', 'slug', 'collection_id', 'summary', 'content_md', 'cover_url', 'status'].includes(k),
  );
  if (keys.length === 0) return current;
  const changed = keys.filter((k) => {
    const pv = patch[k as keyof PostPatch];
    const cv = current[k as keyof PostRow];
    return String(pv ?? null) !== String(cv ?? null);
  });
  if (changed.length === 0) return current;
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
        `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, message)
         SELECT ?, ${baseVersion !== undefined ? '?' : `COALESCE((SELECT MAX(version) FROM post_versions WHERE post_id = ?), 0) + 1`},
                title, slug, collection_id, summary, content_md, cover_url, status, ?
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

export async function deletePost(db: D1Database, id: number): Promise<boolean> {
  const results = await db.batch([
    db.prepare('DELETE FROM posts WHERE id = ?').bind(id),
    purgeOrphanTagsStmt(db),
  ]);
  return (results[0].meta.changes ?? 0) > 0;
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
  let sql = `SELECT * FROM posts WHERE status = 'published' ORDER BY created_at ASC`;
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
    .prepare(`SELECT COUNT(*) AS n FROM posts WHERE status = 'published'`)
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
         WHERE p.status = 'published'
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
  const byId = new Map((rows.results ?? []).map((r) => [r.id, r]));
  return { prev: prevId ? byId.get(prevId) ?? null : null, next: nextId ? byId.get(nextId) ?? null : null };
}