import type { APIContext } from 'astro';
import { envOf, getAllSettings, getAiCredential } from '../../../lib/db';
import { json, requireAuth, checkCsrf } from '../../../lib/auth';
import { encryptApiKey, decryptApiKey, maskApiKey } from '../../../lib/ai-credentials';
import { testConnection, type AiConfig } from '../../../lib/ai';

export const prerender = false;

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);
  if (!env.AI_SETTINGS_ENCRYPTION_KEY) return json({ error: 'encryption_key_not_configured' }, 500);

  let body: Record<string, unknown>;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // 读取当前已保存配置作为默认值
  const settings = await getAllSettings(env.DB);
  const curCred = await getAiCredential(env.DB);
  let existingKey = '';
  if (curCred) {
    try { existingKey = await decryptApiKey(env.AI_SETTINGS_ENCRYPTION_KEY, curCred.api_key_ciphertext); } catch {}
  }

  const provider = (typeof body.provider === 'string' ? body.provider : settings.ai_provider) || 'deepseek';
  const baseUrl = (typeof body.base_url === 'string' ? body.base_url : settings.ai_base_url) || 'https://api.deepseek.com';
  const model = (typeof body.model === 'string' ? body.model : settings.ai_model) || 'deepseek-v4-flash';
  const reasoningEffort = typeof body.reasoning_effort === 'string' ? body.reasoning_effort : (settings.ai_reasoning_effort || '');
  const apiKey = typeof body.api_key === 'string' && body.api_key.length > 0 ? body.api_key : existingKey;

  if (provider !== 'deepseek' && provider !== 'openai_compatible') {
    return json({ error: 'invalid provider' }, 400);
  }

  if (!apiKey) {
    return json({ error: 'api_key_required' }, 400);
  }

  const config: AiConfig = {
    provider: provider as 'deepseek' | 'openai_compatible',
    baseUrl,
    model,
    reasoningEffort,
    multiSummary: false,
    candidateCount: 1,
    apiKey,
  };

  const testResult = await testConnection(config);
  if (!testResult.ok) {
    return json({ ok: false, error: testResult.error ?? 'test_failed' });
  }

  // 测试成功，保存配置：settings 与 ai_credentials 在同一 D1 batch 原子写入，
  // 避免先清旧 Key 再写新 Key 造成中途失败后凭据丢失。
  const settingsPairs: Record<string, string> = {
    ai_provider: provider,
    ai_base_url: baseUrl,
    ai_model: model,
    ai_reasoning_effort: reasoningEffort,
  };
  let newKeyConfigured = false;
  let maskedKey = '';
  const stmts: D1PreparedStatement[] = Object.entries(settingsPairs).map(([k, v]) =>
    env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(k, v),
  );

  if (typeof body.api_key === 'string' && body.api_key.length > 0) {
    let ciphertext: string;
    try {
      ciphertext = await encryptApiKey(env.AI_SETTINGS_ENCRYPTION_KEY, body.api_key);
    } catch {
      return json({ error: 'encryption_failed' }, 500);
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO ai_credentials (id, api_key_ciphertext, encryption_key_version, updated_at)
         VALUES (1, ?, 1, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET api_key_ciphertext = excluded.api_key_ciphertext, updated_at = excluded.updated_at`,
      ).bind(ciphertext),
    );
    newKeyConfigured = true;
    maskedKey = maskApiKey(body.api_key);
  }

  await env.DB.batch(stmts);

  return json({
    ok: true,
    saved: true,
    api_key_configured: newKeyConfigured || !!curCred,
    api_key_masked: maskedKey || (curCred ? maskApiKey(apiKey) : false),
  });
}