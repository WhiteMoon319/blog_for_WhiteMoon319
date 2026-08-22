-- 快速查找最近全量快照：latestFullVersion 查询 (post_id, base_version IS NULL, version DESC)
CREATE INDEX idx_post_versions_base ON post_versions(post_id, base_version, version DESC);