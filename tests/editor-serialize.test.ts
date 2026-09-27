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
