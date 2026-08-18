import type {
  PostWithCollection,
  TagCountRow,
  TagPageCollectionsRow,
  TagPageResult,
  TagRow,
  TagsUnionResult,
} from './types.ts';

// 多标签交集上限：D1 单语句绑定参数与 SQL 复杂度限制下，20 个标签足够实际使用
export const MAX_TAGS = 20;

function cleanTagNames(names: string[]): string[] {
  return [...new Set(names.map((n) => n.trim().replace(/\s+/g, ' ')).filter((n) => n.length > 0))].slice(0, MAX_TAGS);
}

// LIKE 通配符转义：% 与 _ 作为字面字符匹配，配合 ESCAPE '\'
function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// 标签名不允许的字符：% 与 URL 保留/不安全字符、控制字符（含空格的标签由 cleanTagNames 归一化）
const TAG_BAD_CHARS = /[%#/?&=<>"'\\[\u0000-\u001F\u007F]/;

export function isValidTagName(name: string): boolean {
  return name.length > 0 && name.length <= 32 && !TAG_BAD_CHARS.test(name);
}

// 从 API 请求体解析标签名：只收字符串、过滤非法字符与重复
export function parseTagNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const name = t.trim().replace(/\s+/g, ' ');
    if (isValidTagName(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

// 写路径用：按名解析标签 id，不存在的直接创建（管理端打标签）
async function resolveTagIds(db: D1Database, names: string[]): Promise<number[]> {
  const unique = cleanTagNames(names);
  if (unique.length === 0) return [];
  await db.batch(unique.map((n) => db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').bind(n)));
  return findTagIds(db, unique);
}

// 读路径用：只查不写，未创建的标签不产生任何副作用
export async function findTagIds(db: D1Database, names: string[]): Promise<number[]> {
  const unique = cleanTagNames(names);
  if (unique.length === 0) return [];
  const rows = await db
    .prepare(`SELECT id FROM tags WHERE name IN (${unique.map(() => '?').join(',')})`)
    .bind(...unique)
    .all<{ id: number }>();
  return (rows.results ?? []).map((r) => r.id);
}

export async function listCollectionTags(db: D1Database, collectionId: number): Promise<TagRow[]> {
  return db
    .prepare(
      `SELECT t.id, t.name, t.created_at FROM tags t
       JOIN collection_tags ct ON ct.tag_id = t.id
       WHERE ct.collection_id = ? ORDER BY t.name`,
    )
    .bind(collectionId)
    .all<TagRow>()
    .then((r) => r.results ?? []);
}

export async function listPostOwnTags(db: D1Database, postId: number): Promise<TagRow[]> {
  return db
    .prepare(
      `SELECT t.id, t.name, t.created_at FROM tags t
       JOIN post_tags pt ON pt.tag_id = t.id
       WHERE pt.post_id = ? ORDER BY t.name`,
    )
    .bind(postId)
    .all<TagRow>()
    .then((r) => r.results ?? []);
}

// 文章有效标签 = 文集标签 ∪ 自有标签（查询时计算，不落地复制）
export async function listPostEffectiveTags(db: D1Database, postId: number): Promise<TagRow[]> {
  return db
    .prepare(
      `SELECT DISTINCT t.id, t.name, t.created_at FROM tags t
       JOIN (
         SELECT tag_id FROM post_tags WHERE post_id = ?
         UNION
         SELECT ct.tag_id FROM collection_tags ct JOIN posts p ON p.collection_id = ct.collection_id WHERE p.id = ?
       ) x ON x.tag_id = t.id
       ORDER BY t.name`,
    )
    .bind(postId, postId)
    .all<TagRow>()
    .then((r) => r.results ?? []);
}

export async function setCollectionTags(db: D1Database, collectionId: number, names: string[]): Promise<TagRow[]> {
  const ids = await resolveTagIds(db, names);
  await db.batch([
    db.prepare('DELETE FROM collection_tags WHERE collection_id = ?').bind(collectionId),
    ...ids.map((tagId) =>
      db.prepare('INSERT INTO collection_tags (collection_id, tag_id) VALUES (?, ?)').bind(collectionId, tagId),
    ),
    purgeOrphanTagsStmt(db),
  ]);
  return listCollectionTags(db, collectionId);
}

export async function setPostOwnTags(db: D1Database, postId: number, names: string[]): Promise<TagRow[]> {
  const ids = await resolveTagIds(db, names);
  await db.batch([
    db.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(postId),
    ...ids.map((tagId) =>
      db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)').bind(postId, tagId),
    ),
    purgeOrphanTagsStmt(db),
  ]);
  return listPostOwnTags(db, postId);
}

// 标签云计数：文集数 + 「自有该标签且其文集未带该标签」的已发布文章数（继承的不重复计数）
export async function listAllTagCounts(db: D1Database): Promise<TagCountRow[]> {
  const rows = await db
    .prepare(
      `SELECT t.id, t.name, t.created_at,
              (SELECT COUNT(*) FROM collection_tags ct WHERE ct.tag_id = t.id) AS collections,
              (SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id = pt.post_id
                 WHERE pt.tag_id = t.id AND p.status = 'published'
                   AND NOT EXISTS (
                     SELECT 1 FROM collection_tags ct2
                     WHERE ct2.tag_id = pt.tag_id AND ct2.collection_id = p.collection_id
                   )) AS posts
       FROM tags t
       ORDER BY collections + posts DESC, t.name`,
    )
    .all<TagCountRow>();
  return (rows.results ?? []).map((r) => ({
    ...r,
    total: (r.collections ?? 0) + (r.posts ?? 0),
  }));
}

export async function getTagByName(db: D1Database, name: string): Promise<TagRow | null> {
  return db.prepare('SELECT * FROM tags WHERE name = ?').bind(name).first<TagRow>();
}

// 标签页：带该标签的文集 + 自有该标签且未被文集卡覆盖的已发布文章。
// 带 keyword 时按关键词过滤：文集按名/简介匹配；文章按名/摘要/正文匹配且放宽到章节级（含继承），
// 以满足「在标签内寻章」（如 #校园 庄桂清、#校园 第01章）。
export async function getTagPage(db: D1Database, name: string, keyword = ''): Promise<TagPageResult | null> {
  const tag = await getTagByName(db, name);
  if (!tag) return null;
  const result = await getTagsUnion(db, [name], keyword);
  return { tag, collections: result.collections, posts: result.posts };
}

// 多标签交集（names 为空 = 全部浏览）：
// 文集 = 同时具备全部选中标签；文章 = 自有标签涵盖全部选中标签，且其文集未同时具备全部选中标签（未被文集卡覆盖）；
// 展开列表 = 各文集中（继承 ∪ 自有）同时具备全部选中标签的已发布文章。
// keyword 时按关键词过滤；文章放宽到章节级（含继承），供「标签内寻章」。
export async function getTagsUnion(db: D1Database, names: string[], keyword = ''): Promise<TagsUnionResult> {
  const unique = cleanTagNames(names);
  const tagIds = unique.length > 0 ? await findTagIds(db, unique) : [];
  // 指定了标签但任一解析不到 → 交集为空，明确返回空（而非静默降级为已存在标签的交集）
  if (unique.length > 0 && tagIds.length !== unique.length) {
    return { collections: [], posts: [], collectionPosts: new Map() };
  }
  const kw = keyword.trim();
  const likeKw = escapeLike(kw);
  const inList = tagIds.map(() => '?').join(',');
  const inArgs = tagIds;
  const need = tagIds.length;

  const kwCol = kw ? ` AND (c.title LIKE ? ESCAPE '\\' OR c.summary LIKE ? ESCAPE '\\')` : '';
  const kwPost = kw
    ? ` AND (p.title LIKE ? ESCAPE '\\' OR p.summary LIKE ? ESCAPE '\\' OR p.content_md LIKE ? ESCAPE '\\')`
    : '';

  const [collections, posts, collectionPosts] = await Promise.all([
    db
      .prepare(
        `SELECT DISTINCT c.*,
                (SELECT COUNT(*) FROM posts p WHERE p.collection_id = c.id AND p.status = 'published') AS post_count
         FROM collections c
         WHERE 1=1${tagIds.length > 0
           ? ` AND (SELECT COUNT(DISTINCT ct.tag_id) FROM collection_tags ct
                    WHERE ct.collection_id = c.id AND ct.tag_id IN (${inList})) = ${need}`
           : ''}${kwCol}
         ORDER BY c.sort_order ASC, c.id ASC`,
      )
      .bind(...inArgs, ...(kw ? [`%${likeKw}%`, `%${likeKw}%`] : []))
      .all<TagPageCollectionsRow>(),
    tagIds.length > 0
      ? db
          .prepare(
            `SELECT DISTINCT p.*, c.slug AS collection_slug FROM posts p
             LEFT JOIN collections c ON c.id = p.collection_id
             WHERE p.status = 'published'
               AND (SELECT COUNT(DISTINCT t3.tag_id) FROM (
                     SELECT tag_id FROM post_tags WHERE post_id = p.id
                     UNION SELECT tag_id FROM collection_tags WHERE collection_id = p.collection_id
                   ) t3 WHERE t3.tag_id IN (${inList})) = ${need}
               ${kw
                 ? ''
                 : `AND NOT EXISTS (
                     SELECT 1 FROM collections c2
                     WHERE c2.id = p.collection_id
                       AND (SELECT COUNT(DISTINCT ct2.tag_id) FROM collection_tags ct2
                            WHERE ct2.collection_id = c2.id AND ct2.tag_id IN (${inList})) = ${need}
                   )`}${kwPost}
             ORDER BY p.created_at DESC, p.id DESC`,
          )
          .bind(...(kw ? [...inArgs, `%${likeKw}%`, `%${likeKw}%`, `%${likeKw}%`] : [...inArgs, ...inArgs]))
          .all<PostWithCollection>()
      : db
          .prepare(
            `SELECT DISTINCT p.*, NULL AS collection_slug FROM posts p
             WHERE p.status = 'published' AND p.collection_id IS NULL${kwPost}
             ORDER BY p.created_at DESC, p.id DESC`,
          )
.bind(...(kw ? [`%${likeKw}%`, `%${likeKw}%`, `%${likeKw}%`] : []))
      .all<PostWithCollection>(),
    db
      .prepare(
        `SELECT DISTINCT p.*, c.slug AS collection_slug FROM posts p
         JOIN collections c ON c.id = p.collection_id
         WHERE p.status = 'published'
           AND (${tagIds.length > 0
             ? `(SELECT COUNT(DISTINCT t3.tag_id) FROM (
                  SELECT tag_id FROM post_tags WHERE post_id = p.id
                  UNION SELECT tag_id FROM collection_tags WHERE collection_id = p.collection_id
                ) t3 WHERE t3.tag_id IN (${inList})) = ${need}`
             : `1=1`})${kwPost}
         ORDER BY p.created_at ASC, p.id ASC`,
      )
      .bind(...inArgs, ...(kw ? [`%${likeKw}%`, `%${likeKw}%`, `%${likeKw}%`] : []))
      .all<PostWithCollection>(),
  ]);

  const map = new Map<number, PostWithCollection[]>();
  for (const p of collectionPosts.results ?? []) {
    const list = map.get(p.collection_id ?? 0);
    if (list) list.push(p);
    else map.set(p.collection_id ?? 0, [p]);
  }
  return {
    collections: collections.results ?? [],
    posts: posts.results ?? [],
    collectionPosts: map,
  };
}

export function purgeOrphanTagsStmt(db: D1Database): D1PreparedStatement {
  return db.prepare(
    `DELETE FROM tags
     WHERE NOT EXISTS (SELECT 1 FROM post_tags WHERE post_tags.tag_id = tags.id)
       AND NOT EXISTS (SELECT 1 FROM collection_tags WHERE collection_tags.tag_id = tags.id)`,
  );
}