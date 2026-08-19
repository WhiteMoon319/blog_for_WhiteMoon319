import type { CollectionRow, PostRow, PostVersionRow, TagRow } from './types.ts';

export interface PostTagRow {
  post_id: number;
  tag_id: number;
}

export interface CollectionTagRow {
  collection_id: number;
  tag_id: number;
}

export interface ExportSnapshot {
  schema_version: number;
  generated_at: string;
  migration_version: string;
  collections: CollectionRow[];
  posts: PostRow[];
  post_versions: PostVersionRow[];
  tags: TagRow[];
  collection_tags: CollectionTagRow[];
  post_tags: PostTagRow[];
  // 可选模块：Phase 4B 之前 pages 表不存在，返回空数组而非报错
  pages: Array<Record<string, unknown>>;
  settings: Array<Record<string, unknown>>;
}

// 全量数据快照（只读）：登录后经 /api/export 暴露。
// 明确不含：管理员密码/口令、会话、Cookie、BLOG_SESSION_SECRET、CSRF 凭据、R2 媒体二进制。
// 回收站文章也一并导出并保留 deleted_at，使快照能忠实反映任意时刻的完整 CMS 状态。
export async function exportFullSnapshot(db: D1Database): Promise<ExportSnapshot> {
  const [collections, posts, post_versions, tags, collection_tags, post_tags] = await Promise.all([
    db.prepare('SELECT * FROM collections ORDER BY sort_order, id').all<CollectionRow>(),
    db.prepare('SELECT * FROM posts ORDER BY created_at, id').all<PostRow>(),
    db.prepare('SELECT * FROM post_versions ORDER BY post_id, version').all<PostVersionRow>(),
    db.prepare('SELECT * FROM tags ORDER BY name').all<TagRow>(),
    db.prepare('SELECT collection_id, tag_id FROM collection_tags ORDER BY collection_id, tag_id').all<CollectionTagRow>(),
    db.prepare('SELECT post_id, tag_id FROM post_tags ORDER BY post_id, tag_id').all<PostTagRow>(),
  ]);

  let pages: Array<Record<string, unknown>> = [];
  let settings: Array<Record<string, unknown>> = [];
  // 可选表尚不存在时（按阶段推进部署）返回空数组，接口保持可用
  try {
    pages = (await db.prepare('SELECT * FROM pages ORDER BY id').all<Record<string, unknown>>()).results ?? [];
  } catch {
    pages = [];
  }
  try {
    settings = (await db.prepare('SELECT * FROM settings ORDER BY key').all<Record<string, unknown>>()).results ?? [];
  } catch {
    settings = [];
  }

  let migrationVersion = 'unknown';
  try {
    const migration = await db
      .prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1')
      .first<{ name: string }>();
    if (migration?.name) migrationVersion = migration.name;
  } catch {
    // 测试/无迁移账本的环境（miniflare 直接执行 SQL）没有 d1_migrations 表，回退为 unknown
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    migration_version: migrationVersion,
    collections: collections.results ?? [],
    posts: posts.results ?? [],
    post_versions: post_versions.results ?? [],
    tags: tags.results ?? [],
    collection_tags: collection_tags.results ?? [],
    post_tags: post_tags.results ?? [],
    pages,
    settings,
  };
}

// 单篇 Markdown 导出：YAML frontmatter（值一律双引号转义）+ 正文。
// 回收站文章也可导出（快照语义），是否恢复由用户决定。
export async function exportPostMarkdown(db: D1Database, id: number): Promise<{ filename: string; body: string } | null> {
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>();
  if (!post) return null;
  const tags = await db
    .prepare(
      `SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ? ORDER BY t.name`,
    )
    .bind(id)
    .all<{ name: string }>();

  const yaml = (v: string): string => JSON.stringify(v);
  const frontmatter = [
    '---',
    `title: ${yaml(post.title)}`,
    `slug: ${yaml(post.slug)}`,
    `collection_id: ${post.collection_id ?? 'null'}`,
    `status: ${post.status}`,
    `created_at: ${yaml(post.created_at)}`,
    `updated_at: ${yaml(post.updated_at)}`,
    post.deleted_at ? `deleted_at: ${yaml(post.deleted_at)}` : null,
    post.cover_url ? `cover_url: ${yaml(post.cover_url)}` : null,
    `tags: [${tags.results?.map((t) => JSON.stringify(t.name)).join(', ') ?? ''}]`,
    '---',
  ].filter((l): l is string => l !== null);

  return {
    filename: `${post.slug}.md`,
    body: `${frontmatter.join('\n')}\n\n${post.content_md}\n`,
  };
}
