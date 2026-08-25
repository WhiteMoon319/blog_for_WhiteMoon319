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

export interface CommentFlat extends CommentRow {
  username: string;
  display_name: string;
  avatar_url: string;
}

export interface CommentTree extends CommentFlat {
  floor: string;
  children: CommentTree[];
  likes_count: number;
  liked_by_me: boolean;
}

export async function listApprovedComments(db: D1Database, postId: number, currentUserId?: number): Promise<CommentTree[]> {
  const rows = await db
    .prepare(
      `SELECT c.*, u.username, u.display_name, u.avatar_url,
              (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS likes_count
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? AND c.status = 'approved'
       ORDER BY c.created_at ASC, c.id ASC`,
    )
    .bind(postId)
    .all<CommentFlat & { likes_count: number }>();

  // 获取当前用户点赞状态（分片查询，避免超出 D1 绑定参数上限）
  const likedIds = new Set<number>();
  if (currentUserId && rows.results?.length) {
    const ids = (rows.results ?? []).map((r) => r.id);
    const CHUNK = 90;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const chips = batch.map(() => '?').join(',');
      const liked = await db
        .prepare(`SELECT comment_id FROM comment_likes WHERE comment_id IN (${chips}) AND user_id = ?`)
        .bind(...batch, currentUserId)
        .all<{ comment_id: number }>();
      for (const l of liked.results ?? []) likedIds.add(l.comment_id);
    }
  }

  const all = (rows.results ?? []).map((r) => ({
    ...r,
    likes_count: r.likes_count ?? 0,
    liked_by_me: likedIds.has(r.id),
    floor: '',
    children: [] as CommentTree[],
  }));
  const byId = new Map<number, CommentTree>();
  for (const c of all) byId.set(c.id, c);

  // 楼层号（派生展示值，不存库）：顶层 1、2、3…；回复 1_1、1_2…（父楼层_序号）。
  // 仅对已批准评论编号，被驳回的楼层留下空洞但不影响后续编号稳定性。
  const tops: CommentTree[] = [];
  for (const c of all) {
    if (c.parent_id === null) tops.push(c);
    else byId.get(c.parent_id)?.children.push(c);
  }

  tops.forEach((t, i) => { t.floor = String(i + 1); });
  for (const t of tops) {
    t.children.forEach((c, i) => { c.floor = `${t.floor}_${i + 1}`; });
  }
  return tops;
}

export async function createComment(
  db: D1Database,
  data: { post_id: number; parent_id?: number | null; user_id: number; body: string; attachments?: string[] },
): Promise<CommentRow | null> {
  const attachments = JSON.stringify(data.attachments ?? []);
  return db
    .prepare(`INSERT INTO comments (post_id, parent_id, user_id, body, attachments) VALUES (?, ?, ?, ?, ?) RETURNING *`)
    .bind(data.post_id, data.parent_id ?? null, data.user_id, data.body, attachments)
    .first<CommentRow>();
}

export async function updateCommentStatus(db: D1Database, id: number, status: 'approved' | 'rejected'): Promise<boolean> {
  const row = await db.prepare(`UPDATE comments SET status = ? WHERE id = ? AND status = 'pending' RETURNING id`).bind(status, id).first<{ id: number }>();
  return !!row;
}

export async function deleteComment(db: D1Database, id: number): Promise<boolean> {
  // 级联删除子回复 + 删本体，同批原子执行
  const results = await db.batch([
    db.prepare('DELETE FROM comments WHERE parent_id = ?').bind(id),
    db.prepare('DELETE FROM comments WHERE id = ? RETURNING id').bind(id),
  ]);
  const row = results[1].results?.[0] as { id: number } | undefined;
  return !!row;
}

export async function listCommentsForAdmin(
  db: D1Database,
  status: string,
  page: number,
  pageSize = 20,
  postId?: number,
): Promise<{ comments: Array<CommentRow & { username: string; display_name: string; post_title: string }>; total: number }> {
  const offset = (page - 1) * pageSize;
  const where = ['c.status = ?'];
  const args: (string | number)[] = [status];
  if (postId) { where.push('c.post_id = ?'); args.push(postId); }
  const totalRow = await db.prepare(`SELECT COUNT(*) AS n FROM comments c WHERE ${where.join(' AND ')}`).bind(...args).first<{ n: number }>();
  const rows = await db
    .prepare(
      `SELECT c.*, u.username, u.display_name, p.title AS post_title
       FROM comments c JOIN users u ON u.id = c.user_id JOIN posts p ON p.id = c.post_id
       WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...args, pageSize, offset)
    .all<CommentRow & { username: string; display_name: string; post_title: string }>();
  return { comments: rows.results ?? [], total: totalRow?.n ?? 0 };
}