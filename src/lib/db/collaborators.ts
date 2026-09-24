// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 文集协作：私有文集只有归属人、协作者与管理员可写入。
// 协作者由归属人手动拉入，或由其他作者申请、归属人同意后自动加入。

import type { D1Database } from '@cloudflare/workers-types';

export interface CollaboratorRow {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  created_at: string;
}

export interface CollectionInviteRow {
  id: number;
  collection_id: number;
  user_id: number;
  username: string;
  display_name: string;
  status: 'pending' | 'accepted' | 'rejected';
  message: string;
  created_at: string;
  decided_at: string | null;
}

export interface CollectionWriteView {
  id: number;
  title: string;
  slug: string;
  is_public: number;
  created_by: number | null;
  /** 我与文集的关系：管理员在写作区仍按归属判断，故 admin 只在归属为空时兜底 */
  relation: 'owner' | 'collaborator' | 'public' | 'private';
  can_write: boolean;
  /** 我发出的协作申请状态（写作区显示"待同意/已拒绝"） */
  invite_status: 'pending' | 'accepted' | 'rejected' | null;
}

/**
 * 写作区文集视图：全部文集 + 我与每个文集的关系 + 可写性 + 我的申请状态。
 * 一次查三张表后在内存里合并，避免逐条判断时的多次往返。
 */
export async function listCollectionWriteView(
  db: D1Database,
  user: { id: number; role: string },
): Promise<CollectionWriteView[]> {
  const [collections, collaborating, invites] = await Promise.all([
    db
      .prepare('SELECT id, title, slug, is_public, created_by FROM collections ORDER BY sort_order ASC, id ASC')
      .all<{ id: number; title: string; slug: string; is_public: number; created_by: number | null }>(),
    listCollaboratingCollectionIds(db, user.id),
    listInvitesByUser(db, user.id),
  ]);
  const isAdmin = user.role === 'admin';
  const collabSet = new Set(collaborating);
  const inviteMap = new Map(invites.map((i) => [i.collection_id, i.status]));
  return (collections.results ?? []).map((c) => {
    const relation: CollectionWriteView['relation'] =
      c.created_by === user.id ? 'owner' : collabSet.has(c.id) ? 'collaborator' : c.is_public === 1 ? 'public' : 'private';
    return {
      id: c.id,
      title: c.title,
      slug: c.slug,
      is_public: c.is_public,
      created_by: c.created_by,
      relation,
      can_write: isAdmin || relation !== 'private',
      invite_status: inviteMap.get(c.id) ?? null,
    };
  });
}

/** 我作为协作者参与的文集 id（写作区标注"协作"用） */
export async function listCollaboratingCollectionIds(db: D1Database, userId: number): Promise<number[]> {
  const rows = await db
    .prepare('SELECT collection_id FROM collection_collaborators WHERE user_id = ?')
    .bind(userId)
    .all<{ collection_id: number }>();
  return (rows.results ?? []).map((r) => r.collection_id);
}

export async function isCollectionCollaborator(
  db: D1Database,
  collectionId: number,
  userId: number,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM collection_collaborators WHERE collection_id = ? AND user_id = ?')
    .bind(collectionId, userId)
    .first<{ ok: number }>();
  return !!row;
}

/** 某文集的全部协作者（归属人/管理员可见的成员列表） */
export async function listCollectionCollaborators(
  db: D1Database,
  collectionId: number,
): Promise<CollaboratorRow[]> {
  const rows = await db
    .prepare(
      `SELECT cc.user_id, u.username, u.display_name, u.avatar_url, cc.created_at
       FROM collection_collaborators cc JOIN users u ON u.id = cc.user_id
       WHERE cc.collection_id = ?
       ORDER BY cc.created_at ASC, cc.user_id ASC`,
    )
    .bind(collectionId)
    .all<CollaboratorRow>();
  return rows.results ?? [];
}

/** 拉入协作者（幂等）：已是协作者时无副作用 */
export async function addCollectionCollaborator(
  db: D1Database,
  collectionId: number,
  userId: number,
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO collection_collaborators (collection_id, user_id) VALUES (?, ?)')
    .bind(collectionId, userId)
    .run();
}

export async function removeCollectionCollaborator(
  db: D1Database,
  collectionId: number,
  userId: number,
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM collection_collaborators WHERE collection_id = ? AND user_id = ?')
    .bind(collectionId, userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * 申请协作：同一 (文集, 用户) 只保留一条。
 * 已同意过（accepted）时返回 'accepted'，调用方据此提示"已是协作者"。
 */
export async function requestCollectionInvite(
  db: D1Database,
  collectionId: number,
  userId: number,
  message: string,
): Promise<'created' | 'resubmitted' | 'accepted'> {
  const existing = await db
    .prepare('SELECT status FROM collection_invites WHERE collection_id = ? AND user_id = ?')
    .bind(collectionId, userId)
    .first<{ status: string }>();
  if (existing?.status === 'accepted') return 'accepted';
  if (existing) {
    // 被拒后可再申请：重置为 pending
    await db
      .prepare(
        `UPDATE collection_invites SET status = 'pending', message = ?, created_at = datetime('now'), decided_at = NULL
         WHERE collection_id = ? AND user_id = ?`,
      )
      .bind(message, collectionId, userId)
      .run();
    return 'resubmitted';
  }
  await db
    .prepare('INSERT INTO collection_invites (collection_id, user_id, message) VALUES (?, ?, ?)')
    .bind(collectionId, userId, message)
    .run();
  return 'created';
}

/** 某文集的申请列表（默认只看待处理） */
export async function listCollectionInvites(
  db: D1Database,
  collectionId: number,
  status: 'pending' | 'accepted' | 'rejected' | 'all' = 'pending',
): Promise<CollectionInviteRow[]> {
  const args: (string | number)[] = [collectionId];
  let sql = `SELECT ci.id, ci.collection_id, ci.user_id, u.username, u.display_name,
                    ci.status, ci.message, ci.created_at, ci.decided_at
             FROM collection_invites ci JOIN users u ON u.id = ci.user_id
             WHERE ci.collection_id = ?`;
  if (status !== 'all') {
    sql += ' AND ci.status = ?';
    args.push(status);
  }
  sql += ' ORDER BY ci.created_at ASC, ci.id ASC';
  const rows = await db.prepare(sql).bind(...args).all<CollectionInviteRow>();
  return rows.results ?? [];
}

/** 我发出的申请（写作区显示"待同意/已拒绝"） */
export async function listInvitesByUser(db: D1Database, userId: number): Promise<CollectionInviteRow[]> {
  const rows = await db
    .prepare(
      `SELECT ci.id, ci.collection_id, ci.user_id, u.username, u.display_name,
              ci.status, ci.message, ci.created_at, ci.decided_at
       FROM collection_invites ci JOIN users u ON u.id = ci.user_id
       WHERE ci.user_id = ?
       ORDER BY ci.created_at DESC`,
    )
    .bind(userId)
    .all<CollectionInviteRow>();
  return rows.results ?? [];
}

/**
 * 归属人裁决申请：agree 时把申请人拉进协作者。
 * 返回该申请（供调用方核对归属权限与提示），不存在返回 null。
 */
export async function decideCollectionInvite(
  db: D1Database,
  inviteId: number,
  agree: boolean,
): Promise<CollectionInviteRow | null> {
  const invite = await db
    .prepare(
      `SELECT ci.id, ci.collection_id, ci.user_id, u.username, u.display_name,
              ci.status, ci.message, ci.created_at, ci.decided_at
       FROM collection_invites ci JOIN users u ON u.id = ci.user_id
       WHERE ci.id = ?`,
    )
    .bind(inviteId)
    .first<CollectionInviteRow>();
  if (!invite) return null;
  const next = agree ? 'accepted' : 'rejected';
  await db
    .prepare(`UPDATE collection_invites SET status = ?, decided_at = datetime('now') WHERE id = ?`)
    .bind(next, inviteId)
    .run();
  if (agree) await addCollectionCollaborator(db, invite.collection_id, invite.user_id);
  return { ...invite, status: next };
}
