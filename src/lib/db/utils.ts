export function isSlugConflict(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const msg = String((e as { message?: unknown }).message ?? '');
  return msg.includes('UNIQUE constraint failed');
}

// SQLite datetime('now') 输出 UTC（无时区后缀），JS 默认按本地解析会造成日期偏移；
// 识别该格式后按 UTC 解析，再转本地时区显示
function parseDbTime(iso: string): Date {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso)
    ? iso.replace(' ', 'T') + 'Z'
    : iso;
  return new Date(normalized);
}

export function fmtDate(iso: string): string {
  const d = parseDbTime(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}年${m}月${day}日`;
}

export function yearOf(iso: string): string {
  const d = parseDbTime(iso);
  return Number.isNaN(d.getTime()) ? '—' : String(d.getFullYear());
}