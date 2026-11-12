// 紫枫文学社 · robots.txt（随 SITE_URL 生成，避免写死域名）
//
// 为什么不做成 public/robots.txt 静态文件：
//   主题/站点换域名后，静态文件里的 Sitemap 会一直指向旧域，
//   搜索引擎拿到的 sitemap 地址是错的（跨域且内容不同）。
//   这里同 feed.xml / sitemap.xml 一样读 SITE_URL，一份代码多站点复用。
import type { APIContext } from 'astro';
import { envOf } from '../lib/db';

export const prerender = false;

/**
 * 把 SITE_URL 规范化成「可以安全拼路径」的基址。
 *
 * 直接用字符串拼 `/sitemap.xml` 有三个坑：
 *   1. 带 query/fragment → 拼出 `https://a.com/?x=1/sitemap.xml` 这种畸形地址；
 *   2. 只是「长得像 URL」（http:// 开头但主机名乱写）→ 正则放行，输出错域；
 *   3. 尾斜杠/大小写不规范 → 拼出双斜杠或重复路径。
 * 交给 URL 解析器：协议非法、解析失败一律返回 null，让调用方整行省略 Sitemap
 * ——宁可少一条，不给爬虫错地址。
 *
 * 保留 pathname 而非只取 origin：站点可能部署在子路径（https://a.com/blog），
 * 此时 /sitemap.xml 路由也在子路径下，丢掉 pathname 会指向错位置。
 */
function siteBase(raw: string | undefined): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const path = u.pathname.replace(/\/+$/, ''); // 去尾斜杠（含根路径的单个 /）
    return u.origin + path;
  } catch {
    return null;
  }
}

/**
 * 不该被索引的路径，分两类处理——这不是形式主义，是检索行为决定的：
 *
 * 【A 类：只 Disallow】后台、接口、预览、写作区
 *   都在登录墙后，爬虫进来只会拿到重定向或空壳，白耗配额。
 *   它们的响应头本身已带 `X-Robots-Tag: noindex`（见 admin/write 路由），
 *   即使被 Disallow、爬虫读不到 noindex，也不会因为「被爬到」而进索引。
 *
 * 【B 类：不 Disallow，只靠 noindex】
 *   登录、注册、退出、验证邮箱这几页是公开可访问的，模板里已传 `noindex`
 *   （BaseLayout → SiteHead 输出 `<meta name="robots" content="noindex">`）。
 *   若在这里 Disallow，爬虫反而读不到那条 noindex：一旦这些 URL 在规则生效前
 *   被外链带进过索引，它就只能看到「禁止抓取」，无法确认「不该收录」，
 *   于是长期以「仅 URL 无摘要」的形态留在结果里。放开抓取、让 noindex 生效，
 *   才是把它们真正踢出索引的路径。
 */
const DISALLOW_PATHS = ['/admin', '/api', '/preview', '/write', '/account'];

export async function GET(_ctx: APIContext): Promise<Response> {
  const env = await envOf();

  // 口径与 SiteContext 一致：后台设置项优先，其次 env（见 theme-context.ts 的 pick()）。
  // 只读 env 会漏掉「后台改了站点地址」的情况——那正是 Sitemap 最需要跟随的变化。
  let entries: Record<string, string> = {};
  try {
    const { getAllSettings } = await import('../lib/db/settings');
    entries = await getAllSettings(env.DB);
  } catch {
    // settings 表不可用（迁移前的全新库）时按纯 env 回退
  }
  const siteUrl = (entries['SITE_URL'] || '').trim() || env.SITE_URL;
  const base = siteBase(siteUrl);

  const lines = ['User-agent: *', 'Allow: /', '', '# 登录墙后：无需抓取'];
  // robots 的 Disallow 是「路径前缀」匹配，不是整段匹配：
  // 单写 `/write` 会连带封掉将来可能出现的 /writers/ 这类公开路径。
  // `$` 锚定裸路径本身（Google/Bing 支持），再加一条带斜杠的覆盖子路径；
  // 不支持 `$` 的爬虫会忽略那条，`/xxx/` 仍然生效，不会漏出私有区。
  for (const p of DISALLOW_PATHS) lines.push(`Disallow: ${p}$`, `Disallow: ${p}/`);
  // 登录/注册/退出/验证邮箱：故意不 Disallow，靠页面自身的 noindex 生效
  lines.push('# /login /register /logout /verify-email 依赖页面 noindex，故此处放开抓取', '');

  // Sitemap 必须是绝对地址；拿不到合法基址时整行省略
  if (base) lines.push(`Sitemap: ${base}/sitemap.xml`, '');

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
