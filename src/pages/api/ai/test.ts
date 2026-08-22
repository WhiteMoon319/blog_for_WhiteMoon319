import type { APIContext } from 'astro';
import { envOf, getAllSettings, saveSettings, getAiCredential, saveAiCredential } from '../../../lib/db';
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

  // 测试成功，保存配置
  const settingsPairs: Record<string, string> = {
    ai_provider: provider,
    ai_base_url: baseUrl,
    ai_model: model,
    ai_reasoning_effort: reasoningEffort,
  };

  // 如用户传了新 Key 则加密保存
  let newKeyConfigured = false;
  let maskedKey = '';
  if (typeof body.api_key === 'string' && body.api_key.length > 0) {
    try {
      const ciphertext = await encryptApiKey(env.AI_SETTINGS_ENCRYPTION_KEY, body.api_key);
      await saveAiCredential(env.DB, ciphertext);
      newKeyConfigured = true;
      maskedKey = maskApiKey(body.api_key);
    } catch {
      return json({ error: 'encryption_failed' }, 500);
    }
  }

  await saveSettings(env.DB, settingsPairs);

  return json({
    ok: true,
    saved: true,
    api_key_configured: newKeyConfigured || !!curCred,
    api_key_masked: maskedKey || (curCred ? apiKey.slice(0, 3) + '••••••••' + apiKey.slice(-4) : false),
  });
}