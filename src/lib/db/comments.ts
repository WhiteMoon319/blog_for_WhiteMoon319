// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { D1Database } from '@cloudflare/workers-types';

export interface CommentRow {
  id: number;
  post_id: number;
  parent_id: number | null;
  user_id: number;
  body: string;
  attachments: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface CommentTree extends CommentRow {
  username: string;
  display_name: string;
  floor: number;
  children: CommentTree[];
}

export async function listApprovedComments(db: D1Database, postId: number): Promise<CommentTree[]> {
  const rows = await db
    .prepare(
      `SELECT c.*, u.username, u.display_name
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? AND c.status = 'approved'
       ORDER BY c.created_at ASC, c.id ASC`,
    )
    .bind(postId)
    .all<CommentRow & { username: string; display_name: string }>();

  const all = (rows.results ?? []).map((r) => ({
    ...r,
    children: [] as CommentTree[],
  }));

  // 构建树：顶层 + 一层回复
  const tops: CommentTree[] = [];
  const map = new Map<number, CommentTree>();
  for (const r of all) {
    const node = { ...r, floor: 0, children: [] };
    map.set(r.id, node);
    if (r.parent_id === null) tops.push(node);
  }
  // 分配楼层
  tops.forEach((t, i) => {
    t.floor = i + 1;
    const old = t as any;
    delete old.username;
    delete old.display_name;
    delete old.status;
  });
  // 挂载子回复
  for (const r of all) {
    if (r.parent_id !== null) {
      const parent = map.get(r.parent_id);
      if (parent) {
        const child = map.get(r.id)!;
        child.floor = parent.floor;
        parent.children.push(child);
      }
    }
  }
  return tops.map((t) => {
    t.children.sort((a, b) => a.created_at.localeCompare(b.created_at));
    // 子楼层编号
    t.children.forEach((c, i) => { c.floor = t.floor; });
    return t;
  });
}

export async function createComment(
  db: D1Database,
  data: { post_id: number; parent_id?: number | null; user_id: number; body: string; attachments?: string[] },
): Promise<CommentRow | null> {
  const attachments = JSON.stringify(data.attachments ?? []);
  return db
    .prepare(
      `INSERT INTO comments (post_id, parent_id, user_id, body, attachments)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(data.post_id, data.parent_id ?? null, data.user_id, data.body, attachments)
    .first<CommentRow>();
}

export async function updateCommentStatus(
  db: D1Database,
  id: number,
  status: 'approved' | 'rejected',
): Promise<boolean> {
  const row = await db
    .prepare(`UPDATE comments SET status = ? WHERE id = ? AND status = 'pending' RETURNING id`)
    .bind(status, id)
    .first<{ id: number }>();
  return !!row;
}

export async function deleteComment(db: D1Database, id: number): Promise<boolean> {
  // 级联删除子回复
  await db.prepare('DELETE FROM comments WHERE parent_id = ?').bind(id).run();
  const row = await db.prepare('DELETE FROM comments WHERE id = ? RETURNING id').bind(id).first<{ id: number }>();
  return !!row;
}

export async function listCommentsForAdmin(
  db: D1Database,
  status: string,
  page: number,
  pageSize = 20,
): Promise<{ comments: Array<CommentRow & { username: string; display_name: string; post_title: string }>; total: number }> {
  const offset = (page - 1) * pageSize;
  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM comments WHERE status = ?`)
    .bind(status)
    .first<{ n: number }>();
  const rows = await db
    .prepare(
      `SELECT c.*, u.username, u.display_name, p.title AS post_title
       FROM comments c
       JOIN users u ON u.id = c.user_id
       JOIN posts p ON p.id = c.post_id
       WHERE c.status = ?
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(status, pageSize, offset)
    .all<CommentRow & { username: string; display_name: string; post_title: string }>();
  return { comments: rows.results ?? [], total: totalRow?.n ?? 0 };
}