-- UNIQUE(collection_id, slug) 对 collection_id IS NULL 的行不生效，
-- 未分类文章可能重复 slug 导致公开 URL 冲突。
-- 这里先确定性去重（保留最新一篇的 slug，其余按创建顺序追加 -2/-3…），
-- 再用部分唯一索引强制未分类 slug 全局唯一。

-- 1) 未分类重复 slug：保留最新一篇（created_at DESC, id DESC），其余按序改名 slug-2、slug-3…
UPDATE posts
SET slug = slug || '-' || (
  SELECT rn FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at DESC, id DESC) AS rn
    FROM posts WHERE collection_id IS NULL
  ) r WHERE r.id = posts.id
)
WHERE collection_id IS NULL
  AND id IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at DESC, id DESC) AS rn
      FROM posts WHERE collection_id IS NULL
    ) WHERE rn > 1
  );

-- 2) 消除极端情况下改名后的残留冲突（如用户原本就存在 slug-2 与重复 slug 同名）：
--    仍重复的未分类 slug 中保留最新一篇，其余再追加 -dup-<id>（id 全局唯一，二次冲突概率趋零）。
UPDATE posts
SET slug = slug || '-dup-' || id
WHERE collection_id IS NULL
  AND id IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at DESC, id DESC) AS rn
      FROM posts WHERE collection_id IS NULL
    ) WHERE rn > 1
  );

-- 3) 若前两步仍残留重复（用户 slug 恰好形如 foo-2-dup-5 的极端情形），
--    下面的部分唯一索引创建会显式失败，迁移报错而非静默丢数据。
CREATE UNIQUE INDEX idx_posts_slug_uncategorized ON posts(slug) WHERE collection_id IS NULL;
