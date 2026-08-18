import { slugify } from '../../../src/lib/utils.ts';

export { slugify };

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

export const EXT_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim();
}

export function titleFromMarkdown(md: string, fallback: string): string {
  const h = md.match(/^\s*#{1,6}\s+(.+)$/m);
  if (h) return h[1].replace(/[*_`]/g, '').trim();
  return fallback;
}

export function summaryFromMarkdown(md: string): string {
  const para = md
    .split(/\n{2,}/)
    .map((p) => p.replace(/^[#>\-*+\d.\s`]+/m, '').replace(/[*_`[\]]/g, '').trim())
    .find((t) => t.length > 0);
  return (para ?? '').slice(0, 120);
}

export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|>\s|```|`[^`\n]+`|\d+\.\s)/.test(text);
}

export function plainToParagraphs(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, '\n').trim())
    .filter((p) => p.length > 0)
    .join('\n\n');
}

export function firstHeadingFromHtml(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const h = doc.querySelector('h1, h2, h3');
  return h?.textContent?.trim() || null;
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