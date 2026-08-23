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
  return html.replace(new RegExp(`${MATH_MARKER}(\\d+)${MATH_MARKER}`, 'g'), (_m, idx: string) =>
    renderMath(math[Number(idx)].tex, math[Number(idx)].display),
  );
}

const DIAGRAM_LANGS = new Set(['mermaid', 'markmap']);

// 把占位符替换回原始 LaTeX，用于生成标题 id 与 TOC 文本（避免占位符泄露进 id）
function rawTextOf(text: string, math: Array<{ tex: string; display: boolean }>): string {
  return text.replace(new RegExp(`${MATH_MARKER}(\\d+)${MATH_MARKER}`, 'g'), (_m, idx: string) => math[Number(idx)].tex);
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
      'kbd', 'li', 'mark', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup',
      'summary', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
    ],
    allowedAttributes: {
      '*': ['class', 'style', 'id'],
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