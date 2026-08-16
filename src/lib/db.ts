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

export async function listPublishedPosts(
  db: D1Database,
  opts: { collectionId?: number | null; limit?: number; offset?: number } = {},
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
  sql += ` ORDER BY created_at DESC`;
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

export async function searchPublishedPosts(
  db: D1Database,
  q: string,
  limit = 50,
): Promise<PostRow[]> {
  return db
    .prepare(
      `SELECT * FROM posts
       WHERE status = 'published' AND (title LIKE ? OR summary LIKE ? OR content_md LIKE ?)
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(`%${q}%`, `%${q}%`, `%${q}%`, limit)
    .all<PostRow>()
    .then((r) => r.results ?? []);
}

export async function incrementViewCount(db: D1Database, id: number): Promise<number> {
  await db
    .prepare(`UPDATE posts SET view_count = view_count + 1 WHERE id = ?`)
    .bind(id)
    .run();
  const row = await db
    .prepare(`SELECT view_count FROM posts WHERE id = ?`)
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
  const base = `SELECT p.*, c.slug AS collection_slug FROM posts p LEFT JOIN collections c ON c.id = p.collection_id WHERE p.status = 'published'`;
  const prev = await db
    .prepare(`${base} AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?)) ORDER BY p.created_at DESC, p.id DESC LIMIT 1`)
    .bind(post.created_at, post.created_at, post.id)
    .first<PostWithCollection>();
  const next = await db
    .prepare(`${base} AND (p.created_at > ? OR (p.created_at = ? AND p.id > ?)) ORDER BY p.created_at ASC, p.id ASC LIMIT 1`)
    .bind(post.created_at, post.created_at, post.id)
    .first<PostWithCollection>();
  return { prev, next };
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
  },
): Promise<CollectionRow | null> {
  const res = await db
    .prepare(
      `INSERT INTO collections (title, slug, summary, theme_color, sort_order)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      data.title,
      data.slug,
      data.summary ?? '',
      data.theme_color ?? '#c23a30',
      data.sort_order ?? 0,
    )
    .first<CollectionRow>();
  return res ?? null;
}

const COLLECTION_FIELDS = ['title', 'slug', 'summary', 'theme_color', 'sort_order'] as const;
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
  await db.prepare(`UPDATE posts SET collection_id = NULL WHERE collection_id = ?`).bind(id).run();
  const res = await db.prepare(`DELETE FROM collections WHERE id = ?`).bind(id).run();
  return (res.meta.changes ?? 0) > 0;
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
  const res = await db
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
    )
    .first<PostRow>();
  return res ?? null;
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

export async function updatePost(db: D1Database, id: number, patch: PostPatch): Promise<PostRow | null> {
  const keys = Object.keys(patch).filter((k) => POST_FIELDS.includes(k as (typeof POST_FIELDS)[number]));
  if (keys.length === 0) return getPostById(db, id);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => patch[k as keyof PostPatch]);
  const res = await db
    .prepare(`UPDATE posts SET ${sets}, updated_at = datetime('now') WHERE id = ? RETURNING *`)
    .bind(...values, id)
    .first<PostRow>();
  return res ?? null;
}

export async function deletePost(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM posts WHERE id = ?`).bind(id).run();
  return (res.meta.changes ?? 0) > 0;
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
    sql += ' OFFSET ?';
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