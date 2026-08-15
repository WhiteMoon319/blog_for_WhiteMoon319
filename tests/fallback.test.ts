import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('admin SPA 产物存在且可作 fallback（构建顺序回归守卫）', (t) => {
  const p = resolve('dist/admin/index.html');
  if (!existsSync(p)) {
    t.skip('dist 未构建，先运行 npm run build');
    return;
  }
  const html = readFileSync(p, 'utf8');
  assert.ok(html.includes('id="app"'), '应包含 SPA 挂载点');
  assert.ok(html.includes('/admin/'), '应使用 /admin/ 基路径');
});