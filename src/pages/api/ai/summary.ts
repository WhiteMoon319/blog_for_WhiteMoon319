import type { APIContext } from 'astro';
import { envOf, getAllSettings, getAiCredential } from '../../../lib/db';
import { json, requireAuth, checkCsrf } from '../../../lib/auth';
import { decryptApiKey } from '../../../lib/ai-credentials';
import { generateSummary, collectContext, sanitizeError, type AiConfig } from '../../../lib/ai';

export const prerender = false;

function loadConfig(settings: Record<string, string>, apiKey: string): AiConfig {
  return {
    provider: (settings.ai_provider as 'deepseek' | 'openai_compatible') || 'deepseek',
    baseUrl: settings.ai_base_url || 'https://api.deepseek.com',
    model: settings.ai_model || 'deepseek-v4-flash',
    reasoningEffort: settings.ai_reasoning_effort || '',
    multiSummary: settings.ai_multi_summary === '1',
    candidateCount: Math.min(5, Math.max(2, Number(settings.ai_candidate_count) || 3)),
    apiKey,
  };
}

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);
  if (!env.AI_SETTINGS_ENCRYPTION_KEY) return json({ error: 'encryption_key_not_configured' }, 500);

  let body: { content_md?: string; collection_id?: number; post_id?: number };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!body.content_md || typeof body.content_md !== 'string') return json({ error: 'content_md required' }, 400);
  if (body.content_md.length > 100_000) return json({ error: 'content_md too long' }, 400);

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

  const config = loadConfig(settings, apiKey);

  let collectionId: number | null = body.collection_id ?? null;
  if (body.post_id) {
    const post = await env.DB.prepare('SELECT collection_id, deleted_at FROM posts WHERE id = ?').bind(body.post_id).first<{ collection_id: number | null; deleted_at: string | null }>();
    if (!post || post.deleted_at) return json({ error: 'post not found' }, 404);
    if (collectionId !== null && collectionId !== post.collection_id) {
      return json({ error: 'collection_id mismatch' }, 400);
    }
    collectionId = post.collection_id;
  }

  let context = null;
  if (collectionId !== null) {
    const col = await env.DB.prepare('SELECT ref_summaries FROM collections WHERE id = ?').bind(collectionId).first<{ ref_summaries: number }>();
    if (col && col.ref_summaries === 1) {
      context = await collectContext(env.DB, collectionId, body.post_id);
    }
  }

  try {
    const summaries = await generateSummary(body.content_md, context, config);
    return json({ summaries });
  } catch (e) {
    return json({ error: sanitizeError(e) }, 502);
  }
}