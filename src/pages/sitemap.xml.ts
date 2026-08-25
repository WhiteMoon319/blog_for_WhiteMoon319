// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, listCollections } from '../lib/db';
import { postHref } from '../lib/utils';

export const prerender = false;

// 模块级缓存：代际 key 为文集+文章时间戳指纹，内容无变化时复用
let sitemapCache: { key: string; xml: string } | null = null;

export async function GET(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  const base = env.SITE_URL.replace(/\/$/, '');
  const collections = await listCollections(env.DB);
  const posts = await env.DB
    .prepare(
      `SELECT p.id, p.slug, p.collection_id, p.updated_at, p.status, p.deleted_at, c.slug AS collection_slug FROM posts p
       LEFT JOIN collections c ON c.id = p.collection_id
       WHERE p.status = 'published' AND p.deleted_at IS NULL`,
    )
    .all<{ id: number; slug: string; collection_id: number | null; updated_at: string; status: string; deleted_at: string | null; collection_slug: string | null }>();

  const cacheKey = collections.map((c) => `${c.id}:${c.updated_at}`).join('|') + '||' + (posts.results ?? []).map((p) => `${p.id}:${p.updated_at}`).join('|');
  if (sitemapCache && sitemapCache.key === cacheKey) {
    return new Response(sitemapCache.xml, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
  }

  const urls = ['/', '/archive/', '/about/', '/search/'].map((path) => ({
    path, lastmod: undefined as string | undefined,
  }));

  for (const c of collections) {
    urls.push({ path: `/collections/${encodeURI(c.slug)}/`, lastmod: c.updated_at });
  }
  for (const p of posts.results ?? []) {
    urls.push({ path: postHref(p.slug, p.collection_slug), lastmod: p.updated_at });
  }

  const body = urls.map((u) => {
    const loc = `${base}${u.path}`;
    return `  <url>\n    <loc>${loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ''}\n  </url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
  sitemapCache = { key: cacheKey, xml };

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}