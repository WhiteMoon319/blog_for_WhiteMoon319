// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 主题可用的纯函数白名单（无 DB / env 访问）。经 @core/utils 引用。

export { postHref } from '../lib/utils.ts';
export { fmtDate, yearOf } from '../lib/db/utils.ts';
