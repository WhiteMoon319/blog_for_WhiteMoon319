import type { CollectionRow, CollectionPatch } from './types.ts';
import { purgeOrphanTagsStmt } from './tags.ts';

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

export async function updateCollection(db: D1Database, id: number, patch: CollectionPatch): Promise<CollectionRow | null> {
  const keys = Object.keys(patch).filter((k) =>
    ['title', 'slug', 'summary', 'theme_color', 'sort_order', 'post_order'].includes(k),
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
  const delStmt = db.prepare('DELETE FROM collections WHERE id = ?').bind(id);
  stmts.push(delStmt);
  stmts.push(purgeOrphanTagsStmt(db));
  const results = await db.batch(stmts);
  return (results[stmts.indexOf(delStmt)]!.meta.changes ?? 0) > 0;
}