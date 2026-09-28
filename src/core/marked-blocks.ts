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
  // 表格容器：承载框线配置（`:::table{borders=…}`），变体由 borders 属性表达
  table: [],
};

/** 表格框线的六个开关（外边四条 + 内部横/竖线），数组顺序即 class 与序列化的固定顺序 */
export const TABLE_BORDERS = ['top', 'bottom', 'left', 'right', 'innerH', 'innerV'] as const;
export type TableBorder = (typeof TABLE_BORDERS)[number];

/** 预设 → 边集合；`all` 即现状默认 */
const BORDER_PRESETS: Record<string, readonly TableBorder[]> = {
  all: TABLE_BORDERS,
  none: [],
  outer: ['top', 'bottom', 'left', 'right'],
  rows: ['top', 'bottom', 'innerH'],
  cols: ['left', 'right', 'innerV'],
};

const BORDER_NAMES = new Set<string>(TABLE_BORDERS);
/** 小写 → 规范边名（`innerh` / `innerH` 都认） */
const BORDER_BY_LOWER = new Map<string, TableBorder>(TABLE_BORDERS.map((b) => [b.toLowerCase(), b]));
const sameBorders = (a: readonly TableBorder[], b: readonly TableBorder[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 解析 `:::` 容器属性里的 `borders=`：
 * `all` / `none` / `outer` / `rows` / `cols`，或逗号分隔的边名（top,bottom,left,right,innerH,innerV）。
 * 缺省、空值、无法识别 → 回落默认（全部框线）；同时提供 `normalizeBorders` 供序列化复用。
 */
export function parseTableBorders(attrs: string | undefined): TableBorder[] {
  const fallback = [...TABLE_BORDERS];
  if (!attrs) return fallback;
  // 属性之间只用空白分隔（值内部才允许逗号/竖线，如 borders=top,innerH）
  for (const pair of attrs.split(/\s+/).filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim().toLowerCase() !== 'borders') continue;
    const rawValue = pair.slice(eq + 1).trim();
    if (!rawValue) return fallback;
    const lower = rawValue.toLowerCase();
    if (lower in BORDER_PRESETS) return [...BORDER_PRESETS[lower]];
    const picked = new Set<TableBorder>();
    for (const tok of rawValue
      .split(/[|,]/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      const canon = BORDER_BY_LOWER.get(tok.toLowerCase());
      if (canon) picked.add(canon);
    }
    // 一个都没认出来 → 视为非法，回落默认；否则按固定顺序筛出
    return picked.size ? TABLE_BORDERS.filter((b) => picked.has(b)) : fallback;
  }
  return fallback;
}

/** 边集合 → 序列化字符串；默认（全部框线）返回空串；匹配预设时用预设名，否则用逗号边名列表 */
export function serializeTableBorders(borders: readonly TableBorder[]): string {
  if (sameBorders(borders, TABLE_BORDERS)) return '';
  for (const [name, preset] of Object.entries(BORDER_PRESETS)) {
    if (name !== 'all' && sameBorders(borders, preset)) return name;
  }
  const picked = new Set<TableBorder>(borders);
  return TABLE_BORDERS.filter((b) => picked.has(b)).join(',');
}

/** 容器 class → 边集合（无任何 bd- 类 = 默认全部框线）。编辑器载入时用它还原框线配置 */
export function tableBordersFromClass(className: string): TableBorder[] {
  const cls = className.split(/\s+/);
  if (!cls.some((c) => c === 'bd-reset' || c.startsWith('bd-'))) return [...TABLE_BORDERS];
  return TABLE_BORDERS.filter((b) => cls.includes(`bd-${b}`));
}

/**
 * 边集合 → 容器 class：
 * 默认（全部框线）返回空数组，沿用主题原样式；
 * 任何非默认配置都带 `bd-reset`（先清掉所有框线），再由选中的 `bd-*` 逐边加回；
 * 空集合（无框线）就只有 `bd-reset`。
 */
export function tableBorderClasses(borders: readonly TableBorder[]): string[] {
  if (sameBorders(borders, TABLE_BORDERS)) return [];
  return ['bd-reset', ...TABLE_BORDERS.filter((b) => borders.includes(b)).map((b) => `bd-${b}`)];
}

// 对齐段落的原始 HTML：`<p style="text-align:center">…</p>`（标题同理）
const ALIGNED_BLOCK_RE =
  /<(p|h[1-6])(\s[^>]*\bstyle="[^"]*text-align\s*:\s*(?:left|center|right)[^"]*"[^>]*)>([\s\S]*?)<\/\1>/gi;

/**
 * 对齐段落是以原始 HTML 块存储的，而 Markdown 规范不会解析 HTML 块内部的 Markdown，
 * 于是编辑器写进去的 `_斜体_`、`**粗体**`、行内代码会原样露出星号/下划线。
 * 这里把这些块的内层内容补一次行内 Markdown 解析；parseInline 由调用方传入，
 * 保持本模块只依赖 marked 类型、能被 worker 与浏览器两侧共用。
 */
export function renderAlignedInline(html: string, parseInline: (md: string) => string): string {
  return html.replace(ALIGNED_BLOCK_RE, (_m, tag: string, attrs: string, inner: string) => {
    const body = inner.trim();
    return `<${tag}${attrs}>${body ? parseInline(body) : ''}</${tag}>`;
  });
}

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
  /** 仅 table 块：解析后的框线边集合 */
  borders?: TableBorder[];
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
  tokenizer(
    this: { lexer: { blockTokens: (src: string, tokens: Tokens.Generic[]) => Tokens.Generic[] } },
    src: string,
  ) {
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
    if (name === 'table') token.borders = parseTableBorders(open[2]);
    return token;
  },
  renderer(this: { parser: { parse: (tokens: Tokens.Generic[]) => string } }, token: PrBlockToken): string {
    const inner = EMPTY_BLOCKS.has(token.block) ? '' : this.parser.parse(token.tokens);
    // 未知块名：只保留内容，不生成任意 class（避免正文注入样式锚点）
    if (!(token.block in BLOCK_VARIANTS)) return inner;
    // 表格容器：框线由 bd-* 类表达（默认全框线时不加类，维持主题原样式）
    if (token.block === 'table') {
      const bd = tableBorderClasses(token.borders ?? TABLE_BORDERS);
      const cls = bd.length ? ` ${bd.join(' ')}` : '';
      return `<section class="blk blk-table${cls}">${inner}</section>`;
    }
    const variantClass = token.variant ? ` is-${token.variant}` : '';
    if (EMPTY_BLOCKS.has(token.block)) {
      return `<section class="blk blk-${token.block}${variantClass}" role="separator" aria-hidden="true"></section>`;
    }
    return `<section class="blk blk-${token.block}${variantClass}">${inner}</section>`;
  },
};
