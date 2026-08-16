INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, message)
SELECT id, 1, title, slug, collection_id, summary, content_md, cover_url, status, '创建'
FROM posts
WHERE id NOT IN (SELECT DISTINCT post_id FROM post_versions);