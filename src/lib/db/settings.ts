import type { D1Database } from '@cloudflare/workers-types';

const WHITELIST = ['SITE_NAME', 'SITE_SLOGAN', 'SITE_POEM', 'SITE_URL'] as const;
export type SettingKey = (typeof WHITELIST)[number];

function isKey(k: string): k is SettingKey {
  return (WHITELIST as readonly string[]).includes(k);
}

export async function getAllSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const r of rows.results ?? []) {
    out[r.key] = r.value;
  }
  return out;
}

export async function saveSettings(db: D1Database, pairs: Record<string, string>): Promise<void> {
  const keys = Object.keys(pairs);
  for (const k of keys) {
    if (!isKey(k)) throw new Error(`invalid setting key: ${k}`);
  }
  const stmts = keys.map((k) =>
    db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .bind(k, pairs[k]),
  );
  await db.batch(stmts);
}