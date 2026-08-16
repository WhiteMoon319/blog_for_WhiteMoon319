import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchPublishedPosts,
  incrementViewCount,
  createPost,
  updatePost,
  getPostById,
  countPublishedPosts,
  listPublishedPosts,
  countArchivedPosts,
  listArchivedPosts,
  listPostVersions,
  getPostVersion,
} from '../src/lib/db.ts';
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