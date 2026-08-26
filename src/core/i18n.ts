// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// i18n 机制的 @core 出口（纯净层允许的主题导入路径）。词典由各主题自带。

export { LOCALES, DEFAULT_LOCALE, isLocale, ogLocale, makeT } from '../lib/i18n.ts';
export type { Locale, TFunc } from '../lib/i18n.ts';
