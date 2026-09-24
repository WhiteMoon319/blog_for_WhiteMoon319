// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 排版块契约：编辑器侧的块元数据与核心解析器必须一致，且序列化结果能被解析器读回。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKS, blkClass, parseBlkClass, serializeBlk, findBlock } from '../admin/src/lib/blocks.ts';
import { renderMarkdown } from '../src/lib/markdown.ts';

// 核心解析器认可的块与变体（与 src/lib/markdown.ts 的 BLOCK_VARIANTS 同步）
const CORE_BLOCKS: Record<string, string[]> = {
  callout: ['info', 'success', 'warning', 'danger'],
  highlight: ['yellow', 'gradient'],
  divider: ['line', 'dots', 'space'],
  quote: [],
  steps: [],
  caption: [],
  card: [],
  cta: [],
};

test('块清单：编辑器元数据与核心解析器完全一致（防两处漂移）', () => {
  const editorNames = BLOCKS.map((b) => b.name).sort();
  assert.deepEqual(editorNames, Object.keys(CORE_BLOCKS).sort(), '块名集合一致');
  for (const b of BLOCKS) {
    assert.deepEqual(
      b.variants.map((v) => v.value).sort(),
      [...CORE_BLOCKS[b.name]].sort(),
      `${b.name} 的变体集合一致`,
    );
    assert.ok(b.label && b.hint, `${b.name} 应有中文名与说明（新手要看得懂）`);
    assert.equal(Boolean(b.empty), b.name === 'divider', '仅分割线是空块');
    assert.equal(b.content, !b.empty, 'content 与 empty 互斥');
  }
  assert.ok(findBlock('callout'), '能按名查到块');
  assert.equal(findBlock('nope'), undefined);
});

test('class 与语法互为反函数：blkClass → parseBlkClass', () => {
  for (const b of BLOCKS) {
    const variants = b.variants.length > 0 ? b.variants.map((v) => v.value) : [''];
    for (const v of variants) {
      const cls = blkClass(b.name, v);
      const back = parseBlkClass(cls);
      assert.equal(back.name, b.name, `${cls} 反解块名`);
      assert.equal(back.variant, v, `${cls} 反解变体`);
    }
  }
  // 非法变体被吞掉（不产生 is-evil），块名仍需保留
  assert.deepEqual(parseBlkClass('blk blk-callout is-evil'), { name: 'callout', variant: '' });
  assert.deepEqual(parseBlkClass('blk blk-unknown is-info'), { name: 'unknown', variant: '' });
});

test('往返等价：序列化产物能被核心解析器读回同一 class', () => {
  for (const b of BLOCKS) {
    const variants = b.variants.length > 0 ? b.variants.map((v) => v.value) : [''];
    for (const v of variants) {
      const cls = blkClass(b.name, v);
      const inner = b.empty ? '' : '一段内容';
      const md = serializeBlk(cls, inner);
      const html = renderMarkdown(md.trim()).html;
      assert.ok(
        html.includes(`<section class="${cls}"`) || html.includes(`class="${cls}"`),
        `${b.name}${v ? `/${v}` : ''} 往返后应保留 class：${md.trim()} → ${html}`,
      );
      if (!b.empty) assert.ok(html.includes('一段内容'), `${b.name} 内容应保留`);
      // 再解析一次仍是同一个块（幂等）
      assert.deepEqual(parseBlkClass(cls), parseBlkClass(cls), '反解稳定');
    }
  }
});

test('序列化形态：空块不写内容行，含内容块用 ::: 收尾', () => {
  assert.equal(serializeBlk('blk-divider', '').trim(), ':::divider\n:::');
  assert.equal(serializeBlk('blk-divider is-dots', '').trim(), ':::divider{type=dots}\n:::');
  assert.equal(serializeBlk('blk-quote', '\n引用内容\n').trim(), ':::quote\n引用内容\n:::');
  assert.equal(serializeBlk('blk-callout is-warning', '注意点火').trim(), ':::callout{type=warning}\n注意点火\n:::');
  // 不是块：原样返回内容（不该吞正文）
  assert.equal(serializeBlk('', '普通内容'), '普通内容');
});

test('块内多段落与列表在往返中保持结构', () => {
  const md = serializeBlk('blk-card', '标题行\n\n- 项一\n- 项二').trim();
  const html = renderMarkdown(md).html;
  assert.ok(html.includes('blk-card'), '块保留');
  assert.ok(html.includes('<li>项一</li>') && html.includes('<li>项二</li>'), '列表保留');
});
