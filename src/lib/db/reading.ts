// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { D1Database } from '@cloudflare/workers-types';

/** 一条阅读记录（含文章展示所需字段，供首页「历史记录」区块复用 post-card） */
export interface ReadingRecord {
  postId: number;
  /** 0-100：上次阅读位置；-1 表示仅记录「读过」未获取滚动位置 */
  scrollPct: number;
  updatedAt: string;
  title: string;
  slug: string;
  summary: string;
  coverUrl: string | null;
  collectionId: number | null;
  collectionSlug: string | null;
}

const READING_FIELDS = `
  rh.post_id AS postId, rh.scroll_pct AS scrollPct, rh.updated_at AS updatedAt,
  p.title, p.slug, p.summary, p.cover_url AS coverUrl,
  p.collection_id AS collectionId, c.slug AS collectionSlug
`;

/** 写阅读记录（upsert）：同一用户对同一文章只保留一条，滚动位置取最新 */
export async function saveReading(db: D1Database, userId: number, postId: number, scrollPct: number): Promise<void> {
  const pct = Math.max(-1, Math.min(100, Math.round(scrollPct)));
  await db
    .prepare(
      `INSERT INTO reading_history (post_id, user_id, scroll_pct, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(post_id, user_id) DO UPDATE SET
         scroll_pct = excluded.scroll_pct,
         updated_at = excluded.updated_at`,
    )
    .bind(postId, userId, pct)
    .run();
}

/** 查询某用户的最近阅读记录（仅已发布、未删除的文章），按最近阅读时间倒序 */
export async function listRecentReadings(db: D1Database, userId: number, limit = 6): Promise<ReadingRecord[]> {
  const rows = await db
    .prepare(
      `SELECT ${READING_FIELDS}
       FROM reading_history rh
       JOIN posts p ON p.id = rh.post_id
       LEFT JOIN collections c ON c.id = p.collection_id
       WHERE rh.user_id = ? AND p.status = 'published' AND p.deleted_at IS NULL
       ORDER BY rh.updated_at DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<ReadingRecord>();
  return rows.results ?? [];
}

/** 取某用户对某文章的阅读位置（无记录返回 null） */
export async function getReadingProgress(
  db: D1Database,
  userId: number,
  postId: number,
): Promise<{ scrollPct: number } | null> {
  return (
    (await db
      .prepare('SELECT scroll_pct AS scrollPct FROM reading_history WHERE post_id = ? AND user_id = ?')
      .bind(postId, userId)
      .first<{ scrollPct: number }>()) ?? null
  );
}
