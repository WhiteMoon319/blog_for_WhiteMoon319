// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { D1Database } from '@cloudflare/workers-types';

const WHITELIST = [
  'SITE_NAME', 'SITE_SLOGAN', 'SITE_POEM', 'SITE_URL',
  'ai_provider', 'ai_base_url', 'ai_model', 'ai_reasoning_effort',
  'ai_multi_summary', 'ai_candidate_count',
] as const;
export type SettingKey = (typeof WHITELIST)[number];

const AI_KEYS = new Set(['ai_provider', 'ai_base_url', 'ai_model', 'ai_reasoning_effort', 'ai_multi_summary', 'ai_candidate_count']);

function isKey(k: string): k is SettingKey {
  return (WHITELIST as readonly string[]).includes(k);
}

export function isAiSettingKey(k: string): boolean {
  return AI_KEYS.has(k);
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