// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('admin SPA 产物存在且可作 fallback（构建顺序回归守卫）', (t) => {
  const p = resolve('dist/client/admin/index.html');
  if (!existsSync(p)) {
    t.skip('dist/client/admin 未构建，先运行 pnpm run build');
    return;
  }
  const html = readFileSync(p, 'utf8');
  assert.ok(html.includes('id="app"'), '应包含 SPA 挂载点');
  assert.ok(html.includes('/admin/'), '应使用 /admin/ 基路径');
});