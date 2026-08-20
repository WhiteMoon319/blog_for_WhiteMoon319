import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeE2e, HAS_BUILD, ORIGIN_HEADERS, type E2eClient } from './helpers/e2e.ts';

let c: E2eClient;

before(async () => {
  if (!HAS_BUILD) return;
  c = await makeE2e();
});

after(async () => {
  if (c) await c.dispose();
});

test('e2e：/api/render 未登录 401', async () => {
  if (!HAS_BUILD) return;
  const r = await c.anon('/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
    body: JSON.stringify({ md: 'hi' }),
  });
  assert.equal(r.status, 401);
});

test('e2e：/api/render 缺 Origin 被 CSRF 拒绝', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const r = await c.raw('/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ md: 'hi' }),
  });
  assert.equal(r.status, 403);
});

test('e2e：/api/render 登录后渲染公式/表格/图表/高亮', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const md = [
    '# 标题',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '行内 $x^2$ 与 $$\n\\int_0^1 x\\,dx$$',
    '',
    '```mermaid',
    'graph TD',
    '  A-->B',
    '```',
    '',
    '```js',
    'const n = 1;',
    '```',
  ].join('\n');
  const r = await c.post('/api/render', { md });
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.equal(typeof s.html, 'string');
  assert.ok(Array.isArray(s.toc));
  assert.ok(s.html.includes('<h1 id="标题">标题</h1>'), '应渲染标题');
  assert.ok(s.html.includes('<table>'), '应渲染表格');
  assert.ok(s.html.includes('class="katex"'), '应渲染公式');
  assert.ok(s.html.includes('class="diagram mermaid"'), '应渲染 mermaid 容器');
  assert.ok(s.html.includes('class="language-js hljs"'), '应渲染代码高亮');
  assert.equal(s.toc[0].level, 1);
});

test('e2e：/api/render 超长内容返回 413', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const r = await c.post('/api/render', { md: 'a'.repeat(4_000_001) });
  assert.equal(r.status, 413);
});