// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { envOf, listPublishedPosts } from '../lib/db';
import { escapeXml } from '../lib/seo';

// RSS 订阅源：最近 50 篇已发布文章（不含草稿/回收站），按发布时间倒序。
export const prerender = false;

const MAX_ITEMS = 50;

export async function GET(ctx: APIContext): Promise<Response> {
  const env = await envOf();

  // SITE_URL 为空或非法时明确失败，绝不用错误基础拼出不可用的绝对链接。
  const base = env.SITE_URL.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    return new Response(JSON.stringify({ error: 'SITE_URL 未配置或非法，无法生成订阅源' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const posts = await listPublishedPosts(env.DB, { limit: MAX_ITEMS });

  const items = posts.map((p) => {
    const link = `${base}/posts/${p.slug}/`;
    return [
      '<item>',
      `<title>${escapeXml(p.title)}</title>`,
      `<link>${escapeXml(link)}</link>`,
      `<guid isPermaLink="false">post:${p.id}</guid>`,
      p.summary ? `<description>${escapeXml(p.summary)}</description>` : '',
      `<pubDate>${new Date(p.created_at).toUTCString()}</pubDate>`,
      '</item>',
    ].join('');
  });

  const lastBuild = posts.length > 0 ? `<lastBuildDate>${new Date(posts[0].created_at).toUTCString()}</lastBuildDate>` : '';
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
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

  // 订阅源可短时间缓存；内容变更才更新
  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
