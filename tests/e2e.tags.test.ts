import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeE2e, HAS_BUILD, type E2eClient } from './helpers/e2e.ts';

let c: E2eClient;

before(async () => {
  if (!HAS_BUILD) return;
  c = await makeE2e();
});

after(async () => {
  if (c) await c.dispose();
});

test('e2e：标签——文集继承、自有叠加、标签页规则、孤儿清理', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const tagName = '玄幻试';
  const tagPath = `/tags/${encodeURIComponent(tagName)}/`;

  const created = await c.post('/api/collections', {
    title: '标引测试集',
    slug: 'tag-e2e-col',
    summary: 'e2e',
    tags: [tagName],
  });
  assert.equal(created.status, 201);
  const colBody = await created.json();
  assert.ok(Array.isArray(colBody.tags) && colBody.tags.some((t: { name: string }) => t.name === tagName), '创建响应带 tags');
  const colId = colBody.collection.id as number;

  const chRes = await c.post('/api/posts', {
    title: '标引章甲',
    slug: 'tag-e2e-a',
    collection_id: colId,
    content_md: '## 正文\n\n内容。',
    status: 'published',
    tags: ['番外试'],
  });
  assert.equal(chRes.status, 201);
  const chId = (await chRes.json()).post.id as number;

  const looseRes = await c.post('/api/posts', {
    title: '标引散篇',
    slug: 'tag-e2e-loose',
    content_md: '## 正文\n\n内容。',
    status: 'published',
    tags: [tagName],
  });
  assert.equal(looseRes.status, 201);
  const looseId = (await looseRes.json()).post.id as number;

  const got = await c.get(`/api/posts/${chId}`);
  assert.equal(got.status, 200);
  const gotBody = await got.json();
  assert.deepEqual(
    (gotBody.tags as Array<{ name: string }>).map((t) => t.name),
    ['番外试'],
    '编辑器读取文章自带标签',
  );

  const cloud = await c.get('/tags/');
  assert.equal(cloud.status, 200);
  const cloudHtml = await cloud.text();
  assert.ok(cloudHtml.includes(tagName), '标签云出现该标签');
  assert.ok(cloudHtml.includes('文集 1 · 文章 1'), '标签云计数分单位显示（文集/文章）');

  const tagPage = await c.get(tagPath);
  assert.equal(tagPage.status, 200);
  const tagHtml = await tagPage.text();
  assert.ok(tagHtml.includes('标引测试集'), '独立标签页出现文集卡');
  assert.ok(tagHtml.includes('标引散篇'), '独立标签页出现未分类文章');
  assert.ok(!tagHtml.includes('<h3 class="post-title">标引章甲</h3>'), '继承的章甲不单独展开');
  assert.ok(tagHtml.includes('collection-members'), '文集卡带可展开的成员列表');

  const inlinePage = await c.get(`/tags/?t=${encodeURIComponent(tagName)}`);
  assert.equal(inlinePage.status, 200);
  const inlineHtml = await inlinePage.text();
  assert.ok(inlineHtml.includes('标引测试集'), '内联页出现文集卡');
  assert.ok(inlineHtml.includes('标引散篇'), '内联页出现未分类文章');
  assert.ok(!inlineHtml.includes('<h3 class="post-title">标引章甲</h3>'), '继承的章甲不单独展开');
  assert.ok(inlineHtml.includes('<details'), '文集卡为可折叠两级展示');

  const unionPage = await c.get(`/tags/?t=${encodeURIComponent(tagName)}&t=${encodeURIComponent('番外试')}`);
  assert.equal(unionPage.status, 200);
  const unionHtml = await unionPage.text();
  assert.ok(unionHtml.includes('标引章甲'), '交集：章甲自有番外试且继承玄幻试，同时具备两标 → 单独露出');
  assert.ok(!unionHtml.includes('标引测试集'), '交集：文集只带玄幻试，不具备全部选中标签 → 不出现');
  assert.ok(!unionHtml.includes('标引散篇'), '交集：散篇只带玄幻试 → 不出现');

  const chapter = await c.get('/collections/tag-e2e-col/tag-e2e-a/');
  assert.equal(chapter.status, 200);
  assert.ok((await chapter.text()).includes(tagName), '章节页展示继承的文集标签');

  const tagSearch = await c.get(`/search/?q=${encodeURIComponent(`#${tagName}`)}`);
  assert.equal(tagSearch.status, 302, '「#标签」检索应转标签页');
  assert.ok(
    String(tagSearch.headers.get('location')).includes(`/tags/?t=${encodeURIComponent(tagName)}`),
    '单标签转跳到 /tags/ 内联页',
  );

  const multiSearch = await c.get(`/search/?q=${encodeURIComponent(`#${tagName} #番外试`)}`);
  assert.equal(multiSearch.status, 302, '「#标签1 #标签2」多标签应转标签页');
  assert.ok(
    String(multiSearch.headers.get('location')).includes(`/tags/?t=${encodeURIComponent(tagName)}&t=${encodeURIComponent('番外试')}`),
    '多标签参数依次携带',
  );

  const plainSearch = await c.get(`/search/?q=${encodeURIComponent(tagName)}`);
  assert.equal(plainSearch.status, 200, '不带 # 仍是普通全文检索');
  assert.ok(!(await plainSearch.text()).includes('标引测试集'), '普通检索不出现标签页内容');

  const missingTag = await c.get(`/search/?q=${encodeURIComponent('#不存在的标签XYZ')}`);
  assert.equal(missingTag.status, 200);
  assert.ok((await missingTag.text()).includes('尚未建立'), '未创建的标签给出空态提示');

  const halfMissing = await c.get(`/search/?q=${encodeURIComponent(`#不存在的标签XYZ #${tagName}`)}`);
  assert.equal(halfMissing.status, 200, '任一标签不存在都不转跳');
  assert.ok((await halfMissing.text()).includes('尚未建立'), '提示指向缺失的标签');

  const missingNoSideEffect = await c.get(`/search/?q=${encodeURIComponent('#不存在的标签XYZ')}`);
  assert.equal(missingNoSideEffect.status, 200);
  assert.ok((await missingNoSideEffect.text()).includes('尚未建立'), '查询本身不转跳、不创建');
  const cloudAfter = await c.get('/tags/');
  assert.ok(!(await cloudAfter.text()).includes('不存在的标签XYZ'), '标签云未出现被查询过的空标签');
  const ghostInline = await c.get(`/tags/?t=${encodeURIComponent('不存在的标签XYZ')}`);
  assert.equal(ghostInline.status, 200);
  const ghostHtml = await ghostInline.text();
  assert.ok(ghostHtml.includes('尚无著作'), '直接访问未知标签内联页给空态，不落入全部浏览');
  assert.ok(!ghostHtml.includes('<details class="collection-block'), '未知标签不渲染任何文集卡');

  const inTagSearch = await c.get(`/search/?q=${encodeURIComponent(`#${tagName} 章甲`)}`);
  assert.equal(inTagSearch.status, 302, '「#标签 关键词」应转标签内联页');
  assert.ok(
    String(inTagSearch.headers.get('location')).includes(`/tags/?t=${encodeURIComponent(tagName)}&q=${encodeURIComponent('章甲')}`),
    '转跳地址携带标签内关键词',
  );
  const inTagInline = await c.get(`/tags/?t=${encodeURIComponent(tagName)}&q=${encodeURIComponent('章甲')}`);
  assert.equal(inTagInline.status, 200);
  const inTagHtml = await inTagInline.text();
  assert.ok(inTagHtml.includes('标引章甲'), '标签内寻章能命中具体章节');
  assert.ok(!inTagHtml.includes('标引散篇'), '不匹配的文章不出现');
  const inTagMiss = await c.get(`/tags/?t=${encodeURIComponent(tagName)}&q=${encodeURIComponent('查无此词')}`);
  assert.ok((await inTagMiss.text()).includes('未寻得'), '标签内无命中给出空态');

  const apiTags = await c.get('/api/tags');
  assert.equal(apiTags.status, 200);
  const apiTagsBody = await apiTags.json();
  const found = (apiTagsBody.tags as Array<{ name: string; collections: number; posts: number }>).find(
    (t) => t.name === tagName,
  );
  assert.ok(found, '管理端标签建议接口列出该标签');
  assert.equal(found!.collections, 1);
  assert.equal(found!.posts, 1, '只计未分类散篇，继承的章甲不计');

  const delRes = await c.del(`/api/posts/${looseId}`);
  assert.equal(delRes.status, 200);
  const delRes2 = await c.del(`/api/posts/${chId}`);
  assert.equal(delRes2.status, 200);
  const delColRes = await c.del(`/api/collections/${colId}`);
  assert.equal(delColRes.status, 200);

  const after = await c.get('/tags/');
  assert.ok(!(await after.text()).includes(tagName), '删除后孤儿标签被清理');
});

test('e2e：含 % 的标签名经 URL 参数访问不 500（无双重解码）', async () => {
  if (!HAS_BUILD) return;
  const res = await c.get('/tags/?t=100%25');
  assert.equal(res.status, 200, '含 % 的标签参数不应触发双重解码 500');
  const res2 = await c.get('/tags/100%25/');
  assert.equal(res2.status, 302, '未知标签详情路由应跳 /404 而非 500');
});