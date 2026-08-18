export function isSlugConflict(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const msg = String((e as { message?: unknown }).message ?? '');
  return msg.includes('UNIQUE constraint failed');
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}年${m}月${day}日`;
}

export function yearOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : String(d.getFullYear());
}