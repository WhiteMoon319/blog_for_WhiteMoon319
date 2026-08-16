import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImportPayloads, slugify } from '../admin/src/lib/import.ts';

const base = [
  { title: '第一篇', slug: '', summary: 's1', contentMd: 'c1' },
  { title: '改过的标题', slug: '', summary: 's2', contentMd: 'c2' },
  { title: '手动篇', slug: 'manual-1', summary: 's3', contentMd: 'c3' },
];

test('slugify：中文保留、空格转连字符、去除首尾连字符', () => {
  assert.equal(slugify('  我的 文章  '), '我的-文章');
  assert.equal(slugify('Hello World!'), 'hello-world');
  assert.equal(slugify('---'), '');
});

test('导入载荷：自动模式按当前标题实时生成 slug', () => {
  const payloads = buildImportPayloads(base, 'auto', 7, 'published');
  assert.equal(payloads[0].slug, '第一篇', '未改标题时与原 slugify 一致');
  assert.equal(payloads[1].slug, '改过的标题', '标题修改后 slug 必须同步更新');
  assert.equal(payloads[2].slug, '手动篇', '手动输入 slug 在自动模式下被忽略');
});

test('导入载荷：手动模式使用用户输入的 slug', () => {
  const payloads = buildImportPayloads(base, 'manual', 7, 'draft');
  assert.equal(payloads[0].slug, undefined, '手动模式空 slug 交由服务端生成');
  assert.equal(payloads[1].slug, undefined);
  assert.equal(payloads[2].slug, 'manual-1');
});

test('导入载荷：空标题自动模式生成空 slug（由服务端报错）', () => {
  const payloads = buildImportPayloads([{ title: '   ', slug: '', summary: '', contentMd: '' }], 'auto', 7, 'draft');
  assert.equal(payloads[0].title, '');
  assert.equal(payloads[0].slug, undefined);
});

test('导入载荷：其余字段原样传递', () => {
  const payloads = buildImportPayloads(base, 'auto', 7, 'published');
  assert.equal(payloads[0].summary, 's1');
  assert.equal(payloads[0].content_md, 'c1');
  assert.equal(payloads[0].collection_id, 7);
  assert.equal(payloads[0].status, 'published');
});