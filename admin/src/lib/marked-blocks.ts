// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 编辑器侧的 Markdown → HTML：必须与核心共用同一份排版块扩展，
// 否则 `:::callout` 在可视化编辑器里会退化成一行普通文字（前端却渲染成块）。

import { marked } from 'marked';
import { prBlockExtension, renderAlignedInline } from '../../../src/core/marked-blocks.ts';

marked.use({ extensions: [prBlockExtension] });

/** Markdown → HTML（含排版块），供编辑器载入内容与源码模式回切使用 */
export function mdToHtml(md: string): string {
  // 与前台渲染同口径：对齐段落是原始 HTML 块，内层要补一次行内解析，
  // 否则编辑器里会看到 `_斜体_` 原样的下划线
  return renderAlignedInline(marked.parse(md) as string, (inner) => marked.parseInline(inner) as string);
}
