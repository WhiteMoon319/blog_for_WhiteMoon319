import type { APIContext } from 'astro';
import { checkCsrf, json, requireAuth } from '../../lib/auth.ts';
import { envOf } from '../../lib/db/index.ts';
import { getAllSettings, saveSettings } from '../../lib/db/settings.ts';
import type { SettingKey } from '../../lib/db/settings.ts';

export const prerender = false;

const KEY_DEFAULTS: Record<SettingKey, string> = {
  SITE_NAME: '我的书房',
  SITE_SLOGAN: '读书写字，不紧不慢',
  SITE_POEM: '',
  SITE_URL: 'https://example.com',
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
  const result: Record<string, string> = {};
  const entries = await db;
  for (const k of Object.keys(KEY_DEFAULTS) as SettingKey[]) {
    result[k] = entries[k] ?? env[k as keyof typeof env] ?? KEY_DEFAULTS[k];
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
      if (v.length > MAX_VALUE_LENGTH) {
        return json({ error: `${k} too long: 最多 ${MAX_VALUE_LENGTH} 字` }, 400);
      }
      if (k === 'SITE_URL' && v && !isValidUrl(v)) {
        return json({ error: 'SITE_URL 仅接受 http/https URL' }, 400);
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