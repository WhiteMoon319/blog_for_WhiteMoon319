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
  const src = readFileSync(resolve('src/themes/classic/layouts/BaseLayout.astro'), 'utf8');
  assert.ok(src.includes("https://fonts.googleapis.com/css2?"), '应保留 Google Fonts 样式表');
  assert.ok(!src.includes('onload='), '不得再使用内联 onload（CSP script-src 拦截）');
  assert.ok(!src.includes('media="print"'), '不得残留 print 媒体占位');
  const head = readFileSync(resolve('src/core/SiteHead.astro'), 'utf8');
  assert.ok(
    head.includes("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"),
    'CSP style-src 必须放行字体样式表源',
  );
});

test('列表卡：不得用 <a> 包裹整卡（卡内署名链接会造成非法 <a> 嵌套）', () => {
  // 卡片外层若是 <a>，卡内署名链接（.byline-name）就会被浏览器拆解，元信息被甩出卡外。
  // 约定：卡片容器用 <div class="...card">，主链接改用 CardLink（拉伸 ::after 承接整卡点击）。
  const files = [
    'src/themes/classic/templates/home.astro',
    'src/themes/classic/templates/collection.astro',
    'src/themes/classic/templates/archive.astro',
    'src/themes/classic/templates/search.astro',
    'src/themes/classic/components/TagResults.astro',
    'src/themes/modern/templates/home.astro',
    'src/themes/modern/templates/collection.astro',
    'src/themes/modern/templates/archive.astro',
    'src/themes/modern/templates/search.astro',
    'src/themes/modern/components/TagResults.astro',
  ];
  for (const f of files) {
    const src = readFileSync(resolve(f), 'utf8');
    assert.ok(!/<a\b[^>]*class="[^"]*\b(post|portal)-card\b/.test(src), `${f}：卡片容器不得是 <a>`);
    assert.ok(src.includes("from '@core/CardLink.astro'"), `${f}：卡片主链接必须改用 CardLink`);
  }
  // 核心组件与署名层级：署名需浮在卡内覆盖层之上（否则点不到作者页）
  const byline = readFileSync(resolve('src/core/AuthorByline.astro'), 'utf8');
  assert.match(byline, /\.byline\s*\{[^}]*z-index:\s*2/s, '.byline 必须高于卡片覆盖层 z-index');
  const cardLink = readFileSync(resolve('src/core/CardLink.astro'), 'utf8');
  assert.match(cardLink, /\.card-hit::after\s*\{[^}]*position:\s*absolute/s, 'CardLink 覆盖层必须绝对定位铺满卡片');
});