// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 编辑器序列化契约：可视化编辑器保存时把 DOM 转回 Markdown，这里锁住两条容易退化的规则——
// 表格结构（turndown 默认没有表格规则，会把 <table> 压成几行纯文本）与段落/表格列对齐。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurndown } from '../admin/src/lib/editor.ts';
import { renderMarkdown } from '../src/lib/markdown.ts';

test('turndown：GFM 表格往返不丢结构', () => {
  const td = createTurndown();
  const html =
    '<table><thead><tr><th>a</th><th>b</th></tr></thead>' +
    '<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>';
  assert.equal(td.turndown(html), '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
});

test('turndown：表格列对齐回写为 :-- / :-: / --:', () => {
  const td = createTurndown();
  const html =
    '<table><thead><tr>' +
    '<th style="text-align:left">左</th><th style="text-align:center">中</th><th style="text-align:right">右</th>' +
    '</tr></thead><tbody><tr><td>a</td><td>b</td><td>c</td></tr></tbody></table>';
  assert.equal(td.turndown(html), '| 左 | 中 | 右 |\n| :-- | :--: | --: |\n| a | b | c |');
});

test('turndown：单元格竖线被转义，不破坏表结构', () => {
  const td = createTurndown();
  const html =
    '<table><thead><tr><th>x</th></tr></thead><tbody><tr><td>a | b</td></tr></tbody></table>';
  assert.equal(td.turndown(html), '| x |\n| --- |\n| a \\| b |');
});

test('turndown：对齐段落回写为内联样式，左对齐不写标签', () => {
  const td = createTurndown();
  assert.equal(
    td.turndown('<p style="text-align:center">居中</p><p style="text-align:right">右</p><p>普通</p>'),
    '<p style="text-align:center">居中</p>\n\n<p style="text-align:right">右</p>\n\n普通',
  );
  assert.equal(td.turndown('<p style="text-align:left">左</p>'), '左');
});

test('对齐段落：斜体往返不丢（保存 → 载入仍是斜体，不露下划线）', async () => {
  const td = createTurndown();
  const saved = td.turndown('<p style="text-align:right"><em>简言</em>，<strong>绝笔</strong>。</p>');
  assert.equal(saved, '<p style="text-align:right">_简言_，**绝笔**。</p>');
  const { mdToHtml } = await import('../admin/src/lib/marked-blocks.ts');
  const back = mdToHtml(saved);
  assert.ok(back.includes('<em>简言</em>') && back.includes('<strong>绝笔</strong>'), `载入应还原斜体/粗体：${back}`);
  assert.ok(!back.includes('_简言_'), '不应残留字面下划线');
});

test('turndown：框线非默认时表格包回 :::table 容器，默认保持纯 GFM', () => {
  const td = createTurndown();
  const cells = '<tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr>';
  // 默认（无 bd- 类）→ 纯 GFM
  const plain = td.turndown(`<table class="tip-table"><thead>${cells}</table>`);
  assert.equal(plain, '| a |\n| --- |\n| 1 |');
  // 已配置 → 包容器
  const none = td.turndown(`<table class="tip-table bd-reset"><thead>${cells}</table>`);
  assert.equal(none, ':::table{borders=none}\n| a |\n| --- |\n| 1 |\n:::');
  const custom = td.turndown(`<table class="tip-table bd-reset bd-top bd-innerV"><thead>${cells}</table>`);
  assert.equal(custom, ':::table{borders=top,innerV}\n| a |\n| --- |\n| 1 |\n:::');
});

test('turndown：容器往返幂等（序列化 → 解析 → 再序列化）', () => {
  const td = createTurndown();
  const tableDom = '<table class="tip-table bd-reset bd-bottom"><thead><tr><th>x</th></tr></thead><tbody><tr><td>y</td></tr></tbody></table>';
  const once = td.turndown(tableDom);
  assert.equal(once, ':::table{borders=bottom}\n| x |\n| --- |\n| y |\n:::');
  // 前台渲染：容器类应落到最终 HTML
  const rendered = renderMarkdown(once).html;
  assert.ok(rendered.includes('class="blk blk-table bd-reset bd-bottom"'), `容器类应保留：${rendered}`);
  // 编辑器载入后再保存（DOM 上只剩带 bd 类的 table）应与首次一致
  assert.equal(td.turndown(tableDom), once);
});
