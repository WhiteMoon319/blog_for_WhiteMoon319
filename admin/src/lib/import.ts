export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ImportItemLike {
  title: string;
  slug: string;
  summary: string;
  contentMd: string;
}

export interface BatchCreatePayload {
  title: string;
  slug?: string;
  summary: string;
  content_md: string;
  collection_id: number;
  status: 'draft' | 'published';
}

/**
 * 生成批量导入的提交载荷。
 * 自动模式：slug 必须按当前标题实时生成（用户可能改过标题）；
 * 手动模式：使用用户输入并保留在条目里的 slug。
 */
export function buildImportPayloads(
  items: ImportItemLike[],
  slugMode: 'auto' | 'manual',
  collectionId: number,
  status: 'draft' | 'published',
): BatchCreatePayload[] {
  return items.map((it) => {
    const title = it.title.trim();
    return {
      title,
      slug: slugMode === 'auto' ? slugify(title) || undefined : it.slug.trim() || undefined,
      summary: it.summary.trim(),
      content_md: it.contentMd,
      collection_id: collectionId,
      status,
    };
  });
}