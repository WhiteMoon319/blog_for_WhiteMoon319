import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, extractMath } from '../src/lib/markdown.ts';

test('markdown：GFM 表格渲染为 table', () => {
  const { html } = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.ok(html.includes('<table>'), '应产出 <table>');
  assert.ok(html.includes('<th>a</th>'));
  assert.ok(html.includes('<td>1</td>'));
  assert.ok(html.includes('<td>2</td>'));
});

test('markdown：行内公式 $...$ 渲染为 KaTeX', () => {
  const { html } = renderMarkdown('欧拉公式 $e^{i\\pi}+1=0$ 很美');
  assert.ok(html.includes('class="katex"'), '应包含 katex 根元素');
  assert.ok(html.includes('katex-html'), '应包含 katex-html 渲染产物');
  assert.ok(!html.includes('$'), '美元符不应残留在输出中');
});

test('markdown：块级公式 $$...$$ 渲染为 katex-display', () => {
  const { html } = renderMarkdown('$$\n\\int_0^1 x^2\\,dx\n$$');
  assert.ok(html.includes('class="katex-display"'), '块级公式应包在 katex-display 中');
  assert.ok(html.includes('katex-html'), '应包含 katex-html 渲染产物');
  assert.ok(!html.includes('\\int'), 'LaTeX 源码不应残留');
});

test('markdown：标题内公式不污染标题文本与 TOC', () => {
  const { html, toc } = renderMarkdown('## 面积 $S=\\pi r^2$');
  assert.ok(html.includes('id="面积-s-pi-r-2"'), '标题 id 由文本生成');
  assert.ok(html.includes('class="katex"'), '标题内公式仍渲染');
  assert.equal(toc[0].text, '面积 S=\\pi r^2');
});

test('markdown：mermaid 代码块转为 diagram 容器且保留原文', () => {
  const md = '```mermaid\ngraph TD\n  A-->B\n```';
  const { html } = renderMarkdown(md);
  assert.ok(html.includes('<div class="diagram mermaid">'), '应生成 mermaid 容器');
  assert.ok(html.includes('graph TD'), '原文应保留在容器内');
  assert.ok(html.includes('A--&gt;B'), '尖括号需转义以防 XSS');
});

test('markdown：markmap 代码块转为 diagram 容器', () => {
  const md = '```markmap\n# 主题\n- 分支一\n- 分支二\n```';
  const { html } = renderMarkdown(md);
  assert.ok(html.includes('<div class="diagram markmap">'), '应生成 markmap 容器');
  assert.ok(html.includes('- 分支一'));
});

test('markdown：mermaid 恶意内容被转义（不注入 HTML）', () => {
  const md = '```mermaid\n<script>alert(1)</script>\n```';
  const { html } = renderMarkdown(md);
  assert.ok(html.includes('&lt;script&gt;'), '脚本标签应被转义');
  assert.ok(!html.includes('<script>'), '不应输出真实 script 标签');
});

test('markdown：代码块语法高亮', () => {
  const { html } = renderMarkdown('```js\nconst x = 1;\n```');
  assert.ok(html.includes('<pre class="hljs">'), '应输出 hljs 包裹');
  assert.ok(html.includes('class="language-js hljs"'), '应标注语言');
  assert.ok(html.includes('hljs-keyword'), '关键字应被高亮标记');
});

test('markdown：无语言代码块用 highlightAuto 且标 plaintext', () => {
  const { html } = renderMarkdown('```\nhello world\n```');
  assert.ok(html.includes('class="language-plaintext hljs"'), '无语言应回退 plaintext');
});

test('markdown：块级 HTML 布局标签保留标签但剥除事件属性', () => {
  const { html } = renderMarkdown('<div onclick="x()">布局</div>\n\n正文');
  assert.ok(html.includes('<div>'), 'div 为允许标签应保留');
  assert.ok(!html.includes('onclick'), '事件属性应被清除');
  assert.ok(html.includes('正文'));
});

test('markdown：raw 表格标签保留且文本内容完整', () => {
  const { html } = renderMarkdown('<table><tr><td>单元格</td></tr></table>');
  assert.ok(html.includes('<table>'), '表格为允许标签应保留');
  assert.ok(html.includes('单元格'), '文本内容保留');
});

test('extractMath：占位符可往返还原', () => {
  const { src, math } = extractMath('行内 $x$ 与\n$$\n块级\n$$');
  assert.equal(math.length, 2);
  assert.equal(math[0].display, true, '块级公式先被抽取（块级正则先跑）');
  assert.equal(math[1].display, false);
  assert.ok(!src.includes('$'), '抽取后源码不含美元符');
  assert.equal(src.includes('\u0000KATEX0\u0000'), true);
  assert.equal(src.includes('\u0000KATEX1\u0000'), true);
});