import { isValidSlug } from '../utils.ts';

// 批量（刊发/撤稿/删除/移动）单请求上限：保证每篇 2 条语句（更新+版本）也落在
// D1 batch 100 语句上限内，请求内整批原子执行（全成功或全失败）。
export const BATCH_MAX_IDS = 50;
export const BATCH_MAX_CREATE = 50;

export function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function parseIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > BATCH_MAX_IDS) return null;
  const ids: number[] = [];
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return null;
    ids.push(v);
  }
  return [...new Set(ids)];
}

export interface BatchCreateItem {
  title: string;
  slug: string;
  summary: string;
  content_md: string;
  collection_id: number | null;
  status: 'draft' | 'published';
}

export function parseCreateItem(raw: unknown, fallbackCollection: number | null): BatchCreateItem | string {
  if (typeof raw !== 'object' || raw === null) return 'invalid item';
  const o = raw as Record<string, unknown>;

  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (!title) return '标题不能为空';

  const status = o.status === 'published' ? 'published' : 'draft';

  const rawCol = o.collection_id === undefined ? fallbackCollection : o.collection_id;
  let collection_id: number | null = null;
  if (rawCol !== null && rawCol !== undefined) {
    if (typeof rawCol !== 'number' || !Number.isInteger(rawCol) || rawCol <= 0) {
      return 'invalid collection_id';
    }
    collection_id = rawCol;
  }

  let slug = '';
  if (typeof o.slug === 'string' && o.slug.trim()) {
    if (!isValidSlug(o.slug.trim())) return 'invalid slug';
    slug = o.slug.trim();
  }

  return {
    title,
    slug,
    summary: typeof o.summary === 'string' ? o.summary : '',
    content_md: typeof o.content_md === 'string' ? o.content_md : '',
    collection_id,
    status,
  };
}