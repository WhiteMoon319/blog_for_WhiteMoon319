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

const PAST = new Date(Date.now() - 3600_000).toISOString();
const FUTURE = new Date(Date.now() + 3600_000).toISOString();

test('e2e：scheduled 触发——到点定时草稿被刊发并公开可见', async () => {
  if (!HAS_BUILD) return;
  await c.login();

  // API 拒绝过去时间，先设未来，再直接把定时回拨到过去模拟「cron 到点」
  const created = await c.post('/api/posts', {
    title: '定时刊发 e2e',
    slug: 'sched-e2e',
    content_md: '正文',
    status: 'draft',
    scheduled_at: FUTURE,
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id;
  await c.sql('UPDATE posts SET scheduled_at = ? WHERE id = ?', PAST, id);

  const before_ = await c.anon('/posts/sched-e2e/');
  assert.equal(before_.status, 404, '到点但未触发 cron 时仍不可见');

  await c.triggerScheduled();

  const detail = await c.get(`/api/posts/${id}`);
  const detailJson = await detail.json();
  assert.equal(detailJson.post.status, 'published');
  assert.equal(detailJson.post.scheduled_at, null, '刊发后定时清空');

  const after_ = await c.anon('/posts/sched-e2e/');
  assert.equal(after_.status, 200, '触发后公开可见');

  await c.del(`/api/posts/${id}`);
});

test('e2e：定时 API 校验——过去时间/已刊带定时 400，未来定时可设可取消', async () => {
  if (!HAS_BUILD) return;
  await c.login();

  const past = await c.post('/api/posts', {
    title: '定时过去',
    slug: 'sched-past',
    status: 'draft',
    scheduled_at: PAST,
  });
  assert.equal(past.status, 400, '过去时间应被拒绝');

  const published = await c.post('/api/posts', {
    title: '已刊带定时',
    slug: 'sched-published',
    status: 'published',
    scheduled_at: FUTURE,
  });
  assert.equal(published.status, 400, '已刊文章带定时应被拒绝');

  const created = await c.post('/api/posts', {
    title: '定时未来',
    slug: 'sched-future',
    content_md: '正文',
    status: 'draft',
    scheduled_at: FUTURE,
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id;

  const manual = await c.put(`/api/posts/${id}`, { status: 'published' });
  assert.equal(manual.status, 200);
  assert.equal((await manual.json()).post.scheduled_at, null, '手动刊发应清空定时');

  const resched = await c.put(`/api/posts/${id}`, { status: 'draft', scheduled_at: FUTURE });
  assert.equal(resched.status, 200);
  assert.equal((await resched.json()).post.scheduled_at, FUTURE);

  const cancel = await c.put(`/api/posts/${id}`, { scheduled_at: '' });
  assert.equal(cancel.status, 200);
  assert.equal((await cancel.json()).post.scheduled_at, null, '空串取消定时');

  const invalid = await c.put(`/api/posts/${id}`, { scheduled_at: 'not-a-date' });
  assert.equal(invalid.status, 400, '非法时间应被拒绝');

  const pubWithSchedule = await c.put(`/api/posts/${id}`, { status: 'published', scheduled_at: FUTURE });
  assert.equal(pubWithSchedule.status, 400, '刊发的同时带定时应被拒绝');

  await c.del(`/api/posts/${id}`);
});

test('e2e：批量刊发/转草稿清空定时', async () => {
  if (!HAS_BUILD) return;
  await c.login();

  const created = await c.post('/api/posts', {
    title: '批量定时',
    slug: 'sched-bulk',
    content_md: '正文',
    status: 'draft',
    scheduled_at: FUTURE,
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).post.id;

  const publish = await c.post('/api/posts/batch', { action: 'publish', ids: [id] });
  assert.equal(publish.status, 200);
  const detail = await c.get(`/api/posts/${id}`);
  const detailJson = await detail.json();
  assert.equal(detailJson.post.status, 'published');
  assert.equal(detailJson.post.scheduled_at, null, '批量刊发清空定时');

  const backToDraft = await c.post('/api/posts/batch', { action: 'draft', ids: [id] });
  assert.equal(backToDraft.status, 200);
  const detail2 = await c.get(`/api/posts/${id}`);
  assert.equal((await detail2.json()).post.status, 'draft');

  await c.del(`/api/posts/${id}`);
});