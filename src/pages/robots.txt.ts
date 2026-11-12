// 紫枫文学社 · robots.txt（随 SITE_URL 生成，避免写死域名）
//
// 为什么不做成 public/robots.txt 静态文件：
//   主题/站点换域名后，静态文件里的 Sitemap 会一直指向旧域，
//   搜索引擎拿到的 sitemap 地址是错的（跨域且内容不同）。
//   这里同 feed.xml / sitemap.xml 一样读 env.SITE_URL，一份代码多站点复用。
import type { APIContext } from 'astro';
import { envOf } from '../lib/db';

export const prerender = false;

export async function GET(_ctx: APIContext): Promise<Response> {
  const env = await envOf();
  const base = (env.SITE_URL || '').replace(/\/+$/, '');
  const hasBase = /^https?:\/\//i.test(base);

  const lines = [
    'User-agent: *',
    'Allow: /',
    // 后台、接口、预览、账号相关都不该被索引
    'Disallow: /admin',
    'Disallow: /api',
    'Disallow: /preview',
    'Disallow: /write',
    'Disallow: /account',
    'Disallow: /login',
    'Disallow: /register',
    'Disallow: /logout',
    'Disallow: /verify-email',
    '',
  ];

  // Sitemap 必须用绝对地址；SITE_URL 缺失时宁可整行省略，也不写出一个错域
  if (hasBase) lines.push(`Sitemap: ${base}/sitemap.xml`, '');

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
