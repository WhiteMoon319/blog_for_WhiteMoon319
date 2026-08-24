// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, listPublishedPosts, getCollectionsByIds } from '../lib/db';
import { escapeXml } from '../lib/seo';
import { postHref } from '../lib/utils';
import { renderMarkdown } from '../lib/markdown';

// RSS 订阅源：最近 50 篇已发布文章（不含草稿/回收站），按发布时间倒序。
export const prerender = false;

const MAX_ITEMS = 50;

function fmtDate(d: string): string {
  // D1 返回的日期格式为 "2026-08-20 08:04:51"，需转为 ISO 8601 再格式化
  const iso = d.includes('T') ? d : d.replace(' ', 'T') + 'Z';
  const date = new Date(iso);
  return isNaN(date.getTime()) ? '' : date.toUTCString();
}

export async function GET(ctx: APIContext): Promise<Response> {
  const env = await envOf();

  const base = env.SITE_URL.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    return new Response(JSON.stringify({ error: 'SITE_URL 未配置或非法，无法生成订阅源' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const posts = await listPublishedPosts(env.DB, { limit: MAX_ITEMS });

  // 收集文集 slug 映射
  const colIds = [...new Set(posts.map((p) => p.collection_id).filter((id): id is number => id !== null))];
  const colMap = new Map<number, string>();
  if (colIds.length > 0) {
    const cols = await getCollectionsByIds(env.DB, colIds);
    for (const [id, c] of cols) colMap.set(id, c.slug);
  }

  const items = posts.map((p) => {
    const colSlug = p.collection_id !== null ? colMap.get(p.collection_id) ?? null : null;
    const link = `${base}${postHref(p.slug, colSlug)}`;
    const pubDate = fmtDate(p.created_at);
    const { html } = renderMarkdown(p.content_md);
    return [
      '<item>',
      `<title>${escapeXml(p.title)}</title>`,
      `<link>${escapeXml(link)}</link>`,
      `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
      p.summary ? `<description><![CDATA[${p.summary}]]></description>` : '',
      html ? `<content:encoded><![CDATA[${html}]]></content:encoded>` : '',
      pubDate ? `<pubDate>${pubDate}</pubDate>` : '',
      '</item>',
    ].join('');
  });

  const lastBuild = posts.length > 0 ? `<lastBuildDate>${fmtDate(posts[0].created_at)}</lastBuildDate>` : '';
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">`,
    '<channel>',
    `<title>${escapeXml(env.SITE_NAME)}</title>`,
    `<description>${escapeXml(env.SITE_SLOGAN ?? '')}</description>`,
    `<link>${escapeXml(base)}</link>`,
    `<atom:link href="${escapeXml(base)}/feed.xml" rel="self" type="application/rss+xml"/>`,
    lastBuild,
    ...items,
    '</channel>',
    '</rss>',
    ''].join('\n');

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}