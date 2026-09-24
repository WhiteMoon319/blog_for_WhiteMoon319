// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 排版块的 Tiptap 节点：让所见即所得编辑器能承载 `:::block` 结构而不被剥掉。
// 单一节点承载全部块，块名与变体存 attrs，渲染成与核心解析器一致的 `.blk-*` DOM。

import { Node, mergeAttributes } from '@tiptap/core';
import type TurndownService from 'turndown';
import { blkClass, parseBlkClass, serializeBlk, findBlock } from './blocks.ts';

export interface PrBlockAttrs {
  block: string;
  variant: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    prBlock: {
      /** 插入排版块（可选带内容），光标置入块内 */
      insertPrBlock: (attrs: PrBlockAttrs, content?: string) => ReturnType;
      /** 改变当前/选中块的块名或变体 */
      setPrBlockVariant: (variant: string) => ReturnType;
      /** 拆掉块外壳，保留内容 */
      unwrapPrBlock: () => ReturnType;
    };
  }
}

export const PrBlock = Node.create({
  name: 'prBlock',
  group: 'block',
  // 空块（分割线）允许无内容，故用 block*
  content: 'block*',
  defining: true,
  selectable: true,

  addAttributes() {
    return {
      block: {
        default: 'callout',
        parseHTML: (el) => parseBlkClass(el.getAttribute('class') ?? '').name || 'callout',
      },
      variant: {
        default: '',
        parseHTML: (el) => parseBlkClass(el.getAttribute('class') ?? '').variant,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'section',
        getAttrs: (el) => {
          const cls = (el as HTMLElement).getAttribute('class') ?? '';
          const { name } = parseBlkClass(cls);
          // 只接管排版块，其它 section 交回通用块处理
          return name ? {} : false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const block = String(node.attrs.block ?? 'callout');
    const variant = String(node.attrs.variant ?? '');
    const def = findBlock(block);
    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        class: blkClass(block, variant),
        'data-blk': block,
        'data-variant': variant || undefined,
        role: def?.empty ? 'separator' : undefined,
        'aria-hidden': def?.empty ? 'true' : undefined,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      insertPrBlock:
        (attrs, content = '') =>
        ({ chain }) => {
          const def = findBlock(attrs.block);
          const inner = def?.empty ? '' : content;
          return chain()
            .insertContent({
              type: this.name,
              attrs,
              content: inner ? [{ type: 'paragraph', content: [{ type: 'text', text: inner }] }] : [],
            })
            .run();
        },
      setPrBlockVariant:
        (variant) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { variant }),
      unwrapPrBlock:
        () =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          let target: { pos: number; size: number } | null = null;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!target && node.type.name === this.name) target = { pos, size: node.nodeSize };
          });
          if (!target || !dispatch) return false;
          const range = target as { pos: number; size: number };
          // 用容器内部区间构造切片，替换掉整个块（外壳拆掉、内容留下）
          const inner = state.doc.slice(range.pos + 1, range.pos + range.size - 1);
          tr.replaceWith(range.pos, range.pos + range.size, inner.content);
          dispatch(tr);
          return true;
        },
    };
  },
});

/**
 * turndown 规则：把 `.blk-*` 的 section 序列化回 `:::block` 语法。
 * 与核心解析器双向对应，是「保存后不丢块」的关键。
 */
export function registerPrBlockTurndown(turndown: TurndownService): TurndownService {
  turndown.addRule('prBlock', {
    filter: (node) =>
      node.nodeName === 'SECTION' &&
      (node.getAttribute('class') ?? '').split(/\s+/).some((c) => c.startsWith('blk-')),
    replacement: (content, node) => serializeBlk(node.getAttribute('class') ?? '', content),
  });
  return turndown;
}
