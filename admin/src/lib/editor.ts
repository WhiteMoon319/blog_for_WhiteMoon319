// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import TurndownService from 'turndown';
import { registerPrBlockTurndown } from './tiptap-blocks.ts';
import { serializeTableBorders, tableBordersFromClass } from './table-borders.ts';

// 段落/标题对齐：Tiptap 的 TextAlign 落在内联 style 上，turndown 默认会丢掉，
// 这里回写成等价的 HTML，保证「可视化点居中 → 保存 → 重开/前台渲染」不丢对齐。
const ALIGN_ATTR_RE = /text-align\s*:\s*(left|center|right)/i;
function alignedBlock(node: HTMLElement): 'left' | 'center' | 'right' | null {
  const m = ALIGN_ATTR_RE.exec(node.getAttribute('style') ?? '');
  return m ? (m[1].toLowerCase() as 'left' | 'center' | 'right') : null;
}

// 表格：turndown 默认没有表格规则，会把 <table> 当成普通区块压成几行纯文本（结构全丢）。
// 这里补一条 GFM 表格规则，并按表头单元格的对齐还原 `:-- / :-: / --:`。
type CellAlign = 'left' | 'center' | 'right' | null;
function cellAlign(el: Element): CellAlign {
  const fromStyle = alignedBlock(el as HTMLElement);
  if (fromStyle) return fromStyle;
  const attr = (el.getAttribute('align') ?? '').toLowerCase();
  return attr === 'left' || attr === 'center' || attr === 'right' ? attr : null;
}
function gfmCell(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}
function cellsOf(row: Element): Element[] {
  return Array.from(row.children).filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH');
}
function tableToGfm(node: HTMLElement): string {
  const rows = Array.from(node.querySelectorAll('tr'));
  if (rows.length === 0) return '';
  // GFM 必须有表头行；无 <th> 时沿用首行（标准做法的取舍）
  const header = cellsOf(rows[0]);
  const body = rows.slice(1);
  const sep = header.map((c) => {
    const a = cellAlign(c);
    return a === 'center' ? ':--:' : a === 'right' ? '--:' : a === 'left' ? ':--' : '---';
  });
  const lines = [
    `| ${header.map(gfmCell).join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${cellsOf(r).map(gfmCell).join(' | ')} |`),
  ];
  return `\n\n${lines.join('\n')}\n\n`;
}

export function createTurndown(): TurndownService {
  const service = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  service.addRule('alignedBlock', {
    filter: (node) => /^(P|H[1-6])$/.test(node.nodeName) && alignedBlock(node as HTMLElement) !== null,
    replacement: (content, node) => {
      const align = alignedBlock(node as HTMLElement);
      const tag = node.nodeName.toLowerCase();
      // 左对齐即默认排版，不必写 HTML（避免把普通段落也变成标签）
      if (!align || align === 'left' || !content.trim()) return `\n\n${content}\n\n`;
      return `\n\n<${tag} style="text-align:${align}">${content}</${tag}>\n\n`;
    },
  });
  service.addRule('gfmTable', {
    filter: 'table',
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const md = tableToGfm(el);
      // 非默认框线：包回 `:::table{borders=…}` 容器，否则纯 GFM（老文件保持干净）
      const spec = serializeTableBorders(tableBordersFromClass(el.getAttribute('class') ?? ''));
      if (!spec) return md;
      return `\n\n:::table{borders=${spec}}\n${md.trim()}\n:::\n\n`;
    },
  });
  // 排版块（:::block）必须能回写，否则保存一次就被剥掉
  return registerPrBlockTurndown(service);
}

// 编辑器不支持的结构提示：表格与代码块已支持，仅提示无法在 WYSIWYG 中编辑的块级布局/脚本 HTML，
// 避免往返后静默丢失
const RAW_HTML_RE = /<(div|details|section|article|aside|header|footer|nav|main|figure|dl|iframe|style|script|form)[\s>]/i;

export function checkContentRisk(md: string): string {
  if (RAW_HTML_RE.test(md)) return '正文包含块级 HTML（布局/脚本标签等），编辑器会剥掉这些结构，保存后内容可能改变。';
  return '';
}