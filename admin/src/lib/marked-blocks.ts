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
import { prBlockExtension } from '../../../src/core/marked-blocks.ts';

marked.use({ extensions: [prBlockExtension] });

/** Markdown → HTML（含排版块），供编辑器载入内容与源码模式回切使用 */
export function mdToHtml(md: string): string {
  return marked.parse(md) as string;
}
