// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 定时发布：cron 轮询到期的草稿文章，原子转为已刊发。
//
// 语义（见路线图 Phase 3B）：
// - scheduled_at 只在草稿时有意义；到点自动 status='published' 并清空 scheduled_at；
// - 版本留档与状态变更同一 D1 batch 原子完成，任一失败整批回滚，scheduled_at 保留供下一轮重试；
// - 以 status='draft' + scheduled_at <= now 为守卫，重复触发/与手动刊发并发时只有成功改状态的一方生效；
// - 每轮最多处理 50 篇（每篇 2 语句，恰好 100 语句上限），超出留给下一轮。

import { planForPostId } from './versions.ts';

export const SCHEDULED_BATCH_MAX = 50;

export interface PublishDueResult {
  published: number;
  ids: number[];
}

const DUE_GUARD =
  `scheduled_at IS NOT NULL AND scheduled_at <= ? AND status = 'draft' AND deleted_at IS NULL`;

export async function publishDuePosts(
  db: D1Database,
  now: Date = new Date(),
  limit: number = SCHEDULED_BATCH_MAX,
): Promise<PublishDueResult> {
  const nowIso = now.toISOString();
  const due = await db
    .prepare(
      `SELECT id FROM posts WHERE ${DUE_GUARD} ORDER BY scheduled_at ASC LIMIT ?`,
    )
    .bind(nowIso, limit)
    .all<{ id: number }>();
  const ids = (due.results ?? []).map((r) => r.id);
  if (ids.length === 0) return { published: 0, ids: [] };

  const stmts: D1PreparedStatement[] = [];
  for (const id of ids) {
    const plan = await planForPostId(db, id);
    // 版本 INSERT 先于 UPDATE：守卫在两条语句中都生效，
    // 与手动刊发并发时，后执行的 UPDATE 因 status 已非 draft 而不命中；
    // 版本 SELECT 显式携带新 status（此时 posts.status 仍是 draft）。
    stmts.push(
      db
        .prepare(
          `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, summary_source, content_md, content_md_patch, base_version, cover_url, status, meta_keywords, message)
           SELECT ?, COALESCE((SELECT MAX(version) FROM post_versions WHERE post_id = ?), 0) + 1,
                  title, slug, collection_id, summary, summary_source, ?, ?, ?, cover_url, 'published', meta_keywords, '定时刊发'
           FROM posts WHERE id = ? AND ${DUE_GUARD}`,
        )
        .bind(id, id, plan.content_md, plan.content_md_patch, plan.base_version, id, nowIso),
    );
    stmts.push(
      db
        .prepare(
          `UPDATE posts SET status = 'published', scheduled_at = NULL, updated_at = datetime('now')
           WHERE id = ? AND ${DUE_GUARD}`,
        )
        .bind(id, nowIso),
    );
  }
  await db.batch(stmts);
  return { published: ids.length, ids };
}