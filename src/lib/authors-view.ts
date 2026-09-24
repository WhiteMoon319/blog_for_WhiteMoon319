// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 前台作者展示契约：把库里的用户行整理成"可直接渲染"的作者徽标，
// 让主题不必判断封禁/角色（主题禁止访问 DB，判断逻辑必须留在核心）。

import type { D1Database } from '@cloudflare/workers-types';
import type { AuthorBadge } from './theme-context.ts';

interface AuthorRow {
  id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  role?: string;
  status?: string;
}

/**
 * 用户行 → 作者徽标。
 * 口径：只有未封禁的作者/管理员才有作者页；封禁或身份不符者署名降级为纯文本
 * （href 为 null），文章与署名本身保留，不因账号状态把内容下架。
 */
export function toAuthorBadge(row: AuthorRow): AuthorBadge {
  const linkable = (row.status ?? 'active') === 'active' && (row.role === undefined || row.role === 'author' || row.role === 'admin');
  const username = row.username;
  return {
    id: row.id,
    name: row.display_name?.trim() || username,
    username,
    avatarUrl: row.avatar_url || '',
    bio: row.bio || '',
    href: linkable ? `/authors/${encodeURIComponent(username)}/` : null,
  };
}

export function toAuthorBadges(rows: AuthorRow[]): AuthorBadge[] {
  return rows.map(toAuthorBadge);
}

/** 单篇署名（有序，第一位为主作者） */
export async function listPostAuthorBadges(db: D1Database, postId: number): Promise<AuthorBadge[]> {
  const rows = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.status
       FROM post_authors pa JOIN users u ON u.id = pa.user_id
       WHERE pa.post_id = ?
       ORDER BY pa.sort_order, pa.user_id`,
    )
    .bind(postId)
    .all<AuthorRow>();
  return toAuthorBadges(rows.results ?? []);
}

/**
 * 批量署名：列表页一次查完（按 90 个 id 分块，D1 单查询绑定参数上限 100）。
 * 返回普通对象（key 为文章 id 字符串）以便直接写进 props 传给主题模板。
 */
export async function badgesByPostId(
  db: D1Database,
  postIds: number[],
): Promise<Record<string, AuthorBadge[]>> {
  const out: Record<string, AuthorBadge[]> = {};
  const ids = [...new Set(postIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return out;
  const CHUNK = 90;
  for (let start = 0; start < ids.length; start += CHUNK) {
    const chunk = ids.slice(start, start + CHUNK);
    const rows = await db
      .prepare(
        `SELECT pa.post_id, u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.status
         FROM post_authors pa JOIN users u ON u.id = pa.user_id
         WHERE pa.post_id IN (${chunk.map(() => '?').join(',')})
         ORDER BY pa.post_id, pa.sort_order, pa.user_id`,
      )
      .bind(...chunk)
      .all<AuthorRow & { post_id: number }>();
    for (const r of rows.results ?? []) {
      const key = String(r.post_id);
      (out[key] ??= []).push(toAuthorBadge(r));
    }
  }
  return out;
}

/** 文集归属作者（文集署名）；无归属或文集不存在返回 null */
export async function collectionOwnerBadge(db: D1Database, collectionId: number): Promise<AuthorBadge | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.status
       FROM collections c JOIN users u ON u.id = c.created_by
       WHERE c.id = ?`,
    )
    .bind(collectionId)
    .first<AuthorRow>();
  return row ? toAuthorBadge(row) : null;
}

/**
 * 批量文集署名：首页/归档等一次列多个文集时用，避免逐条查询。
 * 键为文集 id 字符串；无归属的文集不产生键（调用方按 undefined 处理）。
 */
export async function collectionOwnerBadges(
  db: D1Database,
  collectionIds: number[],
): Promise<Record<string, AuthorBadge>> {
  const out: Record<string, AuthorBadge> = {};
  const ids = [...new Set(collectionIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return out;
  const CHUNK = 90;
  for (let start = 0; start < ids.length; start += CHUNK) {
    const chunk = ids.slice(start, start + CHUNK);
    const rows = await db
      .prepare(
        `SELECT c.id AS collection_id, u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.status
         FROM collections c JOIN users u ON u.id = c.created_by
         WHERE c.id IN (${chunk.map(() => '?').join(',')})`,
      )
      .bind(...chunk)
      .all<AuthorRow & { collection_id: number }>();
    for (const r of rows.results ?? []) out[String(r.collection_id)] = toAuthorBadge(r);
  }
  return out;
}

export interface AuthorSearchHit extends AuthorBadge {
  postCount: number;
}

/** 作者页作者信息：仅未封禁的作者/管理员有作者页；含加入时间 */
export async function getAuthorProfile(
  db: D1Database,
  username: string,
): Promise<{ badge: AuthorBadge; joinedAt: string } | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.status, u.created_at
       FROM users u
       WHERE u.role IN ('author','admin') AND u.status = 'active' AND u.username = ?`,
    )
    .bind(username.trim().toLowerCase())
    .first<AuthorRow & { created_at: string }>();
  if (!row) return null;
  return { badge: toAuthorBadge(row), joinedAt: row.created_at };
}

/**
 * 搜索作者：命中用户名 / 笔名 / 简介，附已发布篇数。
 * 口径与作者页一致：仅作者与管理员且未封禁（由 searchAuthors 的 AUTHOR_SCOPE 保证）。
 */
export async function searchAuthorHits(db: D1Database, q: string, limit = 10): Promise<AuthorSearchHit[]> {
  const query = q.trim();
  if (!query) return [];
  const like = `%${query.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.status,
              (SELECT COUNT(*) FROM posts p WHERE p.status = 'published' AND p.deleted_at IS NULL
                 AND (p.created_by = u.id OR EXISTS (SELECT 1 FROM post_authors pa WHERE pa.post_id = p.id AND pa.user_id = u.id))
              ) AS post_count
       FROM users u
       WHERE u.role IN ('author','admin') AND u.status = 'active'
         AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR u.bio LIKE ? ESCAPE '\\')
       ORDER BY post_count DESC, u.id ASC
       LIMIT ?`,
    )
    .bind(like, like, like, limit)
    .all<AuthorRow & { post_count: number }>();
  return (rows.results ?? []).map((r) => ({ ...toAuthorBadge(r), postCount: r.post_count }));
}
