// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, listPosts, createPostWithTags, listPostAuthors, listAuthorsForPosts, filterSignableAuthorIds, parseTagsStrict, isSlugConflict } from '../../../lib/db';
import { json, requireAuthor, checkCsrf } from '../../../lib/auth';
import { collectionWriteDenied } from '../../../lib/api/collection-access.ts';
import { ensureSlug, isValidSlug } from '../../../lib/utils';
import { parseAuthorIds } from '../../../lib/api/validate';
import { POST_LAYOUTS } from '../../../lib/db/types.ts';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  const url = new URL(ctx.request.url);

  const status = url.searchParams.get('status');
  const collectionId = Number(url.searchParams.get('collection'));
  const limit = Number(url.searchParams.get('limit'));
  const offset = Number(url.searchParams.get('offset'));
  // 回收站是显式管理视图：仅登录后可按 status=all&trash=1 查看，普通 status 查询不携带已删内容
  const trashOnly = url.searchParams.get('trash') === '1';
  // 非公开状态（草稿/全部/回收站）走作者基线权限；公开列表任何人可读
  const wantsPrivate = status === 'all' || status === 'draft' || trashOnly;

  let authorId: number | undefined;
  if (wantsPrivate) {
    const auth = await requireAuthor(ctx);
    if (!auth.ok) return auth.response;
    // 作者只看自己归属或署名的文章；管理员不加过滤
    if (auth.user.role !== 'admin') authorId = auth.user.id;
  }

  const statusFilter: 'draft' | 'published' | 'all' = wantsPrivate
    ? status === 'draft'
      ? 'draft'
      : 'all'
    : 'published';

  const posts = await listPosts(env.DB, {
    collectionId: Number.isInteger(collectionId) && collectionId > 0 ? collectionId : undefined,
    status: statusFilter,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : undefined,
    offset: Number.isInteger(offset) && offset > 0 ? offset : undefined,
    trashOnly,
    authorId,
  });
  // 列表页需要署名：一次 IN 查询取回全部，避免逐篇查询
  const authorMap = await listAuthorsForPosts(env.DB, posts.map((p) => p.id));
  return json({ posts: posts.map((p) => ({ ...p, authors: authorMap.get(p.id) ?? [] })) });
}

export async function POST(ctx: APIContext): Promise<Response> {
  const auth = await requireAuthor(ctx);
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

  const parsedAuthors = parseAuthorIds(body.authors);
  if (!parsedAuthors.ok) return json({ error: parsedAuthors.error }, 400);

  // 全文排版预设：白名单校验，非法值 400（避免写进库里变成无声的无效 class）
  const layout = typeof body.layout === 'string' ? body.layout.trim() : '';
  if (!POST_LAYOUTS.includes(layout as (typeof POST_LAYOUTS)[number])) {
    return json({ error: `invalid layout: 仅允许 ${POST_LAYOUTS.filter(Boolean).join(' / ')} 或留空` }, 400);
  }

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
    if (collectionId !== null) {
      // 私有文集需要归属人或协作者身份：写入校验在这里，前端隐藏只是体验
      const denied = await collectionWriteDenied(env.DB, auth.user, collectionId);
      if (denied) return denied;
    }
    // 署名缺省为创建者本人：保证新文一定有主作者，前台不出现空白署名；
    // 显式传空数组则允许无署名（例如仅作为草稿的转载占位）。
    const requested = parsedAuthors.ids ?? [auth.user.id];
    const authorIds = await filterSignableAuthorIds(env.DB, requested);
    if (authorIds.length !== new Set(requested).size) {
      return json({ error: 'authors 含不可署名的用户（需为作者或管理员且未封禁）' }, 400);
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
      created_by: auth.user.id,
      layout,
    }, parsedTags.tags, authorIds);
    if (!created) return json({ error: 'post create failed' }, 500);
    return json({ post: created.post, tags: created.tags, version: 1, authors: await listPostAuthors(env.DB, created.post.id) }, 201);
  } catch (e) {
    if (isSlugConflict(e)) return json({ error: 'slug already exists' }, 409);
    throw e;
  }
}