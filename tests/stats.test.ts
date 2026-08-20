import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, type TestDbHandle } from './helpers/d1.ts';
import { createPostWithTags } from '../src/lib/db/posts.ts';
import {
  getTrendStats,
  isBotRequest,
  lastNDays,
  recordDailyView,
  viewDay,
} from '../src/lib/db/stats.ts';

let h: TestDbHandle;

before(async () => {
  h = await makeTestDb();
});

after(async () => {
  await h.dispose();
});

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://e2e.test/posts/x/', { headers });
}

test('趋势：机器人 UA 识别', () => {
  assert.equal(isBotRequest(req({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0)' })), false);
  assert.equal(isBotRequest(req({ 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' })), true);
  assert.equal(isBotRequest(req({ 'User-Agent': 'curl/8.0.1' })), true);
  assert.equal(isBotRequest(req({ 'User-Agent': 'python-requests/2.31.0' })), true);
});

test('趋势：同 IP 同文同日去重，异 IP 累加', async () => {
  const created = await createPostWithTags(h.db, { title: '统计甲', slug: 'stats-a', status: 'published' }, []);
  assert.ok(created);
  const id = created.post.id;

  await recordDailyView(h.db, id, req({ 'CF-Connecting-IP': '1.1.1.1', 'User-Agent': 'Mozilla/5.0' }));
  await recordDailyView(h.db, id, req({ 'CF-Connecting-IP': '1.1.1.1', 'User-Agent': 'Mozilla/5.0' }));
  await recordDailyView(h.db, id, req({ 'CF-Connecting-IP': '2.2.2.2', 'User-Agent': 'Mozilla/5.0' }));

  const today = viewDay();
  const rows = await h.db
    .prepare('SELECT views FROM daily_views WHERE post_id = ? AND day = ?')
    .bind(id, today)
    .first<{ views: number }>();
  assert.equal(rows?.views, 2, '同 IP 重复访问只计 1 次，异 IP 再计 1 次');
});

test('趋势：机器人访问不进入日聚合', async () => {
  const created = await createPostWithTags(h.db, { title: '统计乙', slug: 'stats-b', status: 'published' }, []);
  assert.ok(created);
  await recordDailyView(h.db, created.post.id, req({ 'CF-Connecting-IP': '3.3.3.3', 'User-Agent': 'Googlebot/2.1' }));
  await recordDailyView(h.db, created.post.id, req({ 'CF-Connecting-IP': '4.4.4.4', 'User-Agent': 'curl/8.0' }));
  const today = viewDay();
  const rows = await h.db
    .prepare('SELECT views FROM daily_views WHERE post_id = ? AND day = ?')
    .bind(created.post.id, today)
    .first<{ views: number }>();
  assert.equal(rows, null, '爬虫与脚本访问不计入');
});

test('趋势：view_count 仍按原始访问累加（不受去重影响）', async () => {
  const created = await createPostWithTags(h.db, { title: '统计丙', slug: 'stats-c', status: 'published' }, []);
  assert.ok(created);
  await recordDailyView(h.db, created.post.id, req({ 'CF-Connecting-IP': '5.5.5.5' }));
  await recordDailyView(h.db, created.post.id, req({ 'CF-Connecting-IP': '5.5.5.5' }));
  const row = await h.db
    .prepare('SELECT view_count FROM posts WHERE id = ?')
    .bind(created.post.id)
    .first<{ view_count: number }>();
  assert.equal(row?.view_count, 0, 'recordDailyView 只写日聚合，不动 view_count');
});

test('趋势：getTrendStats 汇总序列与热文 TOP', async () => {
  const a = await createPostWithTags(h.db, { title: '热文甲', slug: 'stats-top-a', status: 'published' }, []);
  const b = await createPostWithTags(h.db, { title: '热文乙', slug: 'stats-top-b', status: 'published' }, []);
  assert.ok(a && b);
  const today = viewDay();
  await recordDailyView(h.db, a.post.id, req({ 'CF-Connecting-IP': '10.0.0.1' }));
  await recordDailyView(h.db, a.post.id, req({ 'CF-Connecting-IP': '10.0.0.2' }));
  await recordDailyView(h.db, a.post.id, req({ 'CF-Connecting-IP': '10.0.0.3' }));
  await recordDailyView(h.db, b.post.id, req({ 'CF-Connecting-IP': '10.0.0.4' }));

  const s = await getTrendStats(h.db, 30);
  assert.equal(s.days, 30);
  assert.equal(s.daily.length, 30);
  const todayRow = s.daily.find((d) => d.day === today);
  assert.ok(todayRow && todayRow.views >= 4, '今日合计至少两文 4 次（其他用例的同日数据也在内）');
  assert.ok(s.total_views >= 4);
  assert.equal(s.top_posts[0]?.id, a.post.id, '热文甲居首（3 次，无人超越）');
  assert.equal(s.top_posts[0]?.views, 3);
  assert.ok(s.top_posts.some((t) => t.id === b.post.id), '热文乙应进入 TOP');
  assert.equal(s.daily[0].day, lastNDays(30)[0], '序列从区间首日补齐');
});

test('趋势：软删除文章统计保留且标题标注', async () => {
  const created = await createPostWithTags(h.db, { title: '将被删除', slug: 'stats-del', status: 'published' }, []);
  assert.ok(created);
  await recordDailyView(h.db, created.post.id, req({ 'CF-Connecting-IP': '10.0.0.9' }));
  await h.db.prepare("UPDATE posts SET deleted_at = datetime('now') WHERE id = ?").bind(created.post.id).run();
  const s = await getTrendStats(h.db, 30);
  assert.ok(s.top_posts.some((t) => t.id === created.post.id), '回收站文章仍保留在热文统计');
});