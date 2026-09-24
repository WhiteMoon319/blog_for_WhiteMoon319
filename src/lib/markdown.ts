// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { marked, type Tokens } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';
import sanitizeHtml from 'sanitize-html';
import { slugify } from './utils.ts';

marked.setOptions({ gfm: true, breaks: false });

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

const usedIds = new Map<string, number>();

function headingId(text: string): string {
  const base = slugify(text) || 'section';
  const n = usedIds.get(base) ?? 0;
  usedIds.set(base, n + 1);
  return n === 0 ? base : `${base}-${n + 1}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MATH_MARKER = '\u0000KATEX';

// 抽取 $$...$$ 块级公式与 $...$ 行内公式为占位符，避免 marked 处理下划线/美元符时误伤；
// 渲染后再回填 KaTeX HTML。块级公式：$$ 单独成行（行首起止）；行内：非空白包围的 $...$。
export function extractMath(src: string): { src: string; math: Array<{ tex: string; display: boolean }> } {
  const math: Array<{ tex: string; display: boolean }> = [];
  let out = src;
  // 块级：整行内 $$ 包裹（可能跨行）
  out = out.replace(/^\s*\$\$([\s\S]+?)\$\$\s*$/gm, (_m, tex: string) => {
    const idx = math.length;
    math.push({ tex: tex.trim(), display: true });
    return `${MATH_MARKER}${idx}${MATH_MARKER}`;
  });
  // 行内：$ 包裹且首尾非空白、非空内容。
  // 结尾用零宽 lookahead（不消费边界字符），避免相邻公式 `$a$ $b$` 因吞掉空格而丢匹配
  out = out.replace(/(^|[^$])\$([^\n$]+?)\$(?=[^$]|$)/g, (_m, pre: string, tex: string) => {
    if (!tex.trim() || tex.startsWith(' ') || tex.endsWith(' ') || /^\$/.test(tex)) return _m;
    const idx = math.length;
    math.push({ tex, display: false });
    return `${pre}${MATH_MARKER}${idx}${MATH_MARKER}`;
  });
  return { src: out, math };
}

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      output: 'html',
    });
  } catch {
    return `<span class="katex-error">${escapeHtml(tex)}</span>`;
  }
}

// 把渲染后的 HTML 中的数学占位符回填为 KaTeX 输出
function restoreMath(html: string, math: Array<{ tex: string; display: boolean }>): string {
  return html.replace(new RegExp(`${MATH_MARKER}(\\d+)${MATH_MARKER}`, 'g'), (_m, idx: string) => {
    const item = math[Number(idx)];
    if (!item) return '';
    return renderMath(item.tex, item.display);
  });
}

const DIAGRAM_LANGS = new Set(['mermaid', 'markmap']);

/**
 * 排版块：`:::name{type=variant}` … `:::`（见 .pai/plan/ui/20260924_站内公众号式排版.md）。
 * 存储层仍是 Markdown 文本，因此可进版本快照、可回滚、可 diff；解析后渲染为 `.blk-*` 元素，
 * 样式归主题。未知块名或不闭合一律降级，绝不吞正文。
 */
const BLOCK_VARIANTS: Record<string, string[]> = {
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
const EMPTY_BLOCKS = new Set(['divider']);

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

const prBlockExtension = {
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

marked.use({ extensions: [prBlockExtension] });

// 把占位符替换回原始 LaTeX，用于生成标题 id 与 TOC 文本（避免占位符泄露进 id）
function rawTextOf(text: string, math: Array<{ tex: string; display: boolean }>): string {
  return text.replace(new RegExp(`${MATH_MARKER}(\\d+)${MATH_MARKER}`, 'g'), (_m, idx: string) => math[Number(idx)]?.tex ?? '');
}

export function renderMarkdown(src: string): { html: string; toc: TocItem[] } {
  usedIds.clear();
  const toc: TocItem[] = [];

  const { src: pre, math } = extractMath(src);

  marked.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading): string {
        const text = tokens.map((t) => ('text' in t ? String(t.text ?? '') : '')).join('');
        const rawText = rawTextOf(text, math);
        const id = headingId(rawText);
        if (depth <= 3) toc.push({ id, text: rawText, level: depth });
        return `<h${depth} id="${id}">${restoreMath(text, math)}</h${depth}>`;
      },
      image({ href, title, text }: Tokens.Image): string {
        const attrs = [`src="${href}"`, `alt="${text ?? ''}"`, 'loading="lazy"', 'decoding="async"'];
        if (title) attrs.push(`title="${title}"`);
        return `<img ${attrs.join(' ')} />`;
      },
      code({ text, lang }: Tokens.Code): string {
        const langName = (lang ?? '').trim().toLowerCase();
        if (DIAGRAM_LANGS.has(langName)) {
          return `<div class="diagram ${langName}" data-diagram="${langName}">${escapeHtml(text)}</div>`;
        }
        let highlighted: string;
        try {
          highlighted = langName
            ? hljs.highlight(text, { language: langName, ignoreIllegals: true }).value
            : hljs.highlightAuto(text).value;
        } catch {
          highlighted = escapeHtml(text);
        }
        return `<pre class="hljs"><code class="language-${langName || 'plaintext'} hljs">${highlighted}</code></pre>`;
      },
    },
  });

  const raw = marked.parse(pre, { async: false }) as string;

  const html = sanitizeHtml(restoreMath(raw, math), {
    allowedTags: [
      'a', 'address', 'article', 'aside', 'blockquote', 'br', 'code', 'del', 'details', 'div', 'em',
      'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins',
      'kbd', 'li', 'mark', 'ol', 'p', 'pre', 's', 'section', 'small', 'span', 'strong', 'sub', 'sup',
      'summary', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
    ],
    allowedAttributes: {
      // role / aria-hidden 供排版块（如分割线）表达语义；均为无脚本能力的静态属性
      '*': ['class', 'style', 'id', 'role', 'aria-hidden'],
      a: ['href', 'title'],
      img: ['src', 'alt', 'title', 'loading', 'decoding', 'width', 'height'],
      code: ['class'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    disallowedTagsMode: 'discard',
  });

  return { html, toc };
}