import type { APIContext } from 'astro';
import { envOf, getAllSettings, getAiCredential } from '../../../lib/db';
import { json, requireAuth } from '../../../lib/auth';
import { decryptApiKey } from '../../../lib/ai-credentials';
import { fetchModelList } from '../../../lib/ai';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!env.AI_SETTINGS_ENCRYPTION_KEY) return json({ error: 'encryption_key_not_configured' }, 500);

  const [settings, cred] = await Promise.all([
    getAllSettings(env.DB),
    getAiCredential(env.DB),
  ]);
  if (!cred) return json({ error: 'ai_api_key_not_configured' }, 400);

  let apiKey: string;
  try {
    apiKey = await decryptApiKey(env.AI_SETTINGS_ENCRYPTION_KEY, cred.api_key_ciphertext);
  } catch {
    return json({ error: 'failed_to_decrypt_api_key' }, 500);
  }

  const baseUrl = settings.ai_base_url || 'https://api.deepseek.com';

  try {
    const models = await fetchModelList(baseUrl, apiKey);
    return json({ models });
  } catch (e) {
    return json({ error: (e as Error).message || 'models_not_available' }, 502);
  }
}