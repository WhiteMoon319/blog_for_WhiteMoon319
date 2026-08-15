export function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}

export function ensureSlug(input: string | undefined, title: string, prefix: string): string {
  if (input && input.trim()) return input.trim();
  const slug = slugify(title);
  return slug || `${prefix}-${Date.now().toString(36)}`;
}

const SLUG_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;

export function isValidSlug(input: string): boolean {
  if (!input || input.length > 63) return false;
  if (input.includes('..')) return false;
  return SLUG_RE.test(input);
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}