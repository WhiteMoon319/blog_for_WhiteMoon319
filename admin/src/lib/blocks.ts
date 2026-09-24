// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 排版块元数据（编辑器侧单一来源）：名称/变体/文案/是否空块。
// 与核心解析器（src/lib/markdown.ts）的 BLOCK_VARIANTS 必须一致，
// 由 tests/blocks-contract.test.ts 断言两者同步。

export interface BlockDef {
  /** 语法名，对应 `:::name` 与 `.blk-name` */
  name: string;
  /** 抽屉里的中文名 */
  label: string;
  /** 一句话说明（新手提示） */
  hint: string;
  /** 变体：值 → 中文名；空数组表示无变体 */
  variants: Array<{ value: string; label: string }>;
  /** 空块（不承载文字，如分割线） */
  empty?: boolean;
  /** 抽屉分组 */
  group: '强调' | '结构' | '图文' | '收尾';
  /** 是否有内容区（空块无） */
  content: boolean;
}

export const BLOCKS: BlockDef[] = [
  {
    name: 'callout',
    label: '提示卡',
    hint: '提醒、注意事项、结论',
    group: '强调',
    content: true,
    variants: [
      { value: 'info', label: '信息' },
      { value: 'success', label: '成功' },
      { value: 'warning', label: '注意' },
      { value: 'danger', label: '警告' },
    ],
  },
  {
    name: 'highlight',
    label: '强调段落',
    hint: '把一段话底色标出',
    group: '强调',
    content: true,
    variants: [
      { value: 'yellow', label: '黄底' },
      { value: 'gradient', label: '渐变底' },
    ],
  },
  {
    name: 'quote',
    label: '引用 / 金句',
    hint: '引言、摘录、金句',
    group: '强调',
    content: true,
    variants: [],
  },
  {
    name: 'divider',
    label: '分割线',
    hint: '划分章节（细线 / 点阵 / 留白）',
    group: '结构',
    content: false,
    empty: true,
    variants: [
      { value: 'line', label: '细线' },
      { value: 'dots', label: '点阵' },
      { value: 'space', label: '留白' },
    ],
  },
  {
    name: 'steps',
    label: '步骤',
    hint: '教程与操作步骤（有序列表即可）',
    group: '结构',
    content: true,
    variants: [],
  },
  {
    name: 'card',
    label: '卡片',
    hint: '并列要点，一段一张卡',
    group: '结构',
    content: true,
    variants: [],
  },
  {
    name: 'caption',
    label: '图注',
    hint: '图片下方的说明文字',
    group: '图文',
    content: true,
    variants: [],
  },
  {
    name: 'cta',
    label: '文末引导',
    hint: '引导关注、阅读下一篇',
    group: '收尾',
    content: true,
    variants: [],
  },
];

export const BLOCK_GROUPS: BlockDef['group'][] = ['强调', '结构', '图文', '收尾'];

export function findBlock(name: string): BlockDef | undefined {
  return BLOCKS.find((b) => b.name === name);
}

/** 块 + 变体 → class 字符串（与核心解析器渲染结果一致） */
export function blkClass(name: string, variant = ''): string {
  return `blk blk-${name}${variant ? ` is-${variant}` : ''}`;
}

/** 从 class 字符串反解出块名与变体（turndown 与粘贴解析共用） */
export function parseBlkClass(className: string): { name: string; variant: string } {
  const name = /(?:^|\s)blk-([a-z0-9-]+)/.exec(className)?.[1] ?? '';
  const def = findBlock(name);
  const variant = /(?:^|\s)is-([a-z0-9-]+)/.exec(className)?.[1] ?? '';
  const valid = def?.variants.some((v) => v.value === variant) ? variant : '';
  return { name, variant: valid };
}

/**
 * 序列化为 Markdown 语法（turndown 规则用）。
 * 空块（分割线）不写内容行，保证与解析器「空块」形态一致。
 */
export function serializeBlk(className: string, innerMarkdown: string): string {
  const { name, variant } = parseBlkClass(className);
  if (!name) return innerMarkdown;
  const head = variant ? `:::${name}{type=${variant}}` : `:::${name}`;
  const inner = innerMarkdown.trim();
  return inner ? `\n\n${head}\n${inner}\n:::\n\n` : `\n\n${head}\n:::\n\n`;
}
