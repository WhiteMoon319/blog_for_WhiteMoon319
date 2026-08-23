// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import TurndownService from 'turndown';

export function createTurndown(): TurndownService {
  return new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
}

// 编辑器不支持的结构提示：表格与代码块已支持，仅提示无法在 WYSIWYG 中编辑的块级布局/脚本 HTML，
// 避免往返后静默丢失
const RAW_HTML_RE = /<(div|details|section|article|aside|header|footer|nav|main|figure|dl|iframe|style|script|form)[\s>]/i;

export function checkContentRisk(md: string): string {
  if (RAW_HTML_RE.test(md)) return '正文包含块级 HTML（布局/脚本标签等），编辑器会剥掉这些结构，保存后内容可能改变。';
  return '';
}