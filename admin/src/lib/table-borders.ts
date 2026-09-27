// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 表格框线的编辑器侧适配：与核心（src/core/marked-blocks.ts）共用同一套边名与规范化逻辑，
// 只在外面加一层「属性字符串 ↔ 边集合」的转换，供 Tiptap 表格节点与框线菜单使用。

import {
  TABLE_BORDERS,
  parseTableBorders,
  serializeTableBorders,
  tableBorderClasses,
  tableBordersFromClass,
  type TableBorder,
} from '../../../src/core/marked-blocks.ts';

export { TABLE_BORDERS, serializeTableBorders, tableBordersFromClass, tableBorderClasses };
export type { TableBorder };

/** 边集合 → 编辑器里表格节点上挂的 class（与前台同一套类名，保证所见即所得） */
export function previewClasses(borders: readonly TableBorder[]): string[] {
  return tableBorderClasses(borders);
}

/** 节点属性（'' = 默认全框线 / 'none' / 'top,innerH'…）→ 边集合 */
export function bordersFromSpec(spec: unknown): TableBorder[] {
  const s = typeof spec === 'string' ? spec.trim() : '';
  if (!s) return [...TABLE_BORDERS];
  return parseTableBorders(`borders=${s}`);
}

/** 边集合 → 节点属性字符串 */
export function specFromBorders(borders: readonly TableBorder[]): string {
  return serializeTableBorders(borders);
}

/** 供框线菜单：预设与逐边开关的展示元数据 */
export const BORDER_PRESETS: Array<{ value: string; label: string }> = [
  { value: 'none', label: '无框线' },
  { value: 'all', label: '全部' },
  { value: 'outer', label: '仅外框' },
  { value: 'rows', label: '仅横线' },
  { value: 'cols', label: '仅竖线' },
];

export const BORDER_TOGGLES: Array<{ value: TableBorder; label: string }> = [
  { value: 'top', label: '上' },
  { value: 'bottom', label: '下' },
  { value: 'left', label: '左' },
  { value: 'right', label: '右' },
  { value: 'innerH', label: '内横' },
  { value: 'innerV', label: '内竖' },
];
