// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { checkCsrf, json, requireAuth } from '../../lib/auth.ts';
import { envOf } from '../../lib/db/index.ts';
import { getAllSettings, saveSettings, isAiSettingKey } from '../../lib/db/settings.ts';
import { getAiCredential } from '../../lib/db/ai-credentials.ts';
import { decryptApiKey, maskApiKey } from '../../lib/ai-credentials.ts';
import type { SettingKey } from '../../lib/db/settings.ts';

export const prerender = false;

const KEY_DEFAULTS: Record<string, string> = {
  SITE_NAME: '我的书房',
  SITE_SLOGAN: '读书写字，不紧不慢',
  SITE_POEM: '',
  SITE_URL: 'https://example.com',
  ai_provider: 'deepseek',
  ai_base_url: 'https://api.deepseek.com',
  ai_model: 'deepseek-v4-flash',
  ai_reasoning_effort: '',
  ai_multi_summary: '0',
  ai_candidate_count: '3',
  ai_prompt_templates: '',
  comment_review_keywords: '',
};

const MAX_VALUE_LENGTH = 500;

function isValidUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  const db = getAllSettings(env.DB);
  const result: Record<string, string | boolean> = {};
  const entries = await db;
  for (const k of Object.keys(KEY_DEFAULTS) as SettingKey[]) {
    result[k] = entries[k] ?? env[k as keyof typeof env] ?? KEY_DEFAULTS[k];
  }

  // API Key 状态
  const encKey = env.AI_SETTINGS_ENCRYPTION_KEY;
  if (encKey) {
    const cred = await getAiCredential(env.DB);
    if (cred) {
      try {
        const plaintext = await decryptApiKey(encKey, cred.api_key_ciphertext);
        result.ai_api_key_configured = true;
        result.ai_api_key_masked = maskApiKey(plaintext);
      } catch {
        result.ai_api_key_configured = false;
        result.ai_api_key_masked = false;
      }
    } else {
      result.ai_api_key_configured = false;
      result.ai_api_key_masked = false;
    }
  } else {
    result.ai_api_key_configured = false;
    result.ai_api_key_masked = false;
  }

  return json(result);
}

export async function PUT(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) {
    return json({ error: 'forbidden: invalid origin' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const pairs: Record<string, string> = {};
  for (const k of Object.keys(KEY_DEFAULTS) as SettingKey[]) {
    if (k in body && typeof (body as Record<string, unknown>)[k] === 'string') {
      const v = ((body as Record<string, unknown>)[k] as string).trim();
      if (k === 'ai_prompt_templates') {
        // prompt 模板 JSON 较长，单独放宽；并做宽松的结构校验
        if (v.length > 20_000) return json({ error: `${k} too long` }, 400);
        try {
          const parsed = JSON.parse(v);
          if (!Array.isArray(parsed) || parsed.some((t) => !t || typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.prompt !== 'string' || t.id.length === 0 || t.prompt.length === 0)) {
            return json({ error: 'ai_prompt_templates 格式非法：需为 [{ id, name, prompt }]' }, 400);
          }
        } catch {
          return json({ error: 'ai_prompt_templates 需为合法 JSON' }, 400);
        }
      } else if (v.length > MAX_VALUE_LENGTH) {
        return json({ error: `${k} too long: 最多 ${MAX_VALUE_LENGTH} 字` }, 400);
      } else if (k === 'SITE_URL' && v && !isValidUrl(v)) {
        return json({ error: 'SITE_URL 仅接受 http/https URL' }, 400);
      } else if (isAiSettingKey(k) && k === 'ai_base_url' && v && !isValidUrl(v)) {
        return json({ error: 'ai_base_url 仅接受 http/https URL' }, 400);
      } else if (k === 'ai_multi_summary' && v !== '0' && v !== '1') {
        return json({ error: 'ai_multi_summary 必须为 0 或 1' }, 400);
      } else if (k === 'ai_candidate_count') {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 2 || n > 5) {
          return json({ error: 'ai_candidate_count 必须是 2-5 的整数' }, 400);
        }
      } else if (k === 'ai_provider' && v !== 'deepseek' && v !== 'openai_compatible') {
        return json({ error: 'ai_provider 只支持 deepseek 或 openai_compatible' }, 400);
      } else if (k === 'ai_reasoning_effort' && v.length > 32) {
        return json({ error: 'ai_reasoning_effort 最长 32 字符' }, 400);
      }
      pairs[k] = v;
    }
  }
  if (Object.keys(pairs).length === 0) {
    return json({ ok: true, message: 'no fields to update' });
  }

  await saveSettings(env.DB, pairs);
  return json({ ok: true, saved: Object.keys(pairs) });
}