// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, getPostVersion, getCollectionById, updatePostWithTags, isSlugConflict } from '../../../../../../lib/db';
import { json, checkCsrf } from '../../../../../../lib/auth';
import { requirePostAccess } from '../../../../../../lib/api/post-access.ts';

export const prerender = false;

/**
 * 版本内的署名快照：空数组或非法值一律视为「不覆盖当前署名」。
 * 迁移前的历史版本没有署名数据（'[]'），回滚它们不该把署名清空。
 */
function parseVersionAuthors(raw: string): number[] | null {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

export async function POST(ctx: APIContext): Promise<Response> {
  const id = Number(ctx.params.id);
  const version = Number(ctx.params.version);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(version) || version <= 0) {
    return json({ error: 'invalid id or version' }, 400);
  }

  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) return json({ error: 'forbidden: invalid origin' }, 403);
  const access = await requirePostAccess(ctx, env.DB, id);
  if (!access.ok) return access.response;

  const ver = await getPostVersion(env.DB, id, version);
  if (!ver) return json({ error: 'version not found' }, 404);

  // 历史版本指向的文集可能已被删除：降级为未分类（collection_id = NULL），
  // 避免外键错误冒泡成 500。
  let targetCollection = ver.collection_id;
  if (targetCollection !== null) {
    const col = await getCollectionById(env.DB, targetCollection);
    if (!col) targetCollection = null;
  }

  try {
    // tagNames 传 null：回滚只还原内容与署名，不动标签
    const updated = await updatePostWithTags(
      env.DB,
      id,
      {
        title: ver.title,
        slug: ver.slug,
        collection_id: targetCollection,
        summary: ver.summary,
        content_md: ver.content_md,
        cover_url: ver.cover_url,
        status: ver.status,
        meta_keywords: ver.meta_keywords,
      },
      null,
      `回滚至 v${ver.version}`,
      undefined,
      parseVersionAuthors(ver.authors),
    );
    if (updated === 'conflict') {
      return json({ error: '版本冲突：该文章已在别处被修改，请刷新后重试' }, 409);
    }
    if (!updated) return json({ error: 'not found' }, 404);
    return json({ ok: true, post: updated.post });
  } catch (e) {
    if (isSlugConflict(e)) {
      return json({ error: `slug 冲突：v${version} 的 slug 已被其他文章占用` }, 409);
    }
    throw e;
  }
}
