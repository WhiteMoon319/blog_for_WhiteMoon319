// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { D1Database } from '@cloudflare/workers-types';

export interface AiCredentialRow {
  id: number;
  api_key_ciphertext: string;
  encryption_key_version: number;
  updated_at: string;
}

export async function getAiCredential(db: D1Database): Promise<AiCredentialRow | null> {
  return db.prepare('SELECT * FROM ai_credentials WHERE id = 1').first<AiCredentialRow>();
}

export async function saveAiCredential(db: D1Database, ciphertext: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ai_credentials (id, api_key_ciphertext, encryption_key_version, updated_at)
       VALUES (1, ?, 1, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET api_key_ciphertext = excluded.api_key_ciphertext, updated_at = excluded.updated_at`,
    )
    .bind(ciphertext)
    .run();
}

export async function deleteAiCredential(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM ai_credentials WHERE id = 1').run();
}