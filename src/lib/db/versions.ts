import type { PostVersionRow } from './types.ts';

export async function listPostVersions(db: D1Database, postId: number, limit = 100): Promise<PostVersionRow[]> {
  return db
    .prepare(`SELECT * FROM post_versions WHERE post_id = ? ORDER BY version DESC LIMIT ?`)
    .bind(postId, limit)
    .all<PostVersionRow>()
    .then((r) => r.results ?? []);
}

export async function getPostVersion(
  db: D1Database,
  postId: number,
  version: number,
): Promise<PostVersionRow | null> {
  return db
    .prepare(`SELECT * FROM post_versions WHERE post_id = ? AND version = ?`)
    .bind(postId, version)
    .first<PostVersionRow>();
}

export async function getLatestPostVersion(db: D1Database, id: number): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM post_versions WHERE post_id = ?')
    .bind(id)
    .first<{ version: number }>();
  return row?.version ?? 0;
}