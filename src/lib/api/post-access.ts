// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 文章编辑权判定：归属人（posts.created_by）与署名（post_authors）解耦后的统一入口。

import type { APIContext } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import type { PostRow } from '../db/types.ts';
import type { UserRow } from '../db/users.ts';
import { getPostAuthorIds } from '../db/authors.ts';
import { getPostById } from '../db/posts.ts';
import { json, requireAuthor } from '../auth.ts';

/** 编辑权：管理员全权；作者须为归属人或署名作者；读者一律不可 */
export async function canManagePost(db: D1Database, user: UserRow, post: PostRow): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (user.role !== 'author') return false;
  if (post.created_by === user.id) return true;
  return (await getPostAuthorIds(db, post.id)).includes(user.id);
}

/** 判断署名 id 列表里是否包含某人（避免重复查库时的二次开销） */
export function isAuthorOf(user: UserRow, authorIds: number[]): boolean {
  return authorIds.includes(user.id);
}

export type PostAccessResult =
  | { ok: true; user: UserRow; post: PostRow }
  | { ok: false; response: Response };

/**
 * 单篇写操作的统一前置：作者基线权限 + 文章存在（未删除）+ 编辑权。
 * 越权返回 403 而非 404，便于调用方区分"不存在"与"不属于你"。
 */
export async function requirePostAccess(
  ctx: APIContext,
  db: D1Database,
  postId: number,
): Promise<PostAccessResult> {
  const auth = await requireAuthor(ctx);
  if (!auth.ok) return auth;
  const post = await getPostById(db, postId);
  if (!post) return { ok: false, response: json({ error: 'not found' }, 404) };
  if (!(await canManagePost(db, auth.user, post))) {
    return { ok: false, response: json({ error: 'forbidden: 非本人文章' }, 403) };
  }
  return { ok: true, user: auth.user, post };
}

/**
 * 批量写操作：校验 id 是否全部落在本人可管理范围内（管理员恒真）。
 * 含已软删除文章（回收站恢复/彻底删除需要），故不按 deleted_at 过滤。
 */
export async function checkBatchOwned(db: D1Database, user: UserRow, ids: number[]): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (user.role !== 'author') return false;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db
    .prepare(
      `SELECT id FROM posts WHERE id IN (${placeholders})
         AND (created_by = ? OR id IN (SELECT post_id FROM post_authors WHERE user_id = ?))`,
    )
    .bind(...ids, user.id, user.id)
    .all<{ id: number }>();
  return (rows.results ?? []).length === ids.length;
}
