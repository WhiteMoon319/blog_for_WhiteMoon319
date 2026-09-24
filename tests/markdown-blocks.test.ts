// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 站内「公众号式排版」块语法：:::name{type=variant} … :::

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, parseBlockVariant } from '../src/lib/markdown.ts';

function html(src: string): string {
  return renderMarkdown(src).html;
}

test('排版块：八种块渲染出固定 class 锚点', () => {
  const blocks: Array<[string, string, string]> = [
    ['callout', ':::callout\n提示内容\n:::', 'blk-callout'],
    ['quote', ':::quote\n金句一句\n:::', 'blk-quote'],
    ['divider', ':::divider\n:::', 'blk-divider'],
    ['steps', ':::steps\n1. 第一步\n2. 第二步\n:::', 'blk-steps'],
    ['caption', ':::caption\n图注文字\n:::', 'blk-caption'],
    ['card', ':::card\n卡片要点\n:::', 'blk-card'],
    ['highlight', ':::highlight\n强调的一段\n:::', 'blk-highlight'],
    ['cta', ':::cta\n关注我\n:::', 'blk-cta'],
  ];
  for (const [name, src, cls] of blocks) {
    const out = html(src);
    assert.ok(out.includes(`<section class="blk ${cls}"`), `${name} 应渲染 ${cls}：${out}`);
  }
});

test('排版块：变体参数生效，非法变体被忽略', () => {
  assert.ok(html(':::callout{type=warning}\n注意\n:::').includes('blk-callout is-warning'), 'type 变体生效');
  assert.ok(html(':::divider{style=dots}\n:::').includes('blk-divider is-dots'), 'style 变体生效');
  assert.ok(html(':::highlight{variant=gradient}\n强调\n:::').includes('is-gradient'), 'variant 等价键');
  assert.ok(!html(':::callout{type=evil}\n注意\n:::').includes('is-evil'), '非法变体不落地');
  assert.ok(!html(':::quote{type=warning}\n引用\n:::').includes('is-warning'), '该块无此变体时不生效');

  assert.equal(parseBlockVariant('callout', 'type=success'), 'success');
  assert.equal(parseBlockVariant('callout', 'data-x=1'), '');
  assert.equal(parseBlockVariant('quote', 'type=info'), '', '无变体的块恒为空');
  assert.equal(parseBlockVariant('divider', ''), '');
});

test('排版块：块内 Markdown 正常渲染（加粗/列表/链接/行内代码）', () => {
  const out = html(':::callout{type=info}\n这是 **加粗** 与 [链接](/a/)。\n\n- 项一\n- 项二\n\n`code`\n:::');
  assert.ok(out.includes('<strong>加粗</strong>'), '块内加粗');
  assert.ok(out.includes('href="/a/"'), '块内链接');
  assert.ok(out.includes('<ul>') && out.includes('<li>项一</li>'), '块内列表');
  assert.ok(out.includes('<code>code</code>'), '块内行内代码');
  assert.ok(out.indexOf('<section') < out.indexOf('<strong>'), '块包裹内容');
});

test('排版块：未闭合与未知块名降级，绝不吞正文', () => {
  const unclosed = html(':::callout\n没闭合的提示\n\n正文段落');
  assert.ok(!unclosed.includes('<section'), '未闭合不生成块');
  assert.ok(unclosed.includes('没闭合的提示') && unclosed.includes('正文段落'), '内容完整保留');

  const unknown = html(':::whatever\n普通内容\n:::');
  assert.ok(!unknown.includes('blk-whatever'), '未知块名不生成任意 class');
  assert.ok(unknown.includes('普通内容'), '未知块内容保留');
  assert.ok(!unknown.includes(':::'), '语法标记不外泄');
});

test('排版块：空块与相邻块、上下文的解析边界', () => {
  const empty = html(':::divider\n:::');
  assert.ok(!empty.includes('<p>'), '空块内部不生成段落');

  const ctx = html('前段\n\n:::quote\n引用\n:::\n\n后段');
  assert.ok(ctx.includes('前段') && ctx.includes('后段'), '块前后段落保留');
  assert.ok(ctx.includes('blk-quote'), '块正确生成');
  assert.equal((ctx.match(/<section/g) ?? []).length, 1, '只生成一个块');

  const two = html(':::card\n卡一\n:::\n\n:::card\n卡二\n:::');
  assert.equal((two.match(/blk-card/g) ?? []).length, 2, '相邻同类块各自生成');

  // 缩进或行内出现 ::: 不应被当成块
  const inline = html('正文里的 ::: 三个冒号');
  assert.ok(inline.includes(':::'), '行内冒号原样保留');
  assert.ok(!inline.includes('<section'), '行内冒号不触发生成块');
});

test('排版块：script / onerror / javascript: 仍被清洗', () => {
  const evil = html(':::callout{type=info}\n<img src=x onerror=alert(1)>\n\n<script>alert(2)</script>\n\n[坏](javascript:alert(3))\n:::');
  assert.ok(!evil.includes('<script'), 'script 被移除');
  assert.ok(!evil.includes('onerror'), 'onerror 被移除');
  assert.ok(!evil.includes('javascript:'), 'javascript: 被移除');
  assert.ok(evil.includes('blk-callout'), '块本身仍渲染');
});
