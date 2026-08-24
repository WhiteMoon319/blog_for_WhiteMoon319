// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPostWithTags,
  createCollection,
  trashPosts,
  purgePosts,
  exportFullSnapshot,
  exportPostMarkdown,
} from '../src/lib/db/index.ts';
import { makeTestDb } from './helpers/d1.ts';

const handle = await makeTestDb();
after(() => handle.dispose());
const db = handle.db;

test('导出：全量快照含全部表与版本信息，且快照忠实反映回收站状态', async () => {
  const col = await createCollection(db, {
    title: '导出集',
    slug: 'export-col',
    summary: 's',
    theme_color: '#123456',
    sort_order: 0,
    post_order: 'desc',
  });
  assert.ok(col);
  const r = await createPostWithTags(
    db,
    {
      collection_id: col.id,
      title: '导出篇',
      slug: 'export-post',
      summary: '摘要',
      content_md: '正文内容',
      status: 'published',
    },
    ['导出甲', '导出乙'],
  );
  assert.ok(r, '文章创建失败');
  const { post } = r;
  await trashPosts(db, [post.id]);

  const snap = await exportFullSnapshot(db);
  assert.equal(snap.schema_version, 2, 'schema_version 递增');
  assert.ok(snap.generated_at, '应带生成时间');
  assert.ok(snap.migration_version.length > 0, '应带迁移版本（测试环境可能为 unknown）');
  assert.equal(snap.collections.length, 1);
  assert.equal(snap.collections[0].slug, 'export-col');
  assert.equal(snap.posts.length, 1, '快照应包含回收站文章');
  assert.ok(snap.posts[0].deleted_at, '回收站文章应保留 deleted_at');
  assert.equal(snap.post_versions.length, 2, '创建 + 移入回收站共两条版本');
  assert.equal(snap.tags.length, 2);
  assert.equal(snap.collection_tags.length, 0, '文集无自有标签');
  assert.equal(snap.post_tags.length, 2);
  assert.equal(Array.isArray(snap.pages), true, 'pages 未建表时为空数组而非报错');
  assert.equal(Array.isArray(snap.settings), true, 'settings 未建表时为空数组而非报错');

  await purgePosts(db, [post.id]);
  const afterPurge = await exportFullSnapshot(db);
  assert.equal(afterPurge.posts.length, 0, 'purge 后快照不再包含该篇');
});

test('导出：单篇 Markdown 带 frontmatter 与标签，特殊字符安全', async () => {
  const r = await createPostWithTags(
    db,
    {
      collection_id: null,
      title: '引号"与反斜杠\\篇',
      slug: 'export-md',
      summary: 's',
      content_md: '# 标题\n\n正文。',
      status: 'draft',
    },
    ['标一', '标"二'],
  );
  assert.ok(r, '文章创建失败');
  const { post } = r;

  const out = await exportPostMarkdown(db, post.id);
  assert.ok(out, '应导出成功');
  assert.equal(out.filename, 'export-md.md');
  assert.ok(out.body.includes('title: "引号\\"与反斜杠\\\\篇"'), 'YAML 双引号转义正确');
  assert.ok(out.body.includes('status: draft'));
  assert.ok(out.body.includes('tags: ["标一", "标\\"二"]') || out.body.includes('tags: ["标\\"二", "标一"]'), '标签按名排序后完整转义');
  assert.ok(out.body.trimEnd().endsWith('# 标题\n\n正文。'), '正文完整保留');

  assert.equal(await exportPostMarkdown(db, 999999), null, '不存在的文章返回 null');
});