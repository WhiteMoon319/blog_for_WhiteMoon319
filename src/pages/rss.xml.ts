import type { APIContext } from 'astro';
import { envOf, getCollectionById, listPublishedPosts } from '../lib/db';
import { renderMarkdown } from '../lib/markdown';
import { postHref } from '../lib/utils';

export const prerender = false;

/** 文本放入 CDATA 时必须处理内部的 ]]>，否则会提前结束 CDATA 段产生非法 XML */
function cdata(value: string): string {
  return `<![CDATA[${String(value).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

/** 普通 XML 文本节点转义 */
function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function GET(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  const posts = await listPublishedPosts(env.DB, { limit: 20 });
  const base = env.SITE_URL.replace(/\/$/, '');

  const items: string[] = [];
  for (const p of posts) {
    const collection = p.collection_id ? await getCollectionById(env.DB, p.collection_id) : null;
    const link = `${base}${postHref(p.slug, collection?.slug)}`;
    const { html } = renderMarkdown(p.content_md);
    const date = new Date(p.created_at + (p.created_at.includes('Z') || p.created_at.includes('+') ? '' : 'Z'));
    const pubDate = Number.isNaN(date.getTime()) ? '' : date.toUTCString();
    items.push(`    <item>
      <title>${cdata(p.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      ${p.summary ? `    <description>${cdata(p.summary)}</description>` : ''}
      ${pubDate ? `    <pubDate>${pubDate}</pubDate>` : ''}
      <content:encoded>${cdata(html)}</content:encoded>
    </item>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${cdata(env.SITE_NAME)}</title>
    <link>${escapeXml(base)}/</link>
    <description>${cdata(env.SITE_SLOGAN)}</description>
    <language>zh-CN</language>
${items.join('\n')}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
}