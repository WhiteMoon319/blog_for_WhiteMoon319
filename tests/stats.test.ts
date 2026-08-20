import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, type TestDbHandle } from './helpers/d1.ts';
import { createPostWithTags } from '../src/lib/db/posts.ts';
import {
  getCorpusStats,
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

test('字数：全站与文集维度统计', async () => {
  const colA = await h.db
    .prepare("INSERT INTO collections (title, slug, summary, theme_color, sort_order, post_order) VALUES ('文集甲', 'stats-col-a', '', '#888888', 1, 'asc')")
    .run();
  const colB = await h.db
    .prepare("INSERT INTO collections (title, slug, summary, theme_color, sort_order, post_order) VALUES ('文集乙', 'stats-col-b', '', '#888888', 2, 'asc')")
    .run();
  const colIdA = colA.meta.last_row_id;
  const colIdB = colB.meta.last_row_id;
  assert.ok(colIdA > 0 && colIdB > 0);

  // 共享库有其他用例的文章：用「增量」断言隔离影响
  const wholeBefore = await getCorpusStats(h.db);
  const unassignedBefore = await getCorpusStats(h.db, null);
  const inABefore = await getCorpusStats(h.db, colIdA);
  const inBBefore = await getCorpusStats(h.db, colIdB);

  const [a, b, c, d] = await Promise.all([
    createPostWithTags(h.db, { title: '字数甲', slug: 'stats-char-a', status: 'published', content_md: '甲'.repeat(100) }, []),
    createPostWithTags(h.db, { title: '字数乙', slug: 'stats-char-b', status: 'draft', content_md: '乙'.repeat(50) }, []),
    createPostWithTags(h.db, { title: '字数丙', slug: 'stats-char-c', status: 'published', content_md: '丙'.repeat(30) }, []),
    createPostWithTags(h.db, { title: '字数丁', slug: 'stats-char-d', status: 'published', content_md: '丁'.repeat(10) }, []),
  ]);
  assert.ok(a && b && c && d);
  await h.db
    .prepare('UPDATE posts SET collection_id = ? WHERE id IN (?, ?)')
    .bind(colIdA, a.post.id, b.post.id)
    .run();
  await h.db
    .prepare('UPDATE posts SET collection_id = ? WHERE id = ?')
    .bind(colIdB, c.post.id)
    .run();

  const whole = await getCorpusStats(h.db);
  assert.equal(whole.total_chars - wholeBefore.total_chars, 190, '全站增量 100+50+30+10');
  assert.equal(whole.published_chars - wholeBefore.published_chars, 140, '已刊增量 100+30+10');
  assert.equal(whole.post_count - wholeBefore.post_count, 4);

  const inA = await getCorpusStats(h.db, colIdA);
  assert.equal(inA.total_chars - inABefore.total_chars, 150, '文集甲增量 100+50');
  assert.equal(inA.published_chars - inABefore.published_chars, 100);
  assert.equal(inA.post_count - inABefore.post_count, 2);

  const inB = await getCorpusStats(h.db, colIdB);
  assert.equal(inB.total_chars - inBBefore.total_chars, 30);

  const unassigned = await getCorpusStats(h.db, null);
  assert.equal(unassigned.total_chars - unassignedBefore.total_chars, 10, '未分类仅 丁');
  assert.equal(unassigned.post_count - unassignedBefore.post_count, 1);

  const deleted = await createPostWithTags(h.db, { title: '字数废', slug: 'stats-char-x', status: 'published', content_md: 'x'.repeat(99) }, []);
  assert.ok(deleted);
  await h.db.prepare("UPDATE posts SET deleted_at = datetime('now') WHERE id = ?").bind(deleted.post.id).run();
  const after = await getCorpusStats(h.db);
  assert.equal(after.total_chars - wholeBefore.total_chars, 190, '回收站不计入字数');
});