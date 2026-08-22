-- 文集级开关：生成摘要时是否收集该文集最近 3 篇已刊文章的摘要作为参考上下文
ALTER TABLE collections ADD COLUMN ref_summaries INTEGER NOT NULL DEFAULT 0;