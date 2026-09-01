// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// Classic（纸墨）主题自带词典：词汇归主题，机制见 @core/i18n。
import { makeT, type Locale, type TFunc } from '@core/i18n';

const zhCN: Record<string, string> = {
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
  'post.font_scale': '字号',
  'post.font_smaller': '减小字号',
  'post.font_default': '重置字号',
  'post.font_larger': '增大字号',
  'post.read_progress': '已读',
  'home.history_kicker': '历 史',
  'home.history_title': '历史记录',
  'home.history_lead': '自上次搁笔处，接续来读。',
};

const en: Record<string, string> = {
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
  'post.font_scale': 'Font size',
  'post.font_smaller': 'Decrease font size',
  'post.font_default': 'Reset font size',
  'post.font_larger': 'Increase font size',
  'post.read_progress': 'Read ',
  'home.history_kicker': 'History',
  'home.history_title': 'Reading History',
  'home.history_lead': 'Continue where you left off.',
};

export const CLASSIC_DICTS: Record<Locale, Record<string, string>> = { 'zh-CN': zhCN, en };

/** Classic 主题的 t：按站点 locale 取词 */
export function classicT(locale: Locale): TFunc {
  return makeT(locale, CLASSIC_DICTS);
}
