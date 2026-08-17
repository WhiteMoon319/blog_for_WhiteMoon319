import type { APIContext } from 'astro';
import { envOf, getCollectionsByIds, listCollections, listPublishedPosts } from '../lib/db';
import { postHref } from '../lib/utils';

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  const base = env.SITE_URL.replace(/\/$/, '');
  const collections = await listCollections(env.DB);
  const posts = await listPublishedPosts(env.DB);
  const collectionById = await getCollectionsByIds(env.DB, posts.map((p) => p.collection_id ?? 0));

  const urls = ['/', '/archive/', '/about/', '/search/'].map((path) => ({
    path,
    lastmod: undefined as string | undefined,
  }));

  for (const c of collections) {
    urls.push({ path: `/collections/${encodeURI(c.slug)}/`, lastmod: c.updated_at });
  }
  for (const p of posts) {
    const collection = p.collection_id ? collectionById.get(p.collection_id) : undefined;
    urls.push({ path: postHref(p.slug, collection?.slug), lastmod: p.updated_at });
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