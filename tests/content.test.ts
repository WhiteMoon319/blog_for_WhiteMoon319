import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchPublishedPosts,
  incrementViewCount,
  createPost,
  updatePost,
  createCollection,
  deleteCollection,
  getPostById,
  countPublishedPosts,
  listPublishedPosts,
  countArchivedPosts,
  listArchivedPosts,
  listPosts,
  listPostVersions,
  getPostVersion,
  trashPosts,
  restorePosts,
} from '../src/lib/db/index.ts';
import { makeTestDb } from './helpers/d1.ts';

const handle = await makeTestDb();
after(() => handle.dispose());
const db = handle.db;

test('搜索：命中标题/摘要/正文，草稿不出现', async () => {
  await createPost(db, {
    title: '字诀：墨分五色',
    slug: 'ink-probe',
    summary: '研墨心得',
    content_md: '淡墨写疏影，浓墨书重山。',
    status: 'published',
  });
  await createPost(db, {
    title: '草稿：未成篇',
    slug: 'draft-probe',
    summary: '藏而不发',
    content_md: '密语藏锋。',
    status: 'draft',
  });

  const byTitle = await searchPublishedPosts(db, '墨分五色');
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0].slug, 'ink-probe');

  const byBody = await searchPublishedPosts(db, '疏影');
  assert.equal(byBody.length, 1);
  assert.equal(byBody[0].slug, 'ink-probe');

  const bySummary = await searchPublishedPosts(db, '研墨');
  assert.equal(bySummary.length, 1);

  const noDraft = await searchPublishedPosts(db, '草稿');
  assert.equal(noDraft.length, 0, '草稿不应被搜到');

  const miss = await searchPublishedPosts(db, '绝无此词');
  assert.equal(miss.length, 0);
});

test('阅读量：自增并返回最新值', async () => {
  const created = await createPost(db, {
    title: '计数试炼',
    slug: 'count-probe',
    content_md: '数数看。',
    status: 'published',
  });
  assert.ok(created);
  assert.equal(created.view_count, 0);

  const v1 = await incrementViewCount(db, created.id);
  const v2 = await incrementViewCount(db, created.id);
  assert.equal(v1, 1);
  assert.equal(v2, 2);

  const row = await getPostById(db, created.id);
  assert.equal(row?.view_count, 2);
});

test('分页：count 与 limit/offset 正确，含/不含文集过滤', async () => {
  const col = await db
    .prepare(`INSERT INTO collections (title, slug, summary, theme_color, sort_order) VALUES ('甲集', 'jia', '', '#c23a30', 1) RETURNING id`)
    .first<{ id: number }>();
  assert.ok(col);
  for (let i = 0; i < 5; i++) {
    const created = await createPost(db, {
      title: `甲集第${i}篇`,
      slug: `jia-${i}`,
      content_md: `正文 ${i}`,
      status: 'published',
      collection_id: col.id,
    });
    assert.ok(created);
    await db
      .prepare(`UPDATE posts SET created_at = datetime('2026-02-01 00:00:00', '+' || ? || ' seconds') WHERE id = ?`)
      .bind(i, created.id)
      .run();
  }
  const san = await createPost(db, {
    title: '散篇',
    slug: 'san',
    content_md: '无文集。',
    status: 'published',
  });
  assert.ok(san);
  await db
    .prepare(`UPDATE posts SET created_at = '2027-01-01 00:00:00' WHERE id = ?`)
    .bind(san.id)
    .run();

  const total = await countArchivedPosts(db);
  assert.equal(total, 8);

  const inCol = await countPublishedPosts(db, { collectionId: col.id });
  assert.equal(inCol, 5);
  const unclassified = await countPublishedPosts(db, { collectionId: null });
  assert.equal(unclassified, 3, '散篇与先前无文集文章合计 3');

  const page1 = await listPublishedPosts(db, { collectionId: col.id, limit: 2, offset: 0 });
  const page2 = await listPublishedPosts(db, { collectionId: col.id, limit: 2, offset: 2 });
  assert.equal(page1.length, 2);
  assert.equal(page2.length, 2);
  assert.notEqual(page1[0].id, page2[0].id, '两页不应重叠');

  const archivePage1 = await listArchivedPosts(db, { limit: 3, offset: 0 });
  const archivePage3 = await listArchivedPosts(db, { limit: 3, offset: 6 });
  assert.equal(archivePage1.length, 3);
  assert.equal(archivePage3.length, 2, '末页应剩 2 条');
  assert.ok(archivePage3.some((p) => p.slug === 'san'), '末页应包含散篇');
});

test('版本史：创建即 v1，仅实质变更留档，可读取指定版本', async () => {
  const created = await createPost(db, {
    title: '版本试炼',
    slug: 'ver-probe',
    summary: '初版',
    content_md: '第一稿。',
    status: 'draft',
  });
  assert.ok(created);

  const v1 = await listPostVersions(db, created.id);
  assert.equal(v1.length, 1, '创建即留 v1');
  assert.equal(v1[0].version, 1);
  assert.equal(v1[0].message, '创建');
  assert.equal(v1[0].content_md, '第一稿。');

  const unchanged = await updatePost(db, created.id, { content_md: '第一稿。' });
  assert.ok(unchanged);
  assert.equal((await listPostVersions(db, created.id)).length, 1, '内容未变不应留档');

  await updatePost(db, created.id, { content_md: '第二稿，改了。' }, '重写正文');
  await updatePost(db, created.id, { title: '版本试炼改' }, '改题');
  const v3 = await listPostVersions(db, created.id);
  assert.equal(v3.length, 3, '两次实质修改应留 v2/v3');
  assert.equal(v3[0].version, 3, '列表按版本倒序');
  assert.equal(v3[0].message, '改题');
  assert.equal(v3[0].title, '版本试炼改');

  const old = await getPostVersion(db, created.id, 1);
  assert.ok(old);
  assert.equal(old.content_md, '第一稿。');
  assert.equal(old.title, '版本试炼');

  const missing = await getPostVersion(db, created.id, 99);
  assert.equal(missing, null);

  await updatePost(db, created.id, { summary: '' });
  assert.equal((await listPostVersions(db, created.id)).length, 4, '清空摘要也是实质变更');
});

test('offset-only：无 limit 带 offset 不生成非法 SQL', async () => {
  const rows = await listPosts(db, { offset: 1 });
  assert.ok(Array.isArray(rows), 'offset-only 查询应成功返回');
  const published = await listPosts(db, { status: 'published', offset: 2 });
  assert.ok(Array.isArray(published));
  const limited = await listPosts(db, { limit: 2, offset: 1 });
  assert.equal(limited.length, 2);
});

test('未分类 slug：重复创建被部分唯一索引拒绝', async () => {
  const a = await createPost(db, {
    title: '未分类甲',
    slug: 'uc-dup',
    content_md: '甲。',
    status: 'published',
  });
  assert.ok(a);
  await assert.rejects(
    () =>
      createPost(db, {
        title: '未分类乙',
        slug: 'uc-dup',
        content_md: '乙。',
        status: 'published',
      }),
    /UNIQUE constraint failed/,
    '未分类重复 slug 必须被数据库拒绝',
  );
});

test('删除文集：冲突文章确定性改 slug，未分类保持全局唯一', async () => {
  const col = await db
    .prepare(`INSERT INTO collections (title, slug, summary, theme_color, sort_order) VALUES ('散集', 'san-col', '', '#c23a30', 5) RETURNING id`)
    .first<{ id: number }>();
  assert.ok(col);

  const inCol = await createPost(db, {
    title: '入集',
    slug: 'conflict-x',
    collection_id: col.id,
    content_md: '在集内。',
    status: 'published',
  });
  assert.ok(inCol);
  const uncat = await createPost(db, {
    title: '散落',
    slug: 'conflict-x',
    content_md: '未分类。',
    status: 'published',
  });
  assert.ok(uncat);

  assert.equal(await deleteCollection(db, col.id), true);

  const moved = await getPostById(db, inCol.id);
  assert.equal(moved?.collection_id, null, '文集删除后文章转未分类');
  assert.equal(moved?.slug, 'conflict-x-2', '较旧一篇获得确定性后缀 -2');

  const keeper = await getPostById(db, uncat.id);
  assert.equal(keeper?.slug, 'conflict-x', '较新一篇保留原 slug');

  const both = await db
    .prepare(`SELECT COUNT(*) AS n FROM posts WHERE collection_id IS NULL AND slug IN ('conflict-x', 'conflict-x-2')`)
    .first<{ n: number }>();
  assert.equal(both?.n, 2);
});

test('版本史：并发保存不产生版本冲突或丢失', async () => {
  const created = await createPost(db, {
    title: '并发试炼',
    slug: 'conc-probe',
    content_md: 'v0',
    status: 'draft',
  });
  assert.ok(created);

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      updatePost(db, created.id, { content_md: `并发第 ${i} 稿` }, `并发 ${i}`),
    ),
  );

  const versions = await listPostVersions(db, created.id);
  assert.equal(versions.length, 11, '创建 v1 + 10 次并发保存共 11 个版本');
  const nums = versions.map((v) => v.version).sort((a, b) => a - b);
  assert.deepEqual(nums, Array.from({ length: 11 }, (_, i) => i + 1), '版本号必须连续且无重复');
});

test('版本史：版本写入失败时文章更新整体回滚', async () => {
  const created = await createPost(db, {
    title: '回滚试炼',
    slug: 'rb-probe',
    content_md: '原文。',
    status: 'draft',
  });
  assert.ok(created);

  await db
    .prepare(`CREATE TRIGGER fail_version_insert BEFORE INSERT ON post_versions
              BEGIN SELECT RAISE(ABORT, 'simulated version failure'); END`)
    .run();
  try {
    await assert.rejects(
      () => updatePost(db, created.id, { content_md: '改了但不该生效。' }, '测试'),
      /simulated version failure/,
    );
  } finally {
    await db.prepare('DROP TRIGGER fail_version_insert').run();
  }

  const row = await getPostById(db, created.id);
  assert.equal(row?.content_md, '原文。', '版本写入失败时文章更新必须回滚');
  assert.equal((await listPostVersions(db, created.id)).length, 1, '不应留下半提交的版本');
});

test('集内文章排序：post_order 控制旧在前（asc）或新在前（desc）', async () => {
  const novel = await createCollection(db, { title: '小说集', slug: 'novel-order', post_order: 'asc' });
  const blog = await createCollection(db, { title: '博客集', slug: 'blog-order', post_order: 'desc' });
  assert.ok(novel && blog);
  assert.equal(novel.post_order, 'asc');
  assert.equal(blog.post_order, 'desc');

  const mk = async (col: number, title: string, at: string) => {
    const p = await createPost(db, {
      collection_id: col,
      title,
      slug: `${title}`,
      content_md: '正文',
      status: 'published',
    });
    assert.ok(p);
    await db.prepare(`UPDATE posts SET created_at = ? WHERE id = ?`).bind(at, p.id).run();
    return p.id;
  };
  await mk(novel.id, '第一章', '2026-01-01 00:00:00');
  await mk(novel.id, '第二章', '2026-02-01 00:00:00');
  await mk(novel.id, '第三章', '2026-03-01 00:00:00');
  await mk(blog.id, '甲帖', '2026-01-01 00:00:00');
  await mk(blog.id, '乙帖', '2026-02-01 00:00:00');
  await mk(blog.id, '丙帖', '2026-03-01 00:00:00');

  const novelPosts = await listPublishedPosts(db, { collectionId: novel.id, order: novel.post_order });
  assert.deepEqual(
    novelPosts.map((p) => p.slug),
    ['第一章', '第二章', '第三章'],
    '小说集应第一章在前',
  );

  const blogPosts = await listPublishedPosts(db, { collectionId: blog.id, order: blog.post_order });
  assert.deepEqual(
    blogPosts.map((p) => p.slug),
    ['丙帖', '乙帖', '甲帖'],
    '博客集应最新在前',
  );
});

test('版本史：增量存储——小改存补丁、大改重新全量、读取时透明重建', async () => {
  const created = await createPost(db, {
    title: '增量试炼',
    slug: 'inc-probe',
    content_md: '第一版正文。\n\n这段文字保持原样，作为补丁的上下文。\n\n结尾为后续修改预留一些空间。',
    status: 'draft',
  });
  assert.ok(created);
  const id = created.id;

  // 创建即 v1 全量
  const raw1 = await db.prepare('SELECT content_md, base_version, content_md_patch FROM post_versions WHERE post_id = ? AND version = 1').bind(id).first<{ content_md: string; base_version: number | null; content_md_patch: string }>();
  assert.equal(raw1?.base_version, null, 'v1 应是全量快照');
  assert.ok((raw1?.content_md ?? '').includes('第一版正文'));

  // v2：小改一行 → 增量补丁，content_md 置空
  await updatePost(db, id, { content_md: '第二版正文。\n\n这段文字保持原样，作为补丁的上下文。\n\n结尾为后续修改预留一些空间。' }, '小改');
  const raw2 = await db.prepare('SELECT content_md, base_version, content_md_patch FROM post_versions WHERE post_id = ? AND version = 2').bind(id).first<{ content_md: string; base_version: number | null; content_md_patch: string }>();
  assert.equal(raw2?.base_version, 1, 'v2 应指向基准 v1');
  assert.equal(raw2?.content_md, '', '增量行正文置空');
  assert.ok((raw2?.content_md_patch ?? '').includes('@@'), '增量行应存 unified diff');

  // 读取重建：list/get 应还原完整全文
  let vers = await listPostVersions(db, id);
  assert.equal(vers.length, 2);
  assert.equal(vers[0].content_md, '第二版正文。\n\n这段文字保持原样，作为补丁的上下文。\n\n结尾为后续修改预留一些空间。');
  const got2 = await getPostVersion(db, id, 2);
  assert.equal(got2?.content_md, '第二版正文。\n\n这段文字保持原样，作为补丁的上下文。\n\n结尾为后续修改预留一些空间。');
  const got1 = await getPostVersion(db, id, 1);
  assert.equal(got1?.content_md, '第一版正文。\n\n这段文字保持原样，作为补丁的上下文。\n\n结尾为后续修改预留一些空间。');

  // v3：大幅度重写 → 补丁超过阈值，重新全量作为新基准
  const big = Array.from({ length: 60 }, (_, i) => `第 ${i} 段：全新内容，毫无保留地重写这里。`).join('\n');
  await updatePost(db, id, { content_md: big }, '大改');
  const raw3 = await db.prepare('SELECT content_md, base_version, content_md_patch FROM post_versions WHERE post_id = ? AND version = 3').bind(id).first<{ content_md: string; base_version: number | null; content_md_patch: string }>();
  assert.equal(raw3?.base_version, null, '大改应重新全量');
  assert.ok((raw3?.content_md ?? '').includes('全新内容'));
  assert.equal(raw3?.content_md_patch, '');

  // v4：在大改基础上小改 → 基准应为最新全量 v3
  await updatePost(db, id, { content_md: `${big}\n\n末尾追加一行。` }, '在 v3 基础上小改');
  const raw4 = await db.prepare('SELECT content_md, base_version FROM post_versions WHERE post_id = ? AND version = 4').bind(id).first<{ content_md: string; base_version: number | null }>();
  assert.equal(raw4?.base_version, 3, '增量基准应指向最近一次全量 v3');
  assert.equal(raw4?.content_md, '');

  vers = await listPostVersions(db, id);
  assert.equal(vers[0].version, 4);
  assert.equal(vers[0].content_md, `${big}\n\n末尾追加一行。`, '增量行应重建回完整全文');
  assert.equal(vers[1].version, 3);
  assert.equal(vers[1].content_md, big, '全量行直接可读');

// v5：正文未变的元数据变更（如标题）→ 仍以最近全量为基准存增量，重建当量=当前正文
  await updatePost(db, id, { title: '增量试炼（改题）' }, '改题');
  const raw5 = await db.prepare('SELECT message, content_md, base_version FROM post_versions WHERE post_id = ? AND version = 5').bind(id).first<{ message: string; content_md: string; base_version: number | null }>();
  assert.equal(raw5?.base_version, 3, '标题变更的版本仍指向最近全量 v3');
  assert.equal(raw5?.content_md, '', '正文未变时增量行正文置空');
  const got5 = await getPostVersion(db, id, 5);
  assert.equal(got5?.content_md, `${big}\n\n末尾追加一行。`, '标题变更版本重建正文应与当前正文一致');
});

test('版本史：移入回收站/恢复的增量留档不丢正文', async () => {
  const created = await createPost(db, {
    title: '回收增量',
    slug: 'trash-inc',
    content_md: '回收前正文。\n\n第二段。',
    status: 'published',
  });
  assert.ok(created);
  const id = created.id;

  await trashPosts(db, [id]);
  const raw = await db.prepare('SELECT message, content_md, base_version FROM post_versions WHERE post_id = ? AND version = 2').bind(id).first<{ message: string; content_md: string; base_version: number | null }>();
  assert.equal(raw?.message, '移入回收站');
  assert.equal(raw?.content_md, '', '状态类留档走增量');
  const got = await getPostVersion(db, id, 2);
  assert.equal(got?.content_md, '回收前正文。\n\n第二段。', '回收版本应重建出完整正文');

  await restorePosts(db, [id]);
  const got3 = await getPostVersion(db, id, 3);
  assert.equal(got3?.message, '恢复');
  assert.equal(got3?.content_md, '回收前正文。\n\n第二段。');
});

test('并发创建：版本必须挂在各自文章上，不得错配', async () => {
  const created = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      createPost(db, { title: `并发-${i}`, slug: `conc-${i}`, content_md: '正文', status: 'draft' }),
    ),
  );
  assert.ok(created.every((p) => p), '五篇都应创建成功');
  const ids = created.map((p) => p!.id);
  assert.equal(new Set(ids).size, 5, 'id 不得重复');

  const versions = await db
    .prepare(`SELECT post_id, title FROM post_versions ORDER BY post_id`)
    .all<{ post_id: number; title: string }>();
  const byPost = new Map<number, { title: string; count: number }>();
  for (const v of versions.results ?? []) {
    byPost.set(v.post_id, {
      title: v.title,
      count: (byPost.get(v.post_id)?.count ?? 0) + 1,
    });
  }
  for (const p of created) {
    const v = byPost.get(p!.id);
    assert.ok(v, '每篇都应有初始版本');
    assert.equal(v!.count, 1, '每篇恰好一个初始版本');
    assert.equal(v!.title, p!.title, '版本必须挂在本篇自己名下');
  }
});