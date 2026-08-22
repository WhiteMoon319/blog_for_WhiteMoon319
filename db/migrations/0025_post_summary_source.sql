-- 摘要来源标记：区分导入自动摘要、手工摘要和 AI 生成摘要，用于批量 AI 覆盖守卫
ALTER TABLE posts ADD COLUMN summary_source TEXT NOT NULL DEFAULT 'manual'
  CHECK (summary_source IN ('local', 'manual', 'ai'));
ALTER TABLE post_versions ADD COLUMN summary_source TEXT NOT NULL DEFAULT 'manual'
  CHECK (summary_source IN ('local', 'manual', 'ai'));