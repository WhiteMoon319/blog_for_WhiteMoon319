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

test('publicBase：去除首尾空白与末尾斜杠', () => {
  assert.equal(publicBase('https://cdn.example'), 'https://cdn.example');
  assert.equal(publicBase('https://cdn.example/'), 'https://cdn.example');
  assert.equal(publicBase('https://cdn.example//'), 'https://cdn.example');
  assert.equal(publicBase(' https://cdn.example/ '), 'https://cdn.example');
  assert.equal(publicBase(''), '');
});