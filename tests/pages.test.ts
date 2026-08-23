// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, type TestDbHandle } from './helpers/d1.ts';
import {
  createPage,
  deletePage,
  getPageById,
  getPageBySlug,
  listPages,
  pageSlugConflicts,
  updatePage,
  validatePageSlug,
} from '../src/lib/db/pages.ts';
import { createPostWithTags } from '../src/lib/db/posts.ts';
import { createCollectionWithTags } from '../src/lib/db/collections.ts';

let h: TestDbHandle;

before(async () => {
  h = await makeTestDb();
});

after(async () => {
  await h.dispose();
});

test('页面：validatePageSlug 规则', () => {
  assert.deepEqual(validatePageSlug('hello'), { ok: true });
  assert.deepEqual(validatePageSlug('my-page-2'), { ok: true });
  assert.equal(validatePageSlug('').ok, false, '空 slug 拒绝');
  assert.equal(validatePageSlug('a'.repeat(121)).ok, false, '超长拒绝');
  assert.equal(validatePageSlug('Hello World').ok, false, '大写/空格拒绝');
  assert.equal(validatePageSlug('hello_下划线').ok, false, '非法字符拒绝');
  assert.equal(validatePageSlug('-lead').ok, false, '连字符开头拒绝');
  assert.equal(validatePageSlug('admin').ok, false, '系统保留拒绝');
  assert.equal(validatePageSlug('sitemap').ok, false, 'sitemap 保留拒绝');
});

test('页面：CRUD 全链路', async () => {
  const p = await createPage(h.db, { slug: 'guides', title: '使用指南', content_md: '# 指南', published: 1 });
  assert.ok(p.id > 0);
  assert.equal(p.slug, 'guides');
  assert.equal(p.published, 1);

  const bySlug = await getPageBySlug(h.db, 'guides');
  assert.equal(bySlug?.title, '使用指南');

  const listAll = await listPages(h.db, true);
  assert.ok(listAll.some((x) => x.slug === 'guides'));
  const listPub = await listPages(h.db, false);
  assert.ok(listPub.some((x) => x.slug === 'guides'), '已发布页在公开列表');

  const updated = await updatePage(h.db, p.id, { title: '新标题', published: 0 });
  assert.equal(updated?.title, '新标题');
  assert.equal(updated?.published, 0);
  const listPub2 = await listPages(h.db, false);
  assert.ok(!listPub2.some((x) => x.slug === 'guides'), '下线后不在公开列表');
  const listAll2 = await listPages(h.db, true);
  assert.ok(listAll2.some((x) => x.slug === 'guides'), '下线后仍可在管理列表');

  const ok = await deletePage(h.db, p.id);
  assert.equal(ok, true);
  assert.equal(await getPageById(h.db, p.id), null);
  assert.equal(await deletePage(h.db, p.id), false, '重复删除返回 false');
});

test('页面：重复 slug 创建拒绝', async () => {
  await createPage(h.db, { slug: 'dup', title: 'A' });
  await assert.rejects(createPage(h.db, { slug: 'dup', title: 'B' }), /已存在/);
});

test('页面：更新 slug 与其他页面冲突拒绝', async () => {
  const a = await createPage(h.db, { slug: 'keep-a', title: 'A' });
  const b = await createPage(h.db, { slug: 'keep-b', title: 'B' });
  await assert.rejects(updatePage(h.db, b.id, { slug: 'keep-a' }), /已存在/);
  // 自身 slug 不变不报错
  const same = await updatePage(h.db, a.id, { slug: 'keep-a', title: '改名' });
  assert.equal(same?.title, '改名');
});

test('页面：slug 与文章/文集冲突检测', async () => {
  await createPostWithTags(h.db, { title: '文章', slug: 'post-x', status: 'published' }, []);
  assert.match((await pageSlugConflicts(h.db, 'post-x')) ?? '', /文章/);

  await createCollectionWithTags(h.db, { title: '文集', slug: 'col-x' }, []);
  assert.match((await pageSlugConflicts(h.db, 'col-x')) ?? '', /文集/);

  assert.equal(await pageSlugConflicts(h.db, 'free-slug'), null);
});