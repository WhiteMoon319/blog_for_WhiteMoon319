// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('导入视图：清单表格包在 table-wrap 内（移动端可横向滚动）', () => {
  const src = readFileSync(resolve('admin/src/views/ImportView.vue'), 'utf8');
  assert.match(src, /<div class="table-wrap">\s*<table class="table">/, '表格必须直接包在 table-wrap 内');
  const wrapOpen = src.indexOf('<div class="table-wrap">');
  const tableStart = src.indexOf('<table class="table">', wrapOpen);
  const wrapClose = src.indexOf('</div>', tableStart);
  assert.ok(wrapClose > tableStart, 'table-wrap 必须闭合');
});

test('后台页面骨架：统一走 PageHead，不再各写一份头部标记', () => {
  const dir = resolve('admin/src/views');
  const views = readdirSync(dir).filter((f) => f.endsWith('.vue') && f !== 'LoginView.vue');
  assert.ok(views.length >= 10, '应扫到后台视图');
  for (const f of views) {
    const src = readFileSync(resolve(dir, f), 'utf8');
    assert.ok(!src.includes('class="page-head"'), `${f} 不应再自己写 page-head 标记（用 <PageHead>）`);
    assert.match(src, /components\/PageHead\.vue/, `${f} 应引入 PageHead 组件`);
  }
});

test('后台导航：分组呈现且不折行（不再平铺成一长排）', () => {
  const app = readFileSync(resolve('admin/src/App.vue'), 'utf8');
  assert.match(app, /components\/NavBar\.vue/, '后台外壳应使用共用导航组件');
  // 三个分组名与用途固定，防回退成平铺
  for (const label of ['写作', '管理', '配置']) {
    assert.ok(app.includes(`label: '${label}'`), `缺少分组「${label}」`);
  }
  assert.ok(!/router-link to="\/stats"/.test(app), '数据页已并进工作台，导航不应再有独立入口');
  const write = readFileSync(resolve('admin/src/write/WriteApp.vue'), 'utf8');
  assert.match(write, /components\/NavBar\.vue/, '写作区应与后台共用同一套导航');
  const css = readFileSync(resolve('admin/src/assets/admin.css'), 'utf8');
  assert.match(css, /white-space:\s*nowrap/, '导航项必须 nowrap，否则中等宽度会竖排折行');
  assert.match(css, /@media \(max-width: 1180px\)/, '缺少中等宽度断点');
});

test('后台默认入口：工作台整合了数据页，旧路径保留重定向', () => {
  const router = readFileSync(resolve('admin/src/router.ts'), 'utf8');
  assert.match(router, /path: '\/', name: 'dashboard'/, '根路径应落到工作台');
  assert.match(router, /path: '\/stats', redirect: '\/'/, '旧 /stats 应重定向');
  const dash = readFileSync(resolve('admin/src/views/DashboardView.vue'), 'utf8');
  assert.match(dash, /StatsPanels/, '工作台应内嵌阅读数据面板');
});

test('导入视图：拖入文件与选择文件共用同一条解析入口', () => {  const src = readFileSync(resolve('admin/src/views/ImportView.vue'), 'utf8');
  assert.match(src, /@drop="onDrop"/, '拖拽区必须处理 drop');
  assert.match(src, /@dragover="onDragOver"/, '必须处理 dragover 才能接收放下');
  assert.match(src, /async function addFiles\(/, '解析入口必须是共用的 addFiles');
  // 选择框与拖入都必须走 addFiles，避免两条路径行为分叉
  assert.match(src, /async function onFiles\(e: Event\)[\s\S]*?await addFiles\(/, 'onFiles 必须复用 addFiles');
  assert.match(src, /async function onDrop\(e: DragEvent\)[\s\S]*?await addFiles\(/, 'onDrop 必须复用 addFiles');
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
    'src/themes/classic/templates/author.astro',
    'src/themes/classic/components/TagResults.astro',
    'src/themes/modern/templates/home.astro',
    'src/themes/modern/templates/collection.astro',
    'src/themes/modern/templates/archive.astro',
    'src/themes/modern/templates/search.astro',
    'src/themes/modern/templates/author.astro',
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
test('后台样式治理：模板里不再写内联样式（间距/排布走工具类）', () => {
  const root = resolve('admin/src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.vue')) files.push(p);
    }
  };
  walk(root);
  assert.ok(files.length >= 20, '应扫到后台组件与视图');

  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const tpl = src.slice(src.indexOf('<template>'), src.indexOf('</template>'));
    // 只禁静态 style 属性；:style / v-bind:style 是动态绑定，允许
    const hits = tpl.match(/(?<![:\w-])style="/g) ?? [];
    if (hits.length > 0) offenders.push(`${f.replace(root, 'admin/src')}（${hits.length} 处）`);
  }
  assert.deepEqual(offenders, [], `以下模板仍有内联样式，请改用 admin.css 的语义类/工具类：\n${offenders.join('\n')}`);
});

test('后台样式治理：工具类层存在（内联样式收敛的落点）', () => {
  const css = readFileSync(resolve('admin/src/assets/admin.css'), 'utf8');
  for (const cls of ['.row {', '.row-wrap {', '.card-actions {', '.section-title {', '.ta-right {', '.text-muted {', '.state-block {']) {
    assert.ok(css.includes(cls), `admin.css 缺少工具类 ${cls}`);
  }
  // 深色模式下工具类也必须可跟随：除「朱砂底上的白字」外不得写死色值
  const utilSection = css.slice(css.indexOf('===== 工具类'));
  const hard = utilSection.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
  const bad = hard.filter((c) => !/^#(fff|ffffff)$/i.test(c));
  assert.deepEqual(bad, [], `工具类区出现写死色值，应改走 CSS 变量：${bad.join(' ')}`);
});
