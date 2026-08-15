import { marked, type Tokens } from 'marked';
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

export function renderMarkdown(src: string): { html: string; toc: TocItem[] } {
  usedIds.clear();
  const toc: TocItem[] = [];

  marked.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading): string {
        const text = tokens.map((t) => ('text' in t ? String(t.text ?? '') : '')).join('');
        const id = headingId(text);
        if (depth <= 3) toc.push({ id, text, level: depth });
        return `<h${depth} id="${id}">${text}</h${depth}>`;
      },
      image({ href, title, text }: Tokens.Image): string {
        const attrs = [`src="${href}"`, `alt="${text ?? ''}"`, 'loading="lazy"', 'decoding="async"'];
        if (title) attrs.push(`title="${title}"`);
        return `<img ${attrs.join(' ')} />`;
      },
    },
  });

  const raw = marked.parse(src, { async: false }) as string;

  const html = sanitizeHtml(raw, {
    allowedTags: [
      'a', 'address', 'article', 'aside', 'blockquote', 'br', 'code', 'del', 'details', 'div', 'em',
      'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins',
      'kbd', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table',
      'tbody', 'td', 'th', 'thead', 'tr', 'ul',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title', 'loading', 'decoding'],
      h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
      code: ['class'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    disallowedTagsMode: 'discard',
  });

  return { html, toc };
}