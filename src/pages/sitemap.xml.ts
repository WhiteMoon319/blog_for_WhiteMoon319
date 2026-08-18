import type { APIContext } from 'astro';
import { envOf, listCollections, type PostWithCollection } from '../lib/db';
import { postHref } from '../lib/utils';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  const base = env.SITE_URL.replace(/\/$/, '');
  const collections = await listCollections(env.DB);
  const posts = await env.DB
    .prepare(
      `SELECT p.*, c.slug AS collection_slug FROM posts p
       LEFT JOIN collections c ON c.id = p.collection_id
       WHERE p.status = 'published'`,
    )
    .all<PostWithCollection>();

  const urls = ['/', '/archive/', '/about/', '/search/'].map((path) => ({
    path,
    lastmod: undefined as string | undefined,
  }));

  for (const c of collections) {
    urls.push({ path: `/collections/${encodeURI(c.slug)}/`, lastmod: c.updated_at });
  }
  for (const p of posts.results ?? []) {
    urls.push({ path: postHref(p.slug, p.collection_slug), lastmod: p.updated_at });
  }

  const body = urls
    .map((u) => {
      const loc = `${base}${u.path}`;
      return `  <url>\n    <loc>${loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ''}\n  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}