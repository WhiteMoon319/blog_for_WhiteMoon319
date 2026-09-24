// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 排版块（站内公众号式排版）的 Markdown 解析：`:::name{type=variant}` … `:::`。
// 核心与编辑器共用同一份实现（编辑器经 admin/src/lib/marked-blocks.ts 注册到自己的 marked 实例），
// 否则会出现「前台渲染出块、编辑器里却是一行文字」的两端不一致。
// 只依赖 marked 类型，不触碰 DB / env / node，可被 worker 与浏览器两侧打包。

import type { Tokens } from 'marked';

/** 块名 → 允许的变体（空数组表示无变体）。编辑器侧的元数据见 admin/src/lib/blocks.ts，由契约测试保证一致 */
export const BLOCK_VARIANTS: Record<string, string[]> = {
  callout: ['info', 'success', 'warning', 'danger'],
  highlight: ['yellow', 'gradient'],
  divider: ['line', 'dots', 'space'],
  quote: [],
  steps: [],
  caption: [],
  card: [],
  cta: [],
};

/** 空块：自身不承载文字，渲染成无内容的分隔元素 */
export const EMPTY_BLOCKS = new Set(['divider']);

const BLOCK_OPEN_RE = /^:::[ \t]*([a-z][a-z0-9-]*)[ \t]*(?:\{([^}\n]*)\})?[ \t]*\r?\n/;
// 闭合标记可紧贴开块（空块，如 `:::divider` 后直接 `:::`），也可另起一行
const BLOCK_CLOSE_RE = /(?:^|\r?\n):::[ \t]*(?=\r?\n|$)/;

/** 从 `type=warning` / `style=dots` / `variant=success` 中取出合法变体；非法或缺失返回空串 */
export function parseBlockVariant(name: string, attrs: string | undefined): string {
  const allowed = BLOCK_VARIANTS[name] ?? [];
  if (!attrs || allowed.length === 0) return '';
  for (const pair of attrs.split(/[\s,]+/).filter(Boolean)) {
    const [rawKey, rawVal] = pair.split('=');
    const key = (rawKey ?? '').trim().toLowerCase();
    const val = (rawVal ?? '').trim().toLowerCase();
    if (!['type', 'style', 'variant'].includes(key)) continue;
    if (allowed.includes(val)) return val;
  }
  return '';
}

interface PrBlockToken extends Tokens.Generic {
  type: 'prBlock';
  block: string;
  variant: string;
  tokens: Tokens.Generic[];
}

/**
 * marked 块级扩展：把 `:::` 容器解析为 `<section class="blk blk-*">`。
 * 未闭合或未知块名一律降级（返回 undefined / 只保留内容），绝不吞正文。
 */
export const prBlockExtension = {
  name: 'prBlock',
  level: 'block' as const,
  start(src: string): number | undefined {
    const idx = src.search(/^:::/m);
    return idx === -1 ? undefined : idx;
  },
  tokenizer(this: { lexer: { blockTokens: (src: string, tokens: Tokens.Generic[]) => Tokens.Generic[] } }, src: string) {
    const open = BLOCK_OPEN_RE.exec(src);
    if (!open) return undefined;
    const name = open[1].toLowerCase();
    const body = src.slice(open[0].length);
    const close = BLOCK_CLOSE_RE.exec(body);
    // 未闭合：交回普通解析，正文照常渲染
    if (!close) return undefined;
    const inner = body.slice(0, close.index);
    const raw = open[0] + body.slice(0, close.index + close[0].length);
    const token: PrBlockToken = {
      type: 'prBlock',
      raw,
      block: name,
      variant: parseBlockVariant(name, open[2]),
      tokens: this.lexer.blockTokens(inner, []),
    };
    return token;
  },
  renderer(this: { parser: { parse: (tokens: Tokens.Generic[]) => string } }, token: PrBlockToken): string {
    const inner = EMPTY_BLOCKS.has(token.block) ? '' : this.parser.parse(token.tokens);
    // 未知块名：只保留内容，不生成任意 class（避免正文注入样式锚点）
    if (!(token.block in BLOCK_VARIANTS)) return inner;
    const variantClass = token.variant ? ` is-${token.variant}` : '';
    if (EMPTY_BLOCKS.has(token.block)) {
      return `<section class="blk blk-${token.block}${variantClass}" role="separator" aria-hidden="true"></section>`;
    }
    return `<section class="blk blk-${token.block}${variantClass}">${inner}</section>`;
  },
};
