// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 文集写权限判定：集合作者化后，作者只能管理自己创建的文集，管理员全权。

import type { APIContext } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import type { CollectionRow } from '../db/types.ts';
import type { UserRow } from '../db/users.ts';
import { getCollectionById } from '../db/collections.ts';
import { isCollectionCollaborator } from '../db/collaborators.ts';
import { json, requireAuthor } from '../auth.ts';

/** 管理权：管理员全权；作者仅限自己创建的文集；读者一律不可 */
export function canManageCollection(user: UserRow, collection: CollectionRow): boolean {
  if (user.role === 'admin') return true;
  if (user.role !== 'author') return false;
  return collection.created_by === user.id;
}

/**
 * 写入权：管理员全权；归属人可写自己的文集；公用文集任何作者可写；
 * 私有文集只有被拉入的协作者可写。读者的不可写在 requireAuthor 已拦下。
 */
export async function canWriteIntoCollection(
  db: D1Database,
  user: UserRow,
  collection: CollectionRow,
): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (user.role !== 'author') return false;
  if (collection.created_by === user.id) return true;
  if (collection.is_public === 1) return true;
  return isCollectionCollaborator(db, collection.id, user.id);
}

/**
 * 文章写入目标文集的守卫：返回 Response 表示拒绝（404/403），null 表示放行。
 * 文章创建、修改（含改文集）、批量移动都必须过这一关，否则私有文集形同虚设。
 */
export async function collectionWriteDenied(
  db: D1Database,
  user: UserRow,
  collectionId: number,
): Promise<Response | null> {
  const collection = await getCollectionById(db, collectionId);
  if (!collection) return json({ error: 'collection not found' }, 404);
  if (await canWriteIntoCollection(db, user, collection)) return null;
  return json({ error: 'forbidden: 该文集为私有，需文集作者同意（可在写作区申请协作）' }, 403);
}

export type CollectionAccessResult =
  | { ok: true; user: UserRow; collection: CollectionRow }
  | { ok: false; response: Response };

/** 单文集写操作前置：作者基线权限 + 文集存在 + 管理权（越权 403，不存在 404） */
export async function requireCollectionAccess(
  ctx: APIContext,
  db: D1Database,
  collectionId: number,
): Promise<CollectionAccessResult> {
  const auth = await requireAuthor(ctx);
  if (!auth.ok) return auth;
  const collection = await getCollectionById(db, collectionId);
  if (!collection) return { ok: false, response: json({ error: 'not found' }, 404) };
  if (!canManageCollection(auth.user, collection)) {
    return { ok: false, response: json({ error: 'forbidden: 非本人文集' }, 403) };
  }
  return { ok: true, user: auth.user, collection };
}
