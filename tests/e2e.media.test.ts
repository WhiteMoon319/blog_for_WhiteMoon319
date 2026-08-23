// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

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

test('e2e：上传白名单——PNG 通过、SVG 拒绝', async () => {
  if (!HAS_BUILD) return;
  await c.login();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4]);
  const good = c.multipart([{ name: 'file', filename: 'a.png', type: 'image/png', bytes: png }]);
  const up = await c.raw('/api/upload', {
    method: 'POST',
    headers: { ...ORIGIN_HEADERS, 'Content-Type': good.contentType },
    body: good.body,
  });
  assert.equal(up.status, 201);
  const upBody = await up.json();
  assert.ok(String(upBody.key).endsWith('.png'));
  const fileRes = await c.get(`/api/files/${upBody.key}`);
  assert.equal(fileRes.status, 200);
  assert.equal(fileRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(fileRes.headers.get('content-type'), 'image/png');

  const svg = new Uint8Array([0x3c, 0x73, 0x76, 0x67]);
  const badForm = c.multipart([{ name: 'file', filename: 'b.svg', type: 'image/svg+xml', bytes: svg }]);
  const bad = await c.raw('/api/upload', {
    method: 'POST',
    headers: { ...ORIGIN_HEADERS, 'Content-Type': badForm.contentType },
    body: badForm.body,
  });
  assert.equal(bad.status, 415);
});

test('e2e：媒体库——未登录 401，列表含已传文件，删除后文件 404', async () => {
  if (!HAS_BUILD) return;
  const anon = await c.anon('/api/media', { redirect: 'manual' });
  assert.equal(anon.status, 401);

  await c.login();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4]);
  const form = c.multipart([{ name: 'file', filename: 'm.png', type: 'image/png', bytes: png }]);
  const up = await c.raw('/api/upload', {
    method: 'POST',
    headers: { ...ORIGIN_HEADERS, 'Content-Type': form.contentType },
    body: form.body,
  });
  assert.equal(up.status, 201);
  const key = (await up.json()).key as string;
  assert.ok(key.startsWith('uploads/'), '上传 key 应有 uploads/ 前缀');

  const list = await c.get('/api/media');
  assert.equal(list.status, 200);
  const listBody = await list.json();
  const found = (listBody.files as Array<{ key: string; url: string }>).some((f) => f.key === key);
  assert.ok(found, '媒体列表应包含刚上传的文件');
  assert.ok(String((listBody.files as Array<{ url: string }>)[0].url).includes('/api/files/'), '无 R2_PUBLIC_URL 时用站内路径');

  const bad = await c.del(`/api/media?key=${encodeURIComponent('etc/passwd')}`);
  assert.equal(bad.status, 400, '非 uploads/ 前缀应拒绝');

  const delRes = await c.del(`/api/media?key=${encodeURIComponent(key)}`);
  assert.equal(delRes.status, 200);
  const gone = await c.get(`/api/files/${key}`);
  assert.equal(gone.status, 404, '删除后文件应不可再取');
});