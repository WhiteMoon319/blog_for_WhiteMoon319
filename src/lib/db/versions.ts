import { createPatch, applyPatch } from 'diff';
import type { PostVersionRow } from './types.ts';

// 版本增量存储：全量快照（base_version IS NULL，content_md 存全文）+
// 增量行（base_version 指向最近一次全量快照的 version，content_md_patch 存对该快照的 unified diff）。
// 读取时对增量行做单次 applyPatch 重建 full 文本，量级远小于逐行全量存储。
//
// 落全量的阈值：补丁长度达到 max(全量下限, 原文长度的比率) 即重新全量，
// 既控制单行大小，又避免"改一大段"时补丁反超原文。

export const FULL_SNAPSHOT_RATIO = 0.5;
export const FULL_SNAPSHOT_MIN = 128;

export interface VersionContentPlan {
  content_md: string;
  content_md_patch: string;
  base_version: number | null;
}

export function planContentStorage(
  baseContent: string | null,
  baseVersion: number | null,
  newContent: string,
): VersionContentPlan {
  if (baseVersion === null || baseContent === null) {
    // 尚无全量基准（如首版）：必须全量
    return { content_md: newContent, content_md_patch: '', base_version: null };
  }
  if (baseContent === newContent) {
    // 正文未变：无差异补丁，重建时直接回退基准内容
    return { content_md: '', content_md_patch: '', base_version: baseVersion };
  }
  const patch = createPatch('', baseContent, newContent, '', '', { context: 0 });
  if (patch.length >= Math.max(FULL_SNAPSHOT_MIN, Math.round(newContent.length * FULL_SNAPSHOT_RATIO))) {
    return { content_md: newContent, content_md_patch: '', base_version: null };
  }
  return { content_md: '', content_md_patch: patch, base_version: baseVersion };
}

export async function latestFullVersion(
  db: D1Database,
  postId: number,
): Promise<{ version: number; content_md: string } | null> {
  return db
    .prepare(
      `SELECT version, content_md FROM post_versions
       WHERE post_id = ? AND base_version IS NULL
       ORDER BY version DESC LIMIT 1`,
    )
    .bind(postId)
    .first<{ version: number; content_md: string }>();
}

// 给出新全文时决策存储形态（updatePost 已持有 current，用它避免多发一条查询）
export async function planForNewContent(
  db: D1Database,
  postId: number,
  newContent: string,
): Promise<VersionContentPlan> {
  const base = await latestFullVersion(db, postId);
  return planContentStorage(base?.content_md ?? null, base?.version ?? null, newContent);
}

// 正文未被当前操作改变（状态/归属类变更）：按 posts 现行正文决策
export async function planForPostId(db: D1Database, postId: number): Promise<VersionContentPlan> {
  const current = await db.prepare('SELECT content_md FROM posts WHERE id = ?').bind(postId).first<{ content_md: string }>();
  return planForNewContent(db, postId, current?.content_md ?? '');
}

function rebuildContent(baseFull: string, patch: string): string {
  if (!patch) return baseFull;
  const res = applyPatch(baseFull, patch);
  return typeof res === 'string' ? res : baseFull;
}

// 批量重建增量行的 full content_md。base 均为全量快照；base 可能不在本次列表内（如列表截断），
// 此时对缺失的 base 单独查询。返回的行在读取层面等价于全量存储，调用方无需感知增量。
export async function materializeVersions(
  db: D1Database,
  postId: number,
  rows: Array<PostVersionRow & { base_version: number | null; content_md_patch: string }>,
): Promise<PostVersionRow[]> {
  const fulls = new Map<number, string>();
  for (const r of rows) if (r.base_version === null) fulls.set(r.version, r.content_md);
  const missing = [
    ...new Set(rows.filter((r) => r.base_version !== null).map((r) => r.base_version as number)),
  ].filter((v) => !fulls.has(v));
  if (missing.length > 0) {
    for (const v of missing) {
      const f = await db
        .prepare(
          `SELECT version, content_md FROM post_versions
           WHERE post_id = ? AND version = ? AND base_version IS NULL`,
        )
        .bind(postId, v)
        .first<{ version: number; content_md: string }>();
      if (f) fulls.set(f.version, f.content_md);
    }
  }
  for (const r of rows) {
    if (r.base_version !== null) {
      const baseFull = fulls.get(r.base_version);
      if (baseFull !== undefined) r.content_md = rebuildContent(baseFull, r.content_md_patch);
    }
  }
  return rows;
}

export async function listPostVersions(db: D1Database, postId: number, limit = 100): Promise<PostVersionRow[]> {
  const rows = ((await db
    .prepare(`SELECT * FROM post_versions WHERE post_id = ? ORDER BY version DESC LIMIT ?`)
    .bind(postId, limit)
    .all()) as { results: Array<PostVersionRow & { base_version: number | null; content_md_patch: string }> }).results;
  return materializeVersions(db, postId, rows ?? []);
}

export async function getPostVersion(
  db: D1Database,
  postId: number,
  version: number,
): Promise<PostVersionRow | null> {
  const row = await db
    .prepare(`SELECT * FROM post_versions WHERE post_id = ? AND version = ?`)
    .bind(postId, version)
    .first<PostVersionRow & { base_version: number | null; content_md_patch: string }>();
  if (!row) return null;
  const [mat] = await materializeVersions(db, postId, [row]);
  return mat;
}

export async function getLatestPostVersion(db: D1Database, id: number): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM post_versions WHERE post_id = ?')
    .bind(id)
    .first<{ version: number }>();
  return row?.version ?? 0;
}