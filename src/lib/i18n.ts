// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// i18n 机制层（无词典）：站点 locale 的解析与 t() 工厂。
// 词汇归各主题所有——主题在自身目录维护字典（见 themes/classic/i18n.ts），经 @core/i18n 引用机制。

export const LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh-CN';

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}

/** og:locale 等场景的映射 */
export function ogLocale(locale: Locale): string {
  return locale === 'zh-CN' ? 'zh_CN' : 'en_US';
}

type Dict = Record<string, string>;

export type TFunc = (key: string, params?: Record<string, string | number>) => string;

/**
 * t 工厂：缺 key 时回退 zh-CN，再缺则原样返回 key（便于发现遗漏）。
 * 主题用法：const t = makeT(ctx.locale, MY_DICTS);
 */
export function makeT(locale: Locale, dicts: Record<Locale, Dict>): TFunc {
  const dict = dicts[locale] ?? dicts[DEFAULT_LOCALE] ?? {};
  const fallback = dicts[DEFAULT_LOCALE] ?? {};
  return (key, params) => {
    let s = dict[key] ?? fallback[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
    }
    return s;
  };
}
