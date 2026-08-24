// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, getPostById, getLatestPostVersion, updatePostWithTags, trashPosts, listPostOwnTags, getCollectionById, isSlugConflict, parseTagsStrict } from '../../../lib/db';
import { resolveUser, json, requireAuth, checkCsrf } from '../../../lib/auth';
import { isValidSlug } from '../../../lib/utils';
import { parseId } from '../../../lib/api/validate';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);

  const env = await envOf();
  const post = await getPostById(env.DB, id);
  if (!post) return json({ error: 'not found' }, 404);

  const user = await resolveUser(ctx);
  if (post.status === 'draft' && (!user || user.user.role !== 'admin')) {
    return json({ error: 'not found' }, 404);
  }
  const tags = await listPostOwnTags(env.DB, id);
  const version = await getLatestPostVersion(env.DB, id);
  return json({ post, tags, version });
}

export async function PUT(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);

  let body: Record<string, unknown>;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const patch: Record<string, string | number | null> = {};
  let versionMessage: string | undefined;
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.slug === 'string' && body.slug.trim()) {
    if (!isValidSlug(body.slug.trim())) {
      return json({ error: 'invalid slug: 仅允许中英文、数字与连字符，且不以连字符起止' }, 400);
    }
    patch.slug = body.slug.trim();
  }
  if ('collection_id' in body) {
    patch.collection_id =
      typeof body.collection_id === 'number' && Number.isInteger(body.collection_id)
        ? body.collection_id
        : null;
  }
  if (typeof body.summary === 'string') patch.summary = body.summary;
  if (typeof body.content_md === 'string') patch.content_md = body.content_md;
  if (typeof body.cover_url === 'string') patch.cover_url = body.cover_url;
  if (typeof body.meta_keywords === 'string') {
    const metaKeywords = body.meta_keywords.trim().replace(/\s+/g, ' ');
    if (metaKeywords.length > 200) {
      return json({ error: 'meta_keywords too long: 最多 200 字' }, 400);
    }
    patch.meta_keywords = metaKeywords;
  }
  if (body.status === 'published' || body.status === 'draft') patch.status = body.status;
  if (body.is_pinned === 0 || body.is_pinned === 1) patch.is_pinned = body.is_pinned;
  // 定时发布：
  // - 显式携带（'' / null / 时间串）→ 设置/清空；
  // - 状态转为 published（手动刊发）→ 服务端强制清空；
  // - 未携带 → 保持不变（版本回滚、只改标签等不触碰定时）
  if ('scheduled_at' in body) {
    const raw = body.scheduled_at;
    if (raw === null || raw === '' || (typeof raw === 'string' && raw.trim() === '')) {
      patch.scheduled_at = null;
    } else if (typeof raw === 'string') {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        return json({ error: 'invalid scheduled_at: 需要可解析的 ISO 8601 时间' }, 400);
      }
      if (patch.status === 'published') {
        return json({ error: 'scheduled_at 仅在草稿时有意义' }, 400);
      }
      if (parsed.getTime() <= Date.now()) {
        return json({ error: 'scheduled_at 必须晚于当前时间' }, 400);
      }
      patch.scheduled_at = parsed.toISOString();
    } else {
      return json({ error: 'invalid scheduled_at' }, 400);
    }
  }
  if (typeof body.version_message === 'string' && body.version_message.trim()) {
    versionMessage = body.version_message.trim();
  }
  const baseVersion =
    typeof body.base_version === 'number' && Number.isInteger(body.base_version) && body.base_version >= 0
      ? body.base_version
      : undefined;

  // 携带 tags 时严格校验（非法/超限 400，绝不静默丢弃）；未携带则不动标签
  const parsedTags = body.tags === undefined ? null : parseTagsStrict(body.tags);
  if (parsedTags !== null && !parsedTags.ok) return json({ error: parsedTags.error }, 400);

  try {
    if ('collection_id' in patch && patch.collection_id !== null && !(await getCollectionById(env.DB, Number(patch.collection_id)))) {
      return json({ error: 'collection not found' }, 404);
    }
    const updated = await updatePostWithTags(
      env.DB,
      id,
      patch,
      parsedTags === null ? null : parsedTags.tags,
      versionMessage,
      baseVersion,
    );
    if (updated === 'conflict') {
      return json({ error: '版本冲突：该文章已在别处被修改，请刷新后重试' }, 409);
    }
    if (!updated) return json({ error: 'not found' }, 404);
    return json({ post: updated.post, tags: updated.tags, version: await getLatestPostVersion(env.DB, id) });
  } catch (e) {
    if (isSlugConflict(e)) return json({ error: 'slug already exists' }, 409);
    throw e;
  }
}

export async function DELETE(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);

  const id = parseId(ctx.params.id);
  if (!id) return json({ error: 'invalid id' }, 400);

  // 单篇删除 = 移入回收站（软删除），可经回收站恢复；彻底删除走批量 API 的 purge
  const count = await trashPosts(env.DB, [id]);
  if (count === 0) return json({ error: 'not found' }, 404);
  return json({ ok: true });
}