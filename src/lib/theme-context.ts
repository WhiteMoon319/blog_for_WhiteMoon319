// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 主题数据契约：SiteContext 由核心页面壳经 getSiteContext() 组装，props 下传给主题模板。
// 引擎契约版本：主题 theme.json 的 engine_version 应与此处一致。
export const ENGINE_VERSION = '1';

import type { APIContext } from 'astro';
import { envOf } from './db/index.ts';
import { resolveUser } from './auth.ts';
import { getAllSettings } from './db/settings.ts';
import { DEFAULT_LOCALE, isLocale, type Locale } from './i18n.ts';

export interface SiteUser {
  loggedIn: boolean;
  name: string;
  isAdmin: boolean;
  emailVerified: boolean;
}

/** 路由键是核心契约，词汇由主题按 key 自行翻译（见各主题 i18n 字典） */
export interface NavLink {
  key: 'home' | 'archive' | 'tags' | 'search' | 'about';
  href: string;
}

export interface SiteContext {
  siteName: string;
  siteUrl: string;
  /** 站点口号（SITE_SLOGAN 链） */
  slogan: string;
  /** 页脚文案行（copy.footer_line ?? SITE_POEM） */
  footerLine: string;
  /** 默认 meta 描述（copy.site_tagline） */
  tagline: string;
  searchPlaceholder: string;
  /** 首页可选题记位（copy.hero_note），空串表示不展示 */
  heroNote: string;
  locale: Locale;
  user: SiteUser;
  nav: NavLink[];
  /** R2 公开基址（尾斜杠剥离），供评论图片等使用 */
  r2Base: string;
}

/** 文案键 → 内置默认值。回退链：settings 表 → 同名 Workers 变量 → 此默认 */
export const COPY_DEFAULTS = {
  site_tagline: '一座写在 Cloudflare 上的小书斋。',
  footer_line: '',
  search_placeholder: '',
  hero_note: '',
} as const;

function firstNonEmpty(...vals: (string | undefined)[]): string {
  for (const v of vals) if (v && v.trim()) return v;
  return '';
}

/**
 * 组装站点上下文：每页面壳调用一次，结果经 props 下传。
 * 主题组件禁止自行访问 DB/env——一律消费此处的字段。
 */
export async function getSiteContext(ctx: APIContext): Promise<SiteContext> {
  try {
    return await buildSiteContext(ctx);
  } catch (e) {
    // 上下文组装失败时降级为最小可用上下文，保证页面仍可渲染（与计划的降级保障一致）
    console.error('[theme-context] build failed:', e);
    return {
      siteName: 'blog', siteUrl: '', slogan: '', footerLine: '',
      tagline: COPY_DEFAULTS.site_tagline, searchPlaceholder: '', heroNote: '',
      locale: DEFAULT_LOCALE,
      user: { loggedIn: false, name: '', isAdmin: false, emailVerified: false },
      nav: [], r2Base: '',
    };
  }
}

async function buildSiteContext(ctx: APIContext): Promise<SiteContext> {
  const env = await envOf();
  let entries: Record<string, string> = {};
  try {
    entries = await getAllSettings(env.DB);
  } catch {
    // settings 表不可用时按纯 env 回退（如迁移前的全新库）
  }
  const pick = (key: string, envVal: string | undefined, fallback: string): string =>
    firstNonEmpty(entries[key], envVal, fallback);

  const localeRaw = firstNonEmpty(entries['site_locale'], '');
  const locale: Locale = isLocale(localeRaw) ? localeRaw : DEFAULT_LOCALE;

  const raw = ctx.cookies.get('blog_session')?.value ? await resolveUser(ctx) : null;
  const user: SiteUser = raw
    ? {
        loggedIn: true,
        name: raw.user.display_name || raw.user.username,
        isAdmin: raw.user.role === 'admin',
        emailVerified: raw.emailVerified,
      }
    : { loggedIn: false, name: '', isAdmin: false, emailVerified: false };

  return {
    siteName: pick('SITE_NAME', env.SITE_NAME, '我的书房'),
    siteUrl: (pick('SITE_URL', env.SITE_URL, '')).replace(/\/+$/, ''),
    slogan: pick('SITE_SLOGAN', env.SITE_SLOGAN, ''),
    footerLine: pick('footer_line', env.FOOTER_LINE, '') || pick('SITE_POEM', env.SITE_POEM, '月下少辞令，醉后自逍遥。'),
    tagline: pick('site_tagline', env.SITE_TAGLINE, COPY_DEFAULTS.site_tagline),
    searchPlaceholder: pick('search_placeholder', env.SEARCH_PLACEHOLDER, ''),
    heroNote: pick('hero_note', env.HERO_NOTE, ''),
    locale,
    user,
    nav: [
      { key: 'home', href: '/' },
      { key: 'archive', href: '/archive/' },
      { key: 'tags', href: '/tags/' },
      { key: 'search', href: '/search/' },
      { key: 'about', href: '/about/' },
    ],
    r2Base: (env.R2_PUBLIC_URL || '').replace(/\/+$/, ''),
  };
}
