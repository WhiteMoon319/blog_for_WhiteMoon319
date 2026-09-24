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
  createUser,
  setPostAuthors,
  addCollectionCollaborator,
  requestCollectionInvite,
  trashPosts,
  purgePosts,
  exportFullSnapshot,
  exportPostMarkdown,
} from '../src/lib/db/index.ts';
import { makeTestDb } from './helpers/d1.ts';

const handle = await makeTestDb();
after(() => handle.dispose());
const db = handle.db;

async function mkUser(username: string, role: 'reader' | 'author' | 'admin', displayName = username, bio = '') {
  const u = await createUser(db, {
    username,
    email: `${username}@example.com`,
    password_hash: 'x',
    display_name: displayName,
    role,
  });
  assert.ok(u, `创建用户 ${username} 失败`);
  if (bio) await db.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(bio, u.id).run();
  return u;
}

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
  assert.equal(snap.schema_version, 3, 'schema_version 随快照结构递增');
  assert.deepEqual(snap.post_authors, [], '无署名的库导出为空数组');
  assert.deepEqual(snap.collection_collaborators, [], '无协作者的库导出为空数组');
  assert.deepEqual(snap.collection_invites, [], '无申请的库导出为空数组');
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

test('导出：署名与协作者随快照导出，单篇 frontmatter 带 authors', async () => {
  const a = await mkUser('exp-author-a', 'author', '导出甲', '简介甲');
  const b = await mkUser('exp-author-b', 'author', '导出乙');

  const col = await createCollection(db, { title: '导出协作集', slug: 'exp-col', created_by: a.id, is_public: 0 });
  assert.ok(col);
  await addCollectionCollaborator(db, col!.id, b.id);
  await requestCollectionInvite(db, col!.id, b.id, '想投稿');
  await db.prepare('DELETE FROM collection_collaborators WHERE collection_id = ? AND user_id = ?').bind(col!.id, b.id).run();

  const r = await createPostWithTags(
    db,
    { collection_id: col!.id, title: '署名篇', slug: 'exp-signed', summary: 's', content_md: '正文', status: 'published', created_by: a.id },
    ['标一'],
  );
  assert.ok(r);
  await setPostAuthors(db, r!.post.id, [a.id, b.id]);

  const snap = await exportFullSnapshot(db);
  assert.deepEqual(
    snap.post_authors.map((x) => [x.post_id, x.user_id, x.sort_order]).filter((x) => x[0] === r!.post.id),
    [
      [r!.post.id, a.id, 0],
      [r!.post.id, b.id, 1],
    ],
    '署名顺序应完整进快照',
  );
  assert.equal(snap.collection_invites.length, 1, '协作申请应进快照');
  assert.equal(snap.collections.find((x) => x.id === col!.id)?.created_by, a.id, '文集归属人应进快照');
  assert.equal(snap.collections.find((x) => x.id === col!.id)?.is_public, 0, '公用标记应进快照');
  const exportedUsers = snap.users as Array<Record<string, unknown>>;
  assert.equal(exportedUsers.find((u) => u.username === 'exp-author-a')?.bio, '简介甲', '用户简介应进快照');

  const md = await exportPostMarkdown(db, r!.post.id);
  assert.ok(md);
  assert.ok(md!.body.includes('authors: ["exp-author-a", "exp-author-b"]'), '单篇 frontmatter 应带署名用户名');
  assert.ok(md!.body.includes('author_names: ["导出甲", "导出乙"]'), '并带展示名');
});