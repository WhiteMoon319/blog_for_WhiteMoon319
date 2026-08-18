import TurndownService from 'turndown';

export function createTurndown(): TurndownService {
  return new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
}

const TABLE_RE = /^\s*\|[^\n]*\|\s*$/m;
const RAW_HTML_RE = /<(table|div|details|section|article|aside|header|footer|nav|main|figure|dl|iframe|style|script|form)[\s>]/i;

// 编辑器不支持的结构提示：检测 markdown 表格与块级 HTML，避免往返后静默丢失
export function checkContentRisk(md: string): string {
  if (TABLE_RE.test(md)) return '正文包含 Markdown 表格，编辑器会将其摊平为纯文本后保存，结构将丢失。';
  if (RAW_HTML_RE.test(md)) return '正文包含块级 HTML（表格/布局标签等），编辑器会剥掉这些结构，保存后内容可能改变。';
  return '';
}