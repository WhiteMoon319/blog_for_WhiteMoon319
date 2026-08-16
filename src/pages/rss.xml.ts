import type { APIContext } from 'astro';
import { envOf, getCollectionById, listPublishedPosts } from '../lib/db';
import { renderMarkdown } from '../lib/markdown';
import { postHref } from '../lib/utils';

export const prerender = false;

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
      <title><![CDATA[${p.title}]]></title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      ${p.summary ? `    <description><![CDATA[${p.summary}]]></description>` : ''}
      ${pubDate ? `    <pubDate>${pubDate}</pubDate>` : ''}
      <content:encoded><![CDATA[${html}]]></content:encoded>
    </item>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title><![CDATA[${env.SITE_NAME}]]></title>
    <link>${base}/</link>
    <description><![CDATA[${env.SITE_SLOGAN}]]></description>
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