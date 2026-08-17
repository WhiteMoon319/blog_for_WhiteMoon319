type EnvResolver = () => Promise<Env>;
let resolveEnv: EnvResolver = async () => (await import('cloudflare:workers')).env;

export function __setEnvResolver(fn: EnvResolver): void {
  resolveEnv = fn;
}

export async function envOf(): Promise<Env> {
  return resolveEnv();
}

export interface CollectionRow {
  id: number;
  title: string;
  slug: string;
  summary: string;
  theme_color: string;
  sort_order: number;
  post_order: 'asc' | 'desc';
  created_at: string;
  updated_at: string;
}

export interface PostRow {
  id: number;
  collection_id: number | null;
  title: string;
  slug: string;
  summary: string;
  content_md: string;
  cover_url: string;
  status: 'draft' | 'published';
  view_count: number;
  created_at: string;
  updated_at: string;
}

export async function listCollections(db: D1Database): Promise<CollectionRow[]> {
  return db
    .prepare(
      `SELECT * FROM collections
       ORDER BY sort_order ASC, id ASC`,
    )
    .all<CollectionRow>()
    .then((r) => r.results ?? []);
}

export async function getCollectionBySlug(db: D1Database, slug: string): Promise<CollectionRow | null> {
  return db.prepare('SELECT * FROM collections WHERE slug = ?').bind(slug).first<CollectionRow>();
}

export async function getCollectionById(db: D1Database, id: number): Promise<CollectionRow | null> {
  return db.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first<CollectionRow>();
}

export async function getCollectionsByIds(db: D1Database, ids: number[]): Promise<Map<number, CollectionRow>> {
  const unique = [...new Set(ids.filter((x): x is number => Number.isInteger(x) && x > 0))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .prepare(`SELECT * FROM collections WHERE id IN (${unique.map(() => '?').join(',')})`)
    .bind(...unique)
    .all<CollectionRow>();
  return new Map((rows.results ?? []).map((r) => [r.id, r]));
}

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

function escapeFtsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

export async function searchPublishedPosts(
  db: D1Database,
  q: string,
  limit = 50,
): Promise<PostRow[]> {
  const query = q.trim();
  if (!query) return [];
  // FTS5（trigram 分词）索引命中；仅支持 ≥3 字符的短语，短词回退 LIKE
  if (query.length >= 3) {
    const rows = await db
      .prepare(
        `SELECT p.* FROM posts_fts JOIN posts p ON p.id = posts_fts.rowid
         WHERE posts_fts MATCH ? AND p.status = 'published'
         ORDER BY bm25(posts_fts, 5, 2, 1), p.created_at DESC LIMIT ?`,
      )
      .bind(escapeFtsPhrase(query), limit)
      .all<PostRow>()
      .catch(() => null);
    if (rows && (rows.results ?? []).length > 0) return rows.results ?? [];
  }
  return db
    .prepare(
      `SELECT * FROM posts
       WHERE status = 'published' AND (title LIKE ? OR summary LIKE ? OR content_md LIKE ?)
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(`%${query}%`, `%${query}%`, `%${query}%`, limit)
    .all<PostRow>()
    .then((r) => r.results ?? []);
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

export type PostWithCollection = PostRow & { collection_slug: string | null };

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

/* ===== 文集 CRUD ===== */

export async function createCollection(
  db: D1Database,
  data: {
    title: string;
    slug: string;
    summary?: string;
    theme_color?: string;
    sort_order?: number;
    post_order?: 'asc' | 'desc';
  },
): Promise<CollectionRow | null> {
  const res = await db
    .prepare(
      `INSERT INTO collections (title, slug, summary, theme_color, sort_order, post_order)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      data.title,
      data.slug,
      data.summary ?? '',
      data.theme_color ?? '#c23a30',
      data.sort_order ?? 0,
      data.post_order ?? 'desc',
    )
    .first<CollectionRow>();
  return res ?? null;
}

const COLLECTION_FIELDS = ['title', 'slug', 'summary', 'theme_color', 'sort_order', 'post_order'] as const;
export type CollectionPatch = Partial<Record<(typeof COLLECTION_FIELDS)[number], string | number>>;

export async function updateCollection(db: D1Database, id: number, patch: CollectionPatch): Promise<CollectionRow | null> {
  const keys = Object.keys(patch).filter((k) =>
    COLLECTION_FIELDS.includes(k as (typeof COLLECTION_FIELDS)[number]),
  );
  if (keys.length === 0) return getCollectionById(db, id);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => patch[k as keyof CollectionPatch]);
  const res = await db
    .prepare(`UPDATE collections SET ${sets}, updated_at = datetime('now') WHERE id = ? RETURNING *`)
    .bind(...values, id)
    .first<CollectionRow>();
  return res ?? null;
}

export async function deleteCollection(db: D1Database, id: number): Promise<boolean> {
  const members = await db
    .prepare('SELECT id, slug FROM posts WHERE collection_id = ? ORDER BY created_at DESC, id DESC')
    .bind(id)
    .all<{ id: number; slug: string }>();
  const rows = members.results ?? [];

  const stmts: D1PreparedStatement[] = [];
  if (rows.length > 0) {
    const taken = new Set(
      (await db.prepare('SELECT slug FROM posts WHERE collection_id IS NULL').all<{ slug: string }>()).results?.map(
        (r) => r.slug,
      ) ?? [],
    );
    // 转未分类后 slug 必须保持全局唯一：按 (created_at DESC, id DESC) 依次分配最小空闲后缀，
    // 与 URL 解析的「保留最新一篇」规则一致，冲突行获得 slug-2/slug-3…。
    const assigned = new Map<number, string>();
    for (const row of rows) {
      let candidate = row.slug;
      let n = 2;
      while (taken.has(candidate)) {
        candidate = `${row.slug}-${n}`;
        n++;
      }
      taken.add(candidate);
      assigned.set(row.id, candidate);
    }
    for (const row of rows) {
      stmts.push(
        db
          .prepare(`UPDATE posts SET collection_id = NULL, slug = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(assigned.get(row.id)!, row.id),
      );
    }
  } else {
    stmts.push(db.prepare('UPDATE posts SET collection_id = NULL WHERE collection_id = ?').bind(id));
  }
  stmts.push(db.prepare('DELETE FROM collections WHERE id = ?').bind(id));
  const results = await db.batch(stmts);
  const last = results[results.length - 1];
  return (last.meta.changes ?? 0) > 0;
}

/* ===== 文章 CRUD ===== */

export interface PostInput {
  title: string;
  slug: string;
  collection_id?: number | null;
  summary?: string;
  content_md?: string;
  cover_url?: string;
  status?: 'draft' | 'published';
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

const POST_FIELDS = [
  'title',
  'slug',
  'collection_id',
  'summary',
  'content_md',
  'cover_url',
  'status',
] as const;
export type PostPatch = Partial<Record<(typeof POST_FIELDS)[number], string | number | null>>;

export async function updatePost(
    db: D1Database,
    id: number,
    patch: PostPatch,
    versionMessage?: string,
  ): Promise<PostRow | null> {
    const current = await getPostById(db, id);
    if (!current) return null;
    const keys = Object.keys(patch).filter((k) => POST_FIELDS.includes(k as (typeof POST_FIELDS)[number]));
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
    const results = await db.batch([
      db
        .prepare(`UPDATE posts SET ${sets}, updated_at = datetime('now') WHERE id = ? RETURNING *`)
        .bind(...values, id),
      db
        .prepare(
          `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, message)
           SELECT ?, COALESCE((SELECT MAX(version) FROM post_versions WHERE post_id = ?), 0) + 1,
                  title, slug, collection_id, summary, content_md, cover_url, status, ?
           FROM posts WHERE id = ?`,
        )
        .bind(id, id, versionMessage ?? '自动保存', id),
    ]);
    return results[0].results?.[0] as PostRow | undefined ?? null;
  }

export async function deletePost(db: D1Database, id: number): Promise<boolean> {
    const res = await db.prepare(`DELETE FROM posts WHERE id = ?`).bind(id).run();
    return (res.meta.changes ?? 0) > 0;
  }

  /* ===== 版本历史 ===== */

  export interface PostVersionRow {
    id: number;
    post_id: number;
    version: number;
    title: string;
    slug: string;
    collection_id: number | null;
    summary: string;
    content_md: string;
    cover_url: string;
    status: 'draft' | 'published';
    message: string;
    created_at: string;
  }

  export async function listPostVersions(
    db: D1Database,
    postId: number,
    limit = 100,
  ): Promise<PostVersionRow[]> {
    return db
      .prepare(`SELECT * FROM post_versions WHERE post_id = ? ORDER BY version DESC LIMIT ?`)
      .bind(postId, limit)
      .all<PostVersionRow>()
      .then((r) => r.results ?? []);
  }

  export async function getPostVersion(
    db: D1Database,
    postId: number,
    version: number,
  ): Promise<PostVersionRow | null> {
    return db
      .prepare(`SELECT * FROM post_versions WHERE post_id = ? AND version = ?`)
      .bind(postId, version)
      .first<PostVersionRow>();
  }

export async function getPostById(db: D1Database, id: number): Promise<PostRow | null> {
  return db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>();
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

export function isSlugConflict(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const msg = String((e as { message?: unknown }).message ?? '');
  return msg.includes('UNIQUE constraint failed');
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}年${m}月${day}日`;
}

export function yearOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : String(d.getFullYear());
}