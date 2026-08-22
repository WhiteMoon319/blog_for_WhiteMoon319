import type { APIContext } from 'astro';
import { envOf, getAllSettings, getAiCredential, getPostById, getLatestPostVersion } from '../../../lib/db';
import { json, requireAuth, checkCsrf } from '../../../lib/auth';
import { decryptApiKey } from '../../../lib/ai-credentials';
import { generateSummary, collectContext, type AiConfig } from '../../../lib/ai';

export const prerender = false;

const AI_BATCH_MAX = 5;

function loadConfig(settings: Record<string, string>, apiKey: string): AiConfig {
  return {
    provider: (settings.ai_provider as 'deepseek' | 'openai_compatible') || 'deepseek',
    baseUrl: settings.ai_base_url || 'https://api.deepseek.com',
    model: settings.ai_model || 'deepseek-v4-flash',
    reasoningEffort: settings.ai_reasoning_effort || '',
    multiSummary: false,
    candidateCount: 1,
    apiKey,
  };
}

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden' }, 403);
  if (!env.AI_SETTINGS_ENCRYPTION_KEY) return json({ error: 'encryption_key_not_configured' }, 500);

  let body: { ids?: number[] };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) return json({ error: 'ids required' }, 400);
  if (body.ids.length > AI_BATCH_MAX) return json({ error: `too many ids, max ${AI_BATCH_MAX}` }, 400);

  const ids = [...new Set(body.ids.filter((id): id is number => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return json({ error: 'invalid ids' }, 400);

  const [settings, cred] = await Promise.all([
    getAllSettings(env.DB),
    getAiCredential(env.DB),
  ]);
  if (!cred) return json({ error: 'ai_api_key_not_configured' }, 400);

  let apiKey: string;
  try { apiKey = await decryptApiKey(env.AI_SETTINGS_ENCRYPTION_KEY, cred.api_key_ciphertext); } catch {
    return json({ error: 'failed_to_decrypt_api_key' }, 500);
  }

  const config = loadConfig(settings, apiKey);

  const results: Array<{ id: number; status: string; error?: string }> = [];

  for (const id of ids) {
    const post = await env.DB.prepare(
      `SELECT id, collection_id, content_md, summary_source, summary, deleted_at FROM posts WHERE id = ?`,
    ).bind(id).first<{ id: number; collection_id: number | null; content_md: string; summary_source: string; summary: string; deleted_at: string | null }>();

    if (!post || post.deleted_at) {
      results.push({ id, status: 'skipped', error: 'not_found' });
      continue;
    }

    if (post.summary_source === 'manual') {
      results.push({ id, status: 'skipped', error: 'manual_summary' });
      continue;
    }
    if (post.summary_source === 'ai') {
      results.push({ id, status: 'skipped', error: 'already_generated' });
      continue;
    }

    if (!post.content_md?.trim()) {
      results.push({ id, status: 'failed', error: 'empty_content' });
      continue;
    }

    // 获取参考上下文
    let context = null;
    if (post.collection_id !== null) {
      const col = await env.DB.prepare('SELECT ref_summaries FROM collections WHERE id = ?').bind(post.collection_id).first<{ ref_summaries: number }>();
      if (col && col.ref_summaries === 1) {
        context = await collectContext(env.DB, post.collection_id, id);
      }
    }

    // 获取当前版本号作为乐观锁
    const version = await getLatestPostVersion(env.DB, id);

    try {
      const summaries = await generateSummary(post.content_md, context, config);
      const summary = summaries[0];

      if (!summary) {
        results.push({ id, status: 'failed', error: 'empty_result' });
        continue;
      }

      // 版本化写入：使用 base_version 乐观锁 + summary_source 守卫
      const updated = await env.DB.prepare(
        `UPDATE posts SET summary = ?, summary_source = 'ai', updated_at = datetime('now')
         WHERE id = ? AND summary_source = 'local' AND (SELECT COALESCE(MAX(version), 0) FROM post_versions WHERE post_id = ?) = ?
         RETURNING id`,
      ).bind(summary, id, id, version).first<{ id: number }>();

      if (!updated) {
        results.push({ id, status: 'conflict' });
        continue;
      }

      // 写入版本历史
      await env.DB.prepare(
        `INSERT INTO post_versions (post_id, version, title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, message, summary_source)
         SELECT ?, COALESCE((SELECT MAX(version) FROM post_versions WHERE post_id = ?), 0) + 1,
                title, slug, collection_id, summary, content_md, cover_url, status, meta_keywords, 'AI 生成摘要', 'ai'
         FROM posts WHERE id = ?`,
      ).bind(id, id, id).run();

      results.push({ id, status: 'generated' });
    } catch (e) {
      results.push({ id, status: 'failed', error: (e as Error).message || 'generation_failed' });
    }
  }

  return json({ results });
}