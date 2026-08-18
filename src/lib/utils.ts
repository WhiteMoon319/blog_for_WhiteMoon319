export const SLUG_MAX = 63;

// 多标签上限：D1 单语句绑定参数与 SQL 复杂度限制下，20 个标签足够实际使用
export const MAX_TAGS = 20;

export function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}

// slug 基名：截断到 SLUG_MAX 且不以连字符结尾，保证后续追加冲突后缀仍合法
export function slugBase(input: string): string {
  const slug = slugify(input);
  if (slug.length <= SLUG_MAX) return slug;
  return slug.slice(0, SLUG_MAX).replace(/-+$/, '');
}

// 冲突后缀名：基数先为后缀预留长度再拼接，最终候选始终 ≤SLUG_MAX 且通过 isValidSlug
export function slugWithSuffix(base: string, n: number): string {
  const suffix = `-${n}`;
  return `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
}

export function ensureSlug(input: string | undefined, title: string, prefix: string): string {
  if (input && input.trim()) return input.trim();
  const slug = slugBase(title);
  return slug || `${prefix}-${Date.now().toString(36)}`;
}

const SLUG_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;

export function isValidSlug(input: string): boolean {
  if (!input || input.length > 63) return false;
  if (input.includes('..')) return false;
  return SLUG_RE.test(input);
}

export function postHref(slug: string, collectionSlug?: string | null): string {
  return collectionSlug
    ? `/collections/${encodeURI(collectionSlug)}/${encodeURI(slug)}/`
    : `/posts/${encodeURI(slug)}/`;
}

/** R2 公共访问基地址：去掉首尾空白与末尾斜杠，避免拼出双斜杠 URL */
export function publicBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}