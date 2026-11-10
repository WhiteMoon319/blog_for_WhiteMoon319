// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

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
  return collectionSlug ? `/${encodeURI(collectionSlug)}/${encodeURI(slug)}/` : `/posts/${encodeURI(slug)}/`;
}

/** R2 公共访问基地址：去掉首尾空白与末尾斜杠，避免拼出双斜杠 URL */
export function publicBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * 文集 slug 会直接占用顶层路径（/{slug}/），必须避开站内既有静态路由与 API 前缀，
 * 否则新建文集会把 /about/、/archive/ 这类页面顶掉，或让 /collections/ 变成文集。
 */
export const RESERVED_COLLECTION_SLUGS = new Set([
  'admin',
  'api',
  'login',
  'logout',
  'register',
  'verify-email',
  'feed',
  'rss',
  'atom',
  'sitemap',
  'search',
  'tags',
  'archive',
  'collections',
  'media',
  'export',
  'upload',
  'posts',
  'pages',
  'authors',
  'write',
  'preview',
  'account',
  'about',
  '404',
]);

/** 校验文集 slug：除通用规则外，再排除会与顶层静态路由冲突的保留字 */
export function validateCollectionSlug(input: string): string | null {
  if (!isValidSlug(input)) return 'slug 仅允许中英文、数字与连字符，且不以连字符起止';
  if (RESERVED_COLLECTION_SLUGS.has(input.toLowerCase())) {
    return `"${input}" 与站内路径冲突，已被系统保留`;
  }
  return null;
}
