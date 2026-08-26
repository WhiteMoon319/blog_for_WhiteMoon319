// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 站点级 i18n：字典 + t() 工厂。v1 仅站点级单语言（无 per-user / URL 前缀）。

export const LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh-CN';

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}

/** og:locale 等场景的映射 */
export function htmlLang(locale: Locale): string {
  return locale;
}

export function ogLocale(locale: Locale): string {
  return locale === 'zh-CN' ? 'zh_CN' : 'en_US';
}

type Dict = Record<string, string>;

const zhCN: Dict = {
  'nav.home': '卷首',
  'nav.archive': '归档',
  'nav.tags': '标签',
  'nav.search': '寻章',
  'nav.about': '关于',
  'a11y.skip': '跳至正文',
  'a11y.open_menu': '打开菜单',
  'a11y.site_search': '站内搜索',
  'a11y.back_top': '返回顶部',
  'rss.title': 'RSS 订阅',
  'footer.login': '登录',
  'footer.admin': '后台',
  'footer.logout': '退出',
};

const en: Dict = {
  'nav.home': 'Home',
  'nav.archive': 'Archive',
  'nav.tags': 'Tags',
  'nav.search': 'Search',
  'nav.about': 'About',
  'a11y.skip': 'Skip to content',
  'a11y.open_menu': 'Open menu',
  'a11y.site_search': 'Search this site',
  'a11y.back_top': 'Back to top',
  'rss.title': 'RSS Feed',
  'footer.login': 'Sign in',
  'footer.admin': 'Admin',
  'footer.logout': 'Sign out',
};

const DICTS: Record<Locale, Dict> = { 'zh-CN': zhCN, en };

export type TFunc = (key: string, params?: Record<string, string | number>) => string;

/** 缺 key 时回退 zh-CN，再缺则原样返回 key（便于发现遗漏） */
export function makeT(locale: Locale): TFunc {
  const dict = DICTS[locale] ?? zhCN;
  return (key, params) => {
    let s = dict[key] ?? zhCN[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
    }
    return s;
  };
}
