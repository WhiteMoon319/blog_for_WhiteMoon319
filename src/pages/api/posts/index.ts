// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, listPosts, createPostWithTags, getCollectionById, parseTagsStrict, isSlugConflict } from '../../../lib/db';
import { getSession, json, requireAuth, isAdmin, checkCsrf } from '../../../lib/auth';
import { ensureSlug, isValidSlug } from '../../../lib/utils';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  const session = await getSession(ctx);
  const authed = isAdmin(session);
  const url = new URL(ctx.request.url);

  const status = url.searchParams.get('status');
  const collectionId = Number(url.searchParams.get('collection'));
  const limit = Number(url.searchParams.get('limit'));
  const offset = Number(url.searchParams.get('offset'));
  // 回收站是显式管理视图：仅登录后可按 status=all&trash=1 查看，普通 status 查询不携带已删内容
  const trashOnly = url.searchParams.get('trash') === '1';

  let statusFilter: 'draft' | 'published' | 'all' | undefined;
  if (status === 'all' || trashOnly) {
    if (!authed) return json({ error: 'unauthorized' }, 401);
    statusFilter = 'all';
  } else if (status === 'draft') {
    if (!authed) return json({ error: 'unauthorized' }, 401);
    statusFilter = 'draft';
  } else {
    statusFilter = 'published';
  }

  const posts = await listPosts(env.DB, {
    collectionId: Number.isInteger(collectionId) && collectionId > 0 ? collectionId : undefined,
    status: statusFilter,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : undefined,
    offset: Number.isInteger(offset) && offset > 0 ? offset : undefined,
    trashOnly,
  });
  return json({ posts });
}

export async function POST(ctx: APIContext): Promise<Response> {
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

  if (typeof body.title !== 'string' || !body.title.trim()) {
    return json({ error: 'title required' }, 400);
  }

  const status = body.status === 'published' ? 'published' : 'draft';
  const collectionId =
    typeof body.collection_id === 'number' && Number.isInteger(body.collection_id)
      ? body.collection_id
      : null;

  const slug = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : undefined;
  if (slug && !isValidSlug(slug)) {
    return json({ error: 'invalid slug: 仅允许中英文、数字与连字符，且不以连字符起止' }, 400);
  }

  // 严格标签校验：非法/超限一律 400，绝不静默丢弃
  const parsedTags = parseTagsStrict(body.tags);
  if (!parsedTags.ok) return json({ error: parsedTags.error }, 400);

  // SEO 关键词：纯文本、长度受限，超出截断会静默丢数据，因此直接 400
  const metaKeywords =
    typeof body.meta_keywords === 'string'
      ? body.meta_keywords.trim().replace(/\s+/g, ' ')
      : '';
  if (metaKeywords.length > 200) {
    return json({ error: 'meta_keywords too long: 最多 200 字' }, 400);
  }

  const isPinned = body.is_pinned === 1 ? 1 : 0;

  // 定时发布：仅在草稿时有意义；提交已刊发的文章带定时值直接 400
  let scheduledAt: string | null = null;
  if (typeof body.scheduled_at === 'string' && body.scheduled_at.trim() !== '') {
    const parsed = new Date(body.scheduled_at);
    if (Number.isNaN(parsed.getTime())) {
      return json({ error: 'invalid scheduled_at: 需要可解析的 ISO 8601 时间' }, 400);
    }
    if (status === 'published') {
      return json({ error: 'scheduled_at 仅在草稿时有意义' }, 400);
    }
    if (parsed.getTime() <= Date.now()) {
      return json({ error: 'scheduled_at 必须晚于当前时间' }, 400);
    }
    scheduledAt = parsed.toISOString();
  }

  try {
    if (collectionId !== null && !(await getCollectionById(env.DB, collectionId))) {
      return json({ error: 'collection not found' }, 404);
    }
    const created = await createPostWithTags(env.DB, {
      title: body.title.trim(),
      slug: ensureSlug(slug, body.title, 'post'),
      collection_id: collectionId,
      summary: typeof body.summary === 'string' ? body.summary : '',
      content_md: typeof body.content_md === 'string' ? body.content_md : '',
      cover_url: typeof body.cover_url === 'string' ? body.cover_url : '',
      meta_keywords: metaKeywords,
      is_pinned: isPinned,
      scheduled_at: scheduledAt,
      status,
    }, parsedTags.tags);
    if (!created) return json({ error: 'post create failed' }, 500);
    return json({ post: created.post, tags: created.tags, version: 1 }, 201);
  } catch (e) {
    if (isSlugConflict(e)) return json({ error: 'slug already exists' }, 409);
    throw e;
  }
}