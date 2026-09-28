// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 带框线配置的表格节点：在官方 Table 扩展上加一个 borders 属性，
// 把 `:::table{borders=…}` 容器的 bd-* 类读成属性、再渲染回同样的类，
// 这样编辑器里的表格观感与前台一致，保存时（turndown）再包回容器。

import { Table, TableView } from '@tiptap/extension-table';
import { mergeAttributes } from '@tiptap/core';
import { bordersFromSpec, serializeTableBorders, tableBordersFromClass, tableBorderClasses } from './table-borders.ts';

/** 所有由框线配置产生的类名（更新时先清掉再加，避免残留） */
const BORDER_CLASS_RE = /^bd-(reset|top|bottom|left|right|innerH|innerV)$/;

function applyBorderClasses(table: HTMLTableElement, spec: unknown): void {
  for (const c of [...table.classList]) if (BORDER_CLASS_RE.test(c)) table.classList.remove(c);
  const cls = tableBorderClasses(bordersFromSpec(spec));
  if (cls.length) table.classList.add(...cls);
}

/**
 * TableView 只在构造时套用一次 HTMLAttributes，节点属性变化（框线）不会更新 DOM，
 * 导致编辑器里的预览不跟手；这里重写 update，把 bd-* 类同步上去。
 */
class BorderedTableView extends TableView {
  constructor(
    node: Parameters<TableView['update']>[0],
    cellMinWidth: number,
    view: never,
    HTMLAttributes: Record<string, unknown>,
  ) {
    super(node, cellMinWidth, view, HTMLAttributes);
    applyBorderClasses(this.table, node.attrs.borders);
  }
  update(node: Parameters<TableView['update']>[0]): boolean {
    if (!super.update(node)) return false;
    applyBorderClasses(this.table, node.attrs.borders);
    return true;
  }
}

export const BorderedTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /** '' = 默认（全部框线，不加类）；'none' / 'top,innerH' 等 = 已配置 */
      borders: {
        default: '',
        parseHTML: (el) => {
          const section = (el as HTMLElement).closest('.blk-table');
          if (!section) return '';
          return serializeTableBorders(tableBordersFromClass(section.className));
        },
        renderHTML: (attrs) => {
          const cls = tableBorderClasses(bordersFromSpec(attrs.borders));
          return cls.length ? { class: cls.join(' ') } : {};
        },
      },
    };
  },
  addNodeView() {
    const { cellMinWidth, HTMLAttributes } = this.options;
    return ({ node, view, HTMLAttributes: nodeAttributes }) =>
      new BorderedTableView(node, cellMinWidth, view as never, mergeAttributes(HTMLAttributes, nodeAttributes));
  },
});
