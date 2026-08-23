// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CollectionRow, CollectionPatch, TagRow } from './types.ts';
import {
  ensureTagsStmts,
  purgeOrphanTagsStmt,
  setCollectionTagsStmts,
  listCollectionTags,
} from './tags.ts';
import { slugWithSuffix } from '../utils.ts';
import { planForPostId, type VersionContentPlan } from './versions.ts';

export async function listCollections(db: D1Database): Promise<CollectionRow[]> {
  return db
    .prepare(
      `SELECT * FROM collections
       ORDER BY sort_order ASC, id ASC`,
    )
    .all<CollectionRow>()
    .then((r) => r.results ?? []);
}

export async function getCollectionBySlug(db: D1Database, slug: string): Promise<CollectionRow | null> {
  return db.prepare('SELECT * FROM collections WHERE slug = ?').bind(slug).first<CollectionRow>();
}

export async function getCollectionById(db: D1Database, id: number): Promise<CollectionRow | null> {
  return db.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first<CollectionRow>();
}

export async function getCollectionsByIds(db: D1Database, ids: number[]): Promise<Map<number, CollectionRow>> {
  const unique = [...new Set(ids.filter((x): x is number => Number.isInteger(x) && x > 0))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .prepare(`SELECT * FROM collections WHERE id IN (${unique.map(() => '?').join(',')})`)
    .bind(...unique)
    .all<CollectionRow>();
  return new Map((rows.results ?? []).map((r) => [r.id, r]));
}

export async function createCollection(
  db: D1Database,
  data: {
    title: string;
    slug: string;
    summary?: string;
    theme_color?: string;
    sort_order?: number;
    post_order?: 'asc' | 'desc';
    ref_summaries?: number;
  },
): Promise<CollectionRow | null> {
  const res = await db
    .prepare(
      `INSERT INTO collections (title, slug, summary, theme_color, sort_order, post_order, ref_summaries)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      data.title,
      data.slug,
      data.summary ?? '',
      data.theme_color ?? '#c23a30',
      data.sort_order ?? 0,
      data.post_order ?? 'desc',
      data.ref_summaries ?? 0,
    )
    .first<CollectionRow>();
  return res ?? null;
}

// 创建 + 打标签原子写：文集与标签 ensure/关联、孤儿清理同批执行，slug 冲突时整体回滚
export async function createCollectionWithTags(
  db: D1Database,
  data: {
    title: string;
    slug: string;
    summary?: string;
    theme_color?: string;
    sort_order?: number;
    post_order?: 'asc' | 'desc';
    ref_summaries?: number;
  },
  tagNames: string[],
): Promise<{ collection: CollectionRow; tags: TagRow[] } | null> {
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO collections (title, slug, summary, theme_color, sort_order, post_order, ref_summaries)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(
        data.title,
        data.slug,
        data.summary ?? '',
        data.theme_color ?? '#c23a30',
        data.sort_order ?? 0,
        data.post_order ?? 'desc',
        data.ref_summaries ?? 0,
      ),
  ];
  const unique = [...new Set(tagNames.map((n) => n.trim().replace(/\s+/g, ' ')).filter((n) => n.length > 0))];
  if (unique.length > 0) {
    stmts.push(...ensureTagsStmts(db, unique));
    for (const name of unique) {
      // 文集 id 在批内才产生（RETURNING 结果批后可见），用唯一 slug 子查询定位
      stmts.push(
        db
          .prepare(
            `INSERT INTO collection_tags (collection_id, tag_id)
             SELECT c.id, t.id FROM collections c, tags t WHERE c.slug = ? AND t.name = ?`,
          )
          .bind(data.slug, name),
      );
    }
    stmts.push(purgeOrphanTagsStmt(db));
  }
  const results = await db.batch(stmts);
  const collection = results[0].results?.[0] as CollectionRow | undefined ?? null;
  if (!collection) return null;
  return { collection, tags: await listCollectionTags(db, collection.id) };
}

export async function updateCollection(db: D1Database, id: number, patch: CollectionPatch): Promise<CollectionRow | null> {
  const keys = Object.keys(patch).filter((k) =>
    ['title', 'slug', 'summary', 'theme_color', 'sort_order', 'post_order', 'ref_summaries'].includes(k),
  );
  if (keys.length === 0) return getCollectionById(db, id);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => patch[k as keyof CollectionPatch]);
  const res = await db
    .prepare(`UPDATE collections SET ${sets}, updated_at = datetime('now') WHERE id = ? RETURNING *`)
    .bind(...values, id)
    .first<CollectionRow>();
  return res ?? null;
}

// 更新 + 打标签原子写：tagNames 为 null 表示不动标签；携带则与主体更新同批严格替换
export async function updateCollectionWithTags(
  db: D1Database,
  id: number,
  patch: CollectionPatch,
  tagNames: string[] | null,
): Promise<{ collection: CollectionRow; tags: TagRow[] } | null> {
  const keys = Object.keys(patch).filter((k) =>
    ['title', 'slug', 'summary', 'theme_color', 'sort_order', 'post_order', 'ref_summaries'].includes(k),
  );
  const stmts: D1PreparedStatement[] = [];
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => patch[k as keyof CollectionPatch]);
    stmts.push(
      db
        .prepare(`UPDATE collections SET ${sets}, updated_at = datetime('now') WHERE id = ? RETURNING *`)
        .bind(...values, id),
    );
  }
  if (tagNames !== null) stmts.push(...setCollectionTagsStmts(db, id, tagNames));
  const results = await db.batch(stmts);
  const collection =
    (results[0]?.results?.[0] as CollectionRow | undefined) ?? (await getCollectionById(db, id));
  if (!collection) return null;
  return { collection, tags: await listCollectionTags(db, id) };
}

// 删除文集：成员迁移（转未分类 + 重排冲突 slug + 版本留档）与文集删除必须全部完成。
// 大批量时按块分批执行，进度记入 collection_deletes 账本（每批原子：成员迁移 + 游标前进），
// 中途失败后重试可从当前状态幂等续跑（未迁移成员仍挂在文集下，已迁移者以其新 slug 进入占用集）。
// 尾批（成员 ≤48）将剩余迁移、删文集、清账本、清孤儿标签放进同一事务，保证全有或全无。
const MIGRATE_CHUNK = 49; // 2 语句/成员 + 1 游标更新 = 99 ≤ D1 batch 100 上限
const FINAL_CHUNK = 48; // 2×48 + 3（删文集/清账本/purge）= 99

async function collectUncategorizedSlugs(db: D1Database): Promise<Set<string>> {
  const rows = await db.prepare('SELECT slug FROM posts WHERE collection_id IS NULL').all<{ slug: string }>();
  return new Set((rows.results ?? []).map((r) => r.slug));
}

// 确定性分配冲突 slug：members 须按 (created_at DESC, id DESC) 排序，与 URL 解析的「保留最新一篇」一致。
// 先占用的先进 taken 集，冲突者依次获得 slug-2/slug-3…（后缀受 SLUG_MAX 约束，最终候选必合法）。
async function assignMemberSlugs(db: D1Database, members: Array<{ id: number; slug: string }>): Promise<Map<number, string>> {
  const taken = await collectUncategorizedSlugs(db);
  const assigned = new Map<number, string>();
  for (const m of members) {
    let candidate = m.slug;
    let n = 2;
    while (taken.has(candidate)) {
      candidate = slugWithSuffix(m.slug, n);
      n++;
    }
    taken.add(candidate);
    assigned.set(m.id, candidate);
  }
  return assigned;
}

// 单成员迁移：转未分类 + 版本留档（记录 collection_id/slug 变化，开放中的旧编辑器将收到 409）。
// 版本 INSERT 先于 UPDATE：`collection_id = ?` 守卫读到的是迁移前状态，并发重复执行时守卫落空，
// 不会二次改写或重复留档；slug 显式绑定新值（此时 posts.slug 仍是旧值）。
function memberMigrateStmts(
  db: D1Database,
  postId: number,
  newSlug: string,
  collectionId: number,
  plan: VersionContentPlan,
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, summary_source, content_md, content_md_patch, base_version, cover_url, status, message)
         SELECT ?, COALESCE((SELECT MAX(version) FROM post_versions WHERE post_id = ?), 0) + 1,
                title, ?, NULL, summary, summary_source, ?, ?, ?, cover_url, status, '文集删除迁移'
         FROM posts WHERE id = ? AND collection_id = ?`,
      )
      .bind(postId, postId, newSlug, plan.content_md, plan.content_md_patch, plan.base_version, postId, collectionId),
    db
      .prepare(
        `UPDATE posts SET collection_id = NULL, slug = ?, updated_at = datetime('now')
         WHERE id = ? AND collection_id = ?`,
      )
      .bind(newSlug, postId, collectionId),
  ];
}

export async function deleteCollection(db: D1Database, id: number): Promise<boolean> {
  const col = await getCollectionById(db, id);
  if (!col) return false;
  // 账本行：幂等重置进度（分配结果始终从当前状态推导，无需依赖旧游标）
  await db
    .prepare('INSERT OR REPLACE INTO collection_deletes (collection_id, migrated_count) VALUES (?, 0)')
    .bind(id)
    .run();

  for (;;) {
    const rows = await db
      .prepare('SELECT id, slug FROM posts WHERE collection_id = ? ORDER BY created_at DESC, id DESC')
      .bind(id)
      .all<{ id: number; slug: string }>();
    const members = rows.results ?? [];
    if (members.length === 0) {
      // 空集：先单独删文集行（solo 的 meta.changes 可靠；batch 内 changes 为会话累计值，不可用于判断）
      const del = await db.prepare('DELETE FROM collections WHERE id = ?').bind(id).run();
      await db.prepare('DELETE FROM collection_deletes WHERE collection_id = ?').bind(id).run();
      await purgeOrphanTagsStmt(db).run();
      return (del.meta.changes ?? 0) > 0;
    }
    const assigned = await assignMemberSlugs(db, members);
    const stmts: D1PreparedStatement[] = [];
    for (const m of members.length <= FINAL_CHUNK ? members : members.slice(0, MIGRATE_CHUNK)) {
      const plan = await planForPostId(db, m.id);
      stmts.push(...memberMigrateStmts(db, m.id, assigned.get(m.id)!, id, plan));
    }
    if (members.length <= FINAL_CHUNK) {
      // 尾批原子：剩余成员迁移 + 删文集 + 清账本 + 清孤儿标签
      stmts.push(db.prepare('DELETE FROM collections WHERE id = ?').bind(id));
      stmts.push(db.prepare('DELETE FROM collection_deletes WHERE collection_id = ?').bind(id));
      stmts.push(purgeOrphanTagsStmt(db));
      await db.batch(stmts);
      return true;
    }
    stmts.push(
      db
        .prepare('UPDATE collection_deletes SET migrated_count = migrated_count + ? WHERE collection_id = ?')
        .bind(MIGRATE_CHUNK, id),
    );
    await db.batch(stmts);
  }
}