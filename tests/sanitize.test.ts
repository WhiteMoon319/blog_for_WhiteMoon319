import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/lib/markdown.ts';

test('renderMarkdown：script 与事件属性被清除', () => {
  const { html } = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n## 标题');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('onerror'));
  assert.ok(html.includes('<h2 id="标题">标题</h2>'));
});

test('renderMarkdown：javascript: 链接被清除', () => {
  const { html } = renderMarkdown('[点我](javascript:alert(1))');
  assert.ok(!html.includes('javascript:'));
});

test('renderMarkdown：安全标签保留', () => {
  const { html } = renderMarkdown('**粗** 与 [链接](https://example.com) 与 `code`');
  assert.ok(html.includes('<strong>粗</strong>'));
  assert.ok(html.includes('<a href="https://example.com">链接</a>'));
  assert.ok(html.includes('<code>code</code>'));
});

test('renderMarkdown：svg 与 iframe 被丢弃', () => {
  const { html } = renderMarkdown('<svg onload="alert(1)"></svg>\n\n<iframe src="https://evil"></iframe>\n\n正文');
  assert.ok(!html.includes('<svg'));
  assert.ok(!html.includes('<iframe'));
  assert.ok(html.includes('正文'));
});

test('renderMarkdown：标题 id 稳定且重复去重', () => {
  const { html, toc } = renderMarkdown('## 甲\n\n### 乙\n\n## 甲');
  assert.ok(html.includes('id="甲"'));
  assert.ok(html.includes('id="乙"'));
  assert.ok(html.includes('id="甲-2"'));
  assert.deepEqual(toc.map((t) => t.id), ['甲', '乙', '甲-2']);
  assert.deepEqual(toc.map((t) => t.level), [2, 3, 2]);
});

test('renderMarkdown：纯符号标题回退 section 且去重', () => {
  const { html } = renderMarkdown('## !!!\n\n## !!!');
  assert.ok(html.includes('id="section"'));
  assert.ok(html.includes('id="section-2"'));
});

test('renderMarkdown：图片获得懒加载属性', () => {
  const { html } = renderMarkdown('![图](/api/files/a.png)');
  assert.ok(html.includes('loading="lazy"'));
  assert.ok(html.includes('decoding="async"'));
});

test('renderMarkdown：TOC 仅收录 h1-h3', () => {
  const { toc } = renderMarkdown('## 二\n\n#### 四\n\n### 三');
  assert.deepEqual(toc.map((t) => t.level), [2, 3]);
});