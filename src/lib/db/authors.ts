// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 多作者署名：post_authors 记录对外署名（有序，第一位为主作者），
// 与 posts.created_by（归属人，决定编辑权）解耦；作者身份复用统一 users 表。

import type { D1Database } from '@cloudflare/workers-types';
import type { AuthorRef, AuthorSummary, PostRow } from './types.ts';
import { escapeLike } from './search.ts';

const AUTHOR_FIELDS = 'u.id, u.username, u.display_name, u.avatar_url, u.bio';
/** 作者口径：必须是作者/管理员且未被封禁（读者不参与署名与作者页） */
const AUTHOR_SCOPE = `u.role IN ('author','admin') AND u.status = 'active'`;
/** 已发布且未删除、且该作者参与（归属或署名）的文章过滤片段 */
const AUTHOR_POST_SCOPE = `p.status = 'published' AND p.deleted_at IS NULL
  AND (p.created_by = ? OR EXISTS (SELECT 1 FROM post_authors pa WHERE pa.post_id = p.id AND pa.user_id = ?))`;

/** AUTHOR_POST_SCOPE 的两个占位符都绑同一个用户 id */
function authorPostArgs(userId: number): [number, number] {
  return [userId, userId];
}

/** 在 posts 表上按作者统计已发布篇数（子查询形式，供 users 联表使用） */
const POST_COUNT_SQL = `(SELECT COUNT(*) FROM posts p WHERE p.status = 'published' AND p.deleted_at IS NULL
  AND (p.created_by = u.id OR EXISTS (SELECT 1 FROM post_authors pa WHERE pa.post_id = p.id AND pa.user_id = u.id)))`;

/** 单篇署名，按 sort_order 升序（第一位即主作者） */
export async function listPostAuthors(db: D1Database, postId: number): Promise<AuthorRef[]> {
  const rows = await db
    .prepare(
      `SELECT ${AUTHOR_FIELDS} FROM post_authors pa JOIN users u ON u.id = pa.user_id
       WHERE pa.post_id = ? ORDER BY pa.sort_order, pa.user_id`,
    )
    .bind(postId)
    .all<AuthorRef>();
  return rows.results ?? [];
}

/** 批量取多篇署名：列表页一次查完，避免逐篇查询造成 N+1 */
export async function listAuthorsForPosts(db: D1Database, postIds: number[]): Promise<Map<number, AuthorRef[]>> {
  const map = new Map<number, AuthorRef[]>();
  const ids = [...new Set(postIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return map;
  const rows = await db
    .prepare(
      `SELECT pa.post_id, ${AUTHOR_FIELDS} FROM post_authors pa JOIN users u ON u.id = pa.user_id
       WHERE pa.post_id IN (${ids.map(() => '?').join(',')})
       ORDER BY pa.post_id, pa.sort_order, pa.user_id`,
    )
    .bind(...ids)
    .all<AuthorRef & { post_id: number }>();
  for (const r of rows.results ?? []) {
    const list = map.get(r.post_id) ?? [];
    list.push({ id: r.id, username: r.username, display_name: r.display_name, avatar_url: r.avatar_url, bio: r.bio });
    map.set(r.post_id, list);
  }
  return map;
}

/** 当前署名用户 id，按 sort_order 升序 */
export async function getPostAuthorIds(db: D1Database, postId: number): Promise<number[]> {
  const rows = await db
    .prepare('SELECT user_id FROM post_authors WHERE post_id = ? ORDER BY sort_order, user_id')
    .bind(postId)
    .all<{ user_id: number }>();
  return (rows.results ?? []).map((r) => r.user_id);
}

/**
 * 署名整体替换语句（先清后建）。返回语句而非直接执行，
 * 便于调用方与文章更新、版本留档放进同一个 D1 batch，保证原子。
 */
export function setPostAuthorsStmts(db: D1Database, postId: number, userIds: number[]): D1PreparedStatement[] {
  const unique = [...new Set(userIds.filter((n) => Number.isInteger(n) && n > 0))];
  const stmts: D1PreparedStatement[] = [db.prepare('DELETE FROM post_authors WHERE post_id = ?').bind(postId)];
  unique.forEach((userId, idx) => {
    stmts.push(db.prepare('INSERT INTO post_authors (post_id, user_id, sort_order) VALUES (?, ?, ?)').bind(postId, userId, idx));
  });
  return stmts;
}

/** 独立执行的署名替换（测试与非原子场景用；生产写入走 batch） */
export async function setPostAuthors(db: D1Database, postId: number, userIds: number[]): Promise<void> {
  await db.batch(setPostAuthorsStmts(db, postId, userIds));
}

/** 按用户名取作者（作者页用）：非作者身份或已封禁一律 null */
export async function getAuthorByUsername(db: D1Database, username: string): Promise<AuthorRef | null> {
  return db
    .prepare(`SELECT ${AUTHOR_FIELDS} FROM users u WHERE ${AUTHOR_SCOPE} AND u.username = ?`)
    .bind(username.trim().toLowerCase())
    .first<AuthorRef>();
}

/** 作者列表（含已发布篇数），供后台选择器与站点作者索引使用 */
export async function listAuthors(db: D1Database, limit = 100): Promise<AuthorSummary[]> {
  const rows = await db
    .prepare(
      `SELECT ${AUTHOR_FIELDS}, ${POST_COUNT_SQL} AS post_count
       FROM users u WHERE ${AUTHOR_SCOPE}
       ORDER BY post_count DESC, u.id LIMIT ?`,
    )
    .bind(limit)
    .all<AuthorSummary>();
  return rows.results ?? [];
}

/**
 * 搜索作者：命中用户名 / 笔名 / 简介。
 * 作者量级只有几十条，不做 FTS，LIKE + ESCAPE 足够且无索引维护成本。
 */
export async function searchAuthors(db: D1Database, q: string, limit = 20): Promise<AuthorSummary[]> {
  const query = q.trim();
  if (!query) return [];
  const like = `%${escapeLike(query)}%`;
  const rows = await db
    .prepare(
      `SELECT ${AUTHOR_FIELDS}, ${POST_COUNT_SQL} AS post_count
       FROM users u
       WHERE ${AUTHOR_SCOPE}
         AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR u.bio LIKE ? ESCAPE '\\')
       ORDER BY post_count DESC, u.id LIMIT ?`,
    )
    .bind(like, like, like, limit)
    .all<AuthorSummary>();
  return rows.results ?? [];
}

/** 作者名下已发布文章数（归属人或署名者皆计入） */
export async function countPublishedPostsByAuthor(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${AUTHOR_POST_SCOPE}`)
    .bind(...authorPostArgs(userId))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 作者名下已发布文章（作者页分页用） */
export async function listPublishedPostsByAuthor(
  db: D1Database,
  userId: number,
  opts: { limit?: number; offset?: number } = {},
): Promise<PostRow[]> {
  let sql = `SELECT p.* FROM posts p WHERE ${AUTHOR_POST_SCOPE} ORDER BY p.created_at DESC, p.id DESC`;
  const args: number[] = [...authorPostArgs(userId)];
  if (opts.limit) {
    sql += ' LIMIT ?';
    args.push(opts.limit);
    if (opts.offset) {
      sql += ' OFFSET ?';
      args.push(opts.offset);
    }
  }
  return db.prepare(sql).bind(...args).all<PostRow>().then((r) => r.results ?? []);
}
