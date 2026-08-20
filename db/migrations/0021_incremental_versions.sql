-- 版本增量存储：v1 起全量快照（base_version 为 NULL），此后各版本对最近一次全量快照存 unified diff；
-- 变更较大（补丁超过阈值）时重新落全量快照作为新的基准。
-- 历史行两项均为 NULL/空串，等价于全量，无需回填。
ALTER TABLE post_versions ADD COLUMN base_version INTEGER;
ALTER TABLE post_versions ADD COLUMN content_md_patch TEXT NOT NULL DEFAULT '';