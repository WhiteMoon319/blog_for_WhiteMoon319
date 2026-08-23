// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { D1Database } from '@cloudflare/workers-types';

export interface PageRow {
  id: number;
  slug: string;
  title: string;
  content_md: string;
  published: number;
  created_at: string;
  updated_at: string;
}

export interface PageInput {
  slug: string;
  title: string;
  content_md?: string;
  published?: number;
}

const SLUG_MAX_LENGTH = 120;
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'login', 'logout', 'feed', 'rss', 'atom', 'sitemap',
  'search', 'tags', 'archive', 'collections', 'media', 'export', 'upload',
  'pages', 'me', 'index', 'robots',
]);

function slugError(slug: string): string | null {
  if (!slug || slug.length > SLUG_MAX_LENGTH) return `slug 长度应在 1–${SLUG_MAX_LENGTH} 之间`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return 'slug 仅允许小写字母、数字和连字符';
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" 已被系统保留`;
  return null;
}

export function validatePageSlug(slug: string): { ok: true } | { ok: false; error: string } {
  const e = slugError(slug);
  return e ? { ok: false, error: e } : { ok: true };
}

// 与文章、文集 slug 的跨表冲突校验（路由层面 `/posts/{slug}`、`/collections/{slug}` 与 `/pages/{slug}` 并存）
export async function pageSlugConflicts(db: D1Database, slug: string): Promise<string | null> {
  const post = await db
    .prepare("SELECT slug FROM posts WHERE slug = ? AND deleted_at IS NULL LIMIT 1")
    .bind(slug)
    .first<{ slug: string }>();
  if (post) return `slug "${slug}" 已被文章占用`;
  const collection = await db
    .prepare('SELECT slug FROM collections WHERE slug = ? LIMIT 1')
    .bind(slug)
    .first<{ slug: string }>();
  if (collection) return `slug "${slug}" 已被文集占用`;
  return null;
}

export async function listPages(db: D1Database, includeUnpublished = false): Promise<PageRow[]> {
  let sql = 'SELECT * FROM pages';
  if (!includeUnpublished) sql += ' WHERE published = 1';
  sql += ' ORDER BY created_at DESC';
  const result = await db.prepare(sql).all<PageRow>();
  return result.results ?? [];
}

export async function getPageById(db: D1Database, id: number): Promise<PageRow | null> {
  return db.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first();
}

export async function getPageBySlug(db: D1Database, slug: string): Promise<PageRow | null> {
  return db.prepare('SELECT * FROM pages WHERE slug = ?').bind(slug).first();
}

export async function createPage(db: D1Database, data: PageInput): Promise<PageRow> {
  const val = slugError(data.slug);
  if (val) throw new Error(val);
  const existing = await getPageBySlug(db, data.slug);
  if (existing) throw new Error(`slug "${data.slug}" 已存在`);
  const result = await db
    .prepare(
      `INSERT INTO pages (slug, title, content_md, published) VALUES (?, ?, ?, ?)`,
    )
    .bind(data.slug, data.title, data.content_md ?? '', data.published ?? 0)
    .run();
  const row = await getPageById(db, result.meta.last_row_id as unknown as number);
  if (!row) throw new Error('page create failed');
  return row;
}

export async function updatePage(
  db: D1Database,
  id: number,
  data: Partial<PageInput>,
): Promise<PageRow | null> {
  const current = await getPageById(db, id);
  if (!current) return null;
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (data.title !== undefined) { sets.push('title = ?'); values.push(data.title); }
  if (data.content_md !== undefined) { sets.push('content_md = ?'); values.push(data.content_md); }
  if (data.published !== undefined) { sets.push('published = ?'); values.push(data.published); }
  if (data.slug !== undefined && data.slug !== current.slug) {
    const val = slugError(data.slug);
    if (val) throw new Error(val);
    const conflict = await getPageBySlug(db, data.slug);
    if (conflict && conflict.id !== id) throw new Error(`slug "${data.slug}" 已存在`);
    sets.push('slug = ?');
    values.push(data.slug);
  }
  if (sets.length === 0) return current;
  sets.push("updated_at = datetime('now')");
  await db
    .prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, id)
    .run();
  return getPageById(db, id);
}

export async function deletePage(db: D1Database, id: number): Promise<boolean> {
  const current = await getPageById(db, id);
  if (!current) return false;
  await db.prepare('DELETE FROM pages WHERE id = ?').bind(id).run();
  return true;
}