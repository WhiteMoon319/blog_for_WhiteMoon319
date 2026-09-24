// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, listCollections, listCollectionWriteView, createCollectionWithTags, parseTagsStrict, isSlugConflict } from '../../../lib/db';
import { json, requireAuthor, checkCsrf } from '../../../lib/auth';
import { ensureSlug, isValidSlug } from '../../../lib/utils';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  // ?mine=1 是写作区的"我的文集"视图：只列自己创建的，并带上可写性与申请状态
  if (ctx.url.searchParams.get('mine') === '1') {
    const auth = await requireAuthor(ctx);
    if (!auth.ok) return auth.response;
    const mine = await listCollections(env.DB, { ownerId: auth.user.id });
    const view = await listCollectionWriteView(env.DB, auth.user);
    const viewMap = new Map(view.map((v) => [v.id, v]));
    return json({
      collections: mine.map((c) => ({ ...c, ...(viewMap.get(c.id) ?? {}) })),
    });
  }
  // ?view=1 是写作区的文集选择器：全部文集 + 我对每个文集的可写性与申请状态
  if (ctx.url.searchParams.get('view') === '1') {
    const auth = await requireAuthor(ctx);
    if (!auth.ok) return auth.response;
    return json({ collections: await listCollectionWriteView(env.DB, auth.user) });
  }
  const collections = await listCollections(env.DB);
  return json({ collections });
}

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuthor(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  if (typeof body.title !== 'string' || !body.title.trim()) {
    return json({ error: 'title required' }, 400);
  }

  const slug = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : undefined;
  if (slug && !isValidSlug(slug)) {
    return json({ error: 'invalid slug: 仅允许中英文、数字与连字符，且不以连字符起止' }, 400);
  }

  const postOrder = typeof body.post_order === 'string' ? body.post_order : undefined;
  if (postOrder !== undefined && postOrder !== 'asc' && postOrder !== 'desc') {
    return json({ error: 'invalid post_order: 仅允许 asc（旧在前）或 desc（新在前）' }, 400);
  }

  const themeColor = typeof body.theme_color === 'string' && body.theme_color ? body.theme_color : '#c23a30';
  if (!/^#[0-9a-fA-F]{6}$/.test(themeColor)) {
    return json({ error: 'invalid theme_color: 需为 #RRGGBB 格式' }, 400);
  }

  const parsedTags = parseTagsStrict(body.tags);
  if (!parsedTags.ok) return json({ error: parsedTags.error }, 400);

  // 公用与否：管理员默认公用（沿用旧行为），作者自建默认私有；
  // 显式传值时以传值为准（作者当然可以把自己的集设为公用）
  const isPublic =
    body.is_public === undefined
      ? auth.user.role === 'admin'
        ? 1
        : 0
      : body.is_public === true || body.is_public === 1
        ? 1
        : 0;

  try {
    const env = await envOf();
    const created = await createCollectionWithTags(env.DB, {
      title: body.title.trim(),
      slug: ensureSlug(slug, body.title, 'collection'),
      summary: typeof body.summary === 'string' ? body.summary : '',
      theme_color: themeColor,
      sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
      post_order: (postOrder ?? 'desc') as 'asc' | 'desc',
      ref_summaries: typeof body.ref_summaries === 'number' ? body.ref_summaries : 0,
      ai_prompt_id: typeof body.ai_prompt_id === 'string' ? body.ai_prompt_id : 'overview',
      created_by: auth.user.id,
      is_public: isPublic,
    }, parsedTags.tags);
    if (!created) return json({ error: 'collection create failed' }, 500);
    return json({ collection: created.collection, tags: created.tags }, 201);
  } catch (e) {
    if (isSlugConflict(e)) return json({ error: 'slug already exists' }, 409);
    throw e;
  }
}