// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicBase } from '../src/lib/utils.ts';
import { articleLayoutClass } from '../src/core/utils.ts';
import { POST_LAYOUTS } from '../src/lib/db/types.ts';

test('publicBase：去除首尾空白与末尾斜杠', () => {
  assert.equal(publicBase('https://cdn.example'), 'https://cdn.example');
  assert.equal(publicBase('https://cdn.example/'), 'https://cdn.example');
  assert.equal(publicBase('https://cdn.example//'), 'https://cdn.example');
  assert.equal(publicBase(' https://cdn.example/ '), 'https://cdn.example');
  assert.equal(publicBase(''), '');
});

test('articleLayoutClass：白名单内映射 class，其余（含空串/未知值）返回空', () => {
  assert.equal(articleLayoutClass('wechat'), 'layout-wechat');
  assert.equal(articleLayoutClass('magazine'), 'layout-magazine');
  assert.equal(articleLayoutClass('warm'), 'layout-warm');
  assert.equal(articleLayoutClass(''), '');
  assert.equal(articleLayoutClass(null), '');
  assert.equal(articleLayoutClass(undefined), '');
  assert.equal(articleLayoutClass('dark'), '');
  assert.equal(articleLayoutClass(' layout-wechat'), '');
});

test('layout 白名单契约：POST_LAYOUTS 与 articleLayoutClass 取值一致', () => {
  // 库端允许的值 = 渲染端认的 class（空串=主题默认），两侧漂移即失败
  const mapped = POST_LAYOUTS.map((l) => articleLayoutClass(l));
  assert.deepEqual([...POST_LAYOUTS], ['', 'wechat', 'magazine', 'warm']);
  assert.deepEqual(mapped, ['', 'layout-wechat', 'layout-magazine', 'layout-warm']);
});