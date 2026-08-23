// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, ensureSlug, isValidSlug } from '../src/lib/utils.ts';

test('slugify：ASCII 标题生成安全 slug', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
  assert.equal(slugify('  Astro  架设  '), 'astro-架设');
  assert.equal(slugify('---a--b---'), 'a-b');
});

test('slugify：纯中文保留，首尾符号去除', () => {
  assert.equal(slugify('杂谈！'), '杂谈');
  assert.equal(slugify('！？'), '');
});

test('ensureSlug：空输入回退到标题 slug 或时间戳前缀', () => {
  assert.equal(ensureSlug('', '随笔', 'collection'), '随笔');
  const fallback = ensureSlug('   ', '！！', 'post');
  assert.match(fallback, /^post-[a-z0-9]+$/);
  assert.equal(ensureSlug('my-slug', '标题', 'post'), 'my-slug');
});

test('isValidSlug：合法 slug 通过', () => {
  assert.ok(isValidSlug('abc'));
  assert.ok(isValidSlug('a-b-c'));
  assert.ok(isValidSlug('中文-slug-1'));
  assert.ok(isValidSlug('A1'));
});

test('isValidSlug：非法 slug 拒绝', () => {
  assert.ok(!isValidSlug(''));
  assert.ok(!isValidSlug('-abc'));
  assert.ok(!isValidSlug('abc-'));
  assert.ok(!isValidSlug('a..b'));
  assert.ok(!isValidSlug('a/b'));
  assert.ok(!isValidSlug('a b'));
  assert.ok(!isValidSlug('a?b'));
  assert.ok(!isValidSlug('a'.repeat(64)));
  assert.ok(!isValidSlug('a.b'));
});