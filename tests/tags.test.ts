import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCollection,
  createPost,
  updatePost,
  setCollectionTags,
  setPostOwnTags,
  listCollectionTags,
  listPostOwnTags,
  listPostEffectiveTags,
  listAllTagCounts,
  getTagPage,
  getTagsUnion,
  deletePost,
  deleteCollection,
  getTagByName,
} from '../src/lib/db.ts';
import { makeTestDb } from './helpers/d1.ts';

const handle = await makeTestDb();
after(() => handle.dispose());
const db = handle.db;

test('标签：文集/文章自有标签可设置读取，有效标签 = 文集 ∪ 自有', async () => {
  const col = await createCollection(db, { title: '庄桂清', slug: 'zhuangguiqing' });
  assert.ok(col);
  const colTags = await setCollectionTags(db, col.id, ['校园', '恋爱']);
  assert.deepEqual(
    colTags.map((t) => t.name),
    ['恋爱', '校园'],
    '按名排序，两个标签都已建',
  );

  const p1 = await createPost(db, { title: '第一章', slug: 'zgq-01', collection_id: col.id, content_md: '正文' });
  const p2 = await createPost(db, { title: '未分类文', slug: 'loose-01', content_md: '正文', status: 'published' });
  assert.ok(p1 && p2);

  assert.deepEqual(
    (await listPostOwnTags(db, p1.id)).map((t) => t.name),
    [],
    '章一未加自有标签',
  );
  assert.deepEqual(
    (await listPostEffectiveTags(db, p1.id)).map((t) => t.name),
    ['恋爱', '校园'],
    '章一继承文集标签',
  );

  await setPostOwnTags(db, p1.id, ['番外']);
  assert.deepEqual(
    (await listPostOwnTags(db, p1.id)).map((t) => t.name),
    ['番外'],
  );
  assert.deepEqual(
    (await listPostEffectiveTags(db, p1.id)).map((t) => t.name),
    ['恋爱', '校园', '番外'],
    '有效标签并集且去重',
  );

  await setPostOwnTags(db, p2.id, ['校园']);
  assert.deepEqual(
    (await listPostEffectiveTags(db, p2.id)).map((t) => t.name),
    ['校园'],
  );
});

test('标签：替换式设置，删旧增新', async () => {
  const col = await createCollection(db, { title: '甲集', slug: 'tag-replace' });
  assert.ok(col);
  await setCollectionTags(db, col.id, ['武侠', '江湖']);
  await setCollectionTags(db, col.id, ['武侠', '玄幻']);
  assert.deepEqual(
    (await listCollectionTags(db, col.id)).map((t) => t.name),
    ['武侠', '玄幻'],
    '江湖被替换掉',
  );
  assert.equal((await getTagByName(db, '江湖'))?.name, '江湖', '替换只是解绑，标签实体仍在');
});

test('标签：云计数——继承不重复计，未覆盖的自有标签计', async () => {
  const col = await createCollection(db, { title: '乙集', slug: 'tag-cloud' });
  assert.ok(col);
  await setCollectionTags(db, col.id, ['云试甲']);
  const a = await createPost(db, { title: '章甲', slug: 'cloud-a', collection_id: col.id, content_md: '', status: 'published' });
  const b = await createPost(db, { title: '散篇乙', slug: 'cloud-b', content_md: '', status: 'published' });
  const c = await createPost(db, { title: '散篇丙', slug: 'cloud-c', content_md: '', status: 'draft' });
  const d = await createPost(db, { title: '章丁', slug: 'cloud-d', collection_id: col.id, content_md: '', status: 'published' });
  assert.ok(a && b && c && d);
  await setPostOwnTags(db, b.id, ['云试甲']);
  await setPostOwnTags(db, c.id, ['云试甲']);
  await setPostOwnTags(db, d.id, ['番外试']);

  const counts = await listAllTagCounts(db);
  const campus = counts.find((t) => t.name === '云试甲');
  const extra = counts.find((t) => t.name === '番外试');
  assert.ok(campus, '云试甲应在云中');
  assert.equal(campus!.collections, 1, '乙集带云试甲');
  assert.equal(campus!.posts, 1, '只有未分类散篇乙计一次（草稿丙不计、继承的章甲章丁不计）');
  assert.equal(campus!.total, 2);
  assert.equal(extra!.posts, 1, '章丁自有番外试，其文集未带番外试 → 单独计');
  assert.equal(extra!.collections, 0);
});

test('标签页：文集卡 + 未被覆盖的文章', async () => {
  const col = await createCollection(db, { title: '丙集', slug: 'tag-page' });
  assert.ok(col);
  await setCollectionTags(db, col.id, ['页试甲']);
  const inside = await createPost(db, { title: '章子', slug: 'tagp-in', collection_id: col.id, content_md: '', status: 'published' });
  const loose = await createPost(db, { title: '散篇子', slug: 'tagp-loose', content_md: '', status: 'published' });
  const looseDraft = await createPost(db, { title: '草稿子', slug: 'tagp-draft', content_md: '', status: 'draft' });
  assert.ok(inside && loose && looseDraft);
  await setPostOwnTags(db, loose.id, ['页试甲']);
  await setPostOwnTags(db, looseDraft.id, ['页试甲']);

  const page = await getTagPage(db, '页试甲');
  assert.ok(page);
  assert.deepEqual(
    page!.collections.map((c) => c.slug),
    ['tag-page'],
    '带页试甲的文集出现，含章数',
  );
  assert.equal(page!.collections[0]!.post_count, 1);
  assert.deepEqual(
    page!.posts.map((p) => p.slug),
    ['tagp-loose'],
    '只有未分类的散篇子（草稿子不出现，继承的章子由文集卡代表）',
  );
});

test('标签：删除文章/文集后孤儿标签被清理', async () => {
  const col = await createCollection(db, { title: '丁集', slug: 'tag-purge' });
  assert.ok(col);
  await setCollectionTags(db, col.id, ['孤标']);
  const p = await createPost(db, { title: '孤篇', slug: 'tagp-purge', content_md: '', status: 'published' });
  assert.ok(p);
  await setPostOwnTags(db, p.id, ['孤标']);
  assert.ok(await deletePost(db, p.id), '删除文章');
  assert.ok(await getTagByName(db, '孤标'), '文集仍带孤标，此时不应清理');
  assert.ok(await deleteCollection(db, col.id));
  assert.equal(await getTagByName(db, '孤标'), null, '文集也删后，孤标彻底清除');
});

test('标签：文集标签变更后继承即时生效（不落地复制）', async () => {
  const col = await createCollection(db, { title: '戊集', slug: 'tag-inherit' });
  assert.ok(col);
  await setCollectionTags(db, col.id, ['继承试甲']);
  const p = await createPost(db, { title: '章庚', slug: 'tagi-01', collection_id: col.id, content_md: '', status: 'published' });
  assert.ok(p);
  assert.deepEqual((await listPostEffectiveTags(db, p.id)).map((t) => t.name), ['继承试甲']);
  await setCollectionTags(db, col.id, ['继承试乙']);
  assert.deepEqual(
    (await listPostEffectiveTags(db, p.id)).map((t) => t.name),
    ['继承试乙'],
    '文集改标签，章节有效标签立刻跟随',
  );
  await updatePost(db, p.id, { title: '章庚改' });
  assert.deepEqual(
    (await listPostEffectiveTags(db, p.id)).map((t) => t.name),
    ['继承试乙'],
  );
});

test('标签：多标签交集——同时具备全部选中标签才命中，覆盖规则不变', async () => {
  const col = await createCollection(db, { title: '己集', slug: 'tag-union' });
  assert.ok(col);
  await setCollectionTags(db, col.id, ['并集试甲', '并集试乙']);
  const a = await createPost(db, { title: '章辛', slug: 'tu-in', collection_id: col.id, content_md: '正文', status: 'published' });
  const b = await createPost(db, { title: '章壬', slug: 'tu-own', collection_id: col.id, content_md: '正文', status: 'published' });
  const loose = await createPost(db, { title: '散篇癸', slug: 'tu-loose', content_md: '', status: 'published' });
  const loose2 = await createPost(db, { title: '散篇戊', slug: 'tu-loose2', content_md: '', status: 'published' });
  const loose3 = await createPost(db, { title: '散篇己', slug: 'tu-loose3', content_md: '', status: 'published' });
  assert.ok(a && b && loose && loose2 && loose3);
  await setPostOwnTags(db, b.id, ['并集试乙']);
  await setPostOwnTags(db, loose.id, ['并集试甲']);
  await setPostOwnTags(db, loose2.id, ['并集试乙']);
  await setPostOwnTags(db, loose3.id, ['并集试甲', '并集试乙']);

  const both = await getTagsUnion(db, ['并集试甲', '并集试乙']);
  assert.deepEqual(
    both.collections.map((c) => c.slug),
    ['tag-union'],
    '同时具备两个标签的文集出现',
  );
  assert.deepEqual(
    both.posts.map((p) => p.slug),
    ['tu-loose3'],
    '只出现自有标签涵盖全部选中标签、且未被文集卡覆盖的散篇',
  );
  assert.deepEqual(
    (both.collectionPosts.get(col.id) ?? []).map((p) => p.slug),
    ['tu-in', 'tu-own'],
    '展开列表 = 继承 ∪ 自有同时具备全部选中标签的章节',
  );

  const single = await getTagsUnion(db, ['并集试甲']);
  assert.deepEqual(
    single.posts.map((p) => p.slug),
    ['tu-loose3', 'tu-loose'],
    '单标签时多出只带试甲的散篇癸',
  );

  const kw = await getTagsUnion(db, ['并集试甲', '并集试乙'], '章辛');
  assert.deepEqual(kw.collections.map((c) => c.slug), [], '关键词不匹配文集名则不出现文集');
  assert.deepEqual(
    (kw.collectionPosts.get(col.id) ?? []).map((p) => p.slug),
    ['tu-in'],
    '标签内寻章命中具体章节',
  );
  assert.deepEqual(
    kw.posts.map((p) => p.slug),
    ['tu-in'],
    '关键词模式放宽到章节级，继承命中的章节也列出',
  );
});
