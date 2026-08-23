// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('导入视图：清单表格包在 table-wrap 内（移动端可横向滚动）', () => {
  const src = readFileSync(resolve('admin/src/views/ImportView.vue'), 'utf8');
  assert.match(src, /<div class="table-wrap">\s*<table class="table">/, '表格必须直接包在 table-wrap 内');
  const wrapOpen = src.indexOf('<div class="table-wrap">');
  const tableStart = src.indexOf('<table class="table">', wrapOpen);
  const wrapClose = src.indexOf('</div>', tableStart);
  assert.ok(wrapClose > tableStart, 'table-wrap 必须闭合');
});

test('站点布局：字体样式表为普通 link（无被 CSP 拦截的内联 onload）', () => {
  const src = readFileSync(resolve('src/layouts/BaseLayout.astro'), 'utf8');
  assert.ok(src.includes("https://fonts.googleapis.com/css2?"), '应保留 Google Fonts 样式表');
  assert.ok(!src.includes('onload='), '不得再使用内联 onload（CSP script-src 拦截）');
  assert.ok(!src.includes('media="print"'), '不得残留 print 媒体占位');
  assert.ok(
    src.includes("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"),
    'CSP style-src 必须放行字体样式表源',
  );
});