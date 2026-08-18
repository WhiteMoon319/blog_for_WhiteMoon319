import type { PostRow } from './types.ts';

function escapeFtsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

// LIKE 通配符转义：% 与 _ 作为字面字符匹配，配合 ESCAPE '\'
function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchPublishedPosts(db: D1Database, q: string, limit = 50): Promise<PostRow[]> {
  const query = q.trim();
  if (!query) return [];
  // FTS5（trigram 分词）索引命中；仅支持 ≥3 字符的短语，短词回退 LIKE
  if (query.length >= 3) {
    const rows = await db
      .prepare(
        `SELECT p.* FROM posts_fts JOIN posts p ON p.id = posts_fts.rowid
         WHERE posts_fts MATCH ? AND p.status = 'published'
         ORDER BY bm25(posts_fts, 5, 2, 1), p.created_at DESC LIMIT ?`,
      )
      .bind(escapeFtsPhrase(query), limit)
      .all<PostRow>()
      .catch(() => null);
    if (rows && (rows.results ?? []).length > 0) return rows.results ?? [];
  }
  const like = `%${escapeLike(query)}%`;
  return db
    .prepare(
      `SELECT * FROM posts
       WHERE status = 'published' AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR content_md LIKE ? ESCAPE '\\')
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(like, like, like, limit)
    .all<PostRow>()
    .then((r) => r.results ?? []);
}