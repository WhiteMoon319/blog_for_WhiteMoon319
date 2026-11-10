// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// 备案信息（ICP + 公安联网备案）的端到端测试
// ============================================================================
//
// 覆盖点：
//   1. 默认关闭：页脚不出现任何备案内容（未备案站点不受打扰）
//   2. 开启 ICP：渲染号码 + 工信部链接
//   3. 开启公安备案：渲染号码 + 国徽图标 + code 参数为纯数字
//   4. 两个开关互相独立
//   5. 关闭开关不丢号码（重新打开即恢复）
//   6. 非法开关值被 API 拒绝

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeE2e, HAS_BUILD, type E2eClient } from './helpers/e2e.ts';
import { mpsQueryCode } from '../src/core/utils.ts';

const ICP = '渝ICP备2026024373号-1';
const MPS = '渝公网安备50022302000935号';
const MPS_CODE = '50022302000935';

let c: E2eClient;

before(async () => {
  if (!HAS_BUILD) return;
  c = await makeE2e();
});

after(async () => {
  if (c) await c.dispose();
});

test('备案：默认关闭时页脚不渲染任何备案内容', async () => {
  if (!HAS_BUILD) return;
  const res = await c.get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes('ICP备'), '默认不应出现 ICP 备案');
  assert.ok(!html.includes('公网安备'), '默认不应出现公安备案');
  assert.ok(!html.includes('beian-mps.png'), '默认不应加载国徽图标');
});

test('备案：开启 ICP 后渲染号码与工信部链接', async () => {
  if (!HAS_BUILD) return;
  await c.login();

  const save = await c.put('/api/settings', {
    beian_icp_enabled: '1',
    beian_icp: ICP,
  });
  assert.equal(save.status, 200);

  const html = await (await c.get('/')).text();
  assert.ok(html.includes(ICP), '应显示 ICP 备案号');
  assert.ok(html.includes('https://beian.miit.gov.cn/'), '应链到工信部备案系统');

  // 关闭后号码保留但不显示
  const off = await c.put('/api/settings', { beian_icp_enabled: '0' });
  assert.equal(off.status, 200);
  const after = await (await c.get('/')).text();
  assert.ok(!after.includes(ICP), '关闭后不应显示');

  // 重新打开应恢复（说明号码没被清掉）
  await c.put('/api/settings', { beian_icp_enabled: '1' });
  const again = await (await c.get('/')).text();
  assert.ok(again.includes(ICP), '重新打开应恢复显示，号码未丢失');
});

test('备案：开启公安备案后渲染图标与数字编号链接', async () => {
  if (!HAS_BUILD) return;
  await c.login();

  const save = await c.put('/api/settings', {
    beian_mps_enabled: '1',
    beian_mps: MPS,
  });
  assert.equal(save.status, 200);

  const html = await (await c.get('/')).text();
  assert.ok(html.includes(MPS), '应显示公安备案号');
  assert.ok(html.includes('/assets/image/beian-mps.png'), '应包含国徽图标');
  assert.ok(html.includes(`code=${MPS_CODE}`), 'code 参数必须是纯数字编号（不能是整串中文）');
});

test('备案：两个开关互相独立', async () => {
  if (!HAS_BUILD) return;
  await c.login();

  // 只开公安、关 ICP
  await c.put('/api/settings', {
    beian_icp_enabled: '0',
    beian_icp: ICP,
    beian_mps_enabled: '1',
    beian_mps: MPS,
  });
  const html = await (await c.get('/')).text();
  assert.ok(!html.includes(ICP), 'ICP 关闭时不应显示');
  assert.ok(html.includes(MPS), '公安备案开启时应显示');

  // 反过来：只开 ICP、关公安
  await c.put('/api/settings', {
    beian_icp_enabled: '1',
    beian_mps_enabled: '0',
  });
  const html2 = await (await c.get('/')).text();
  assert.ok(html2.includes(ICP), 'ICP 开启时应显示');
  assert.ok(!html2.includes(MPS), '公安备案关闭时不应显示');
  assert.ok(!html2.includes('beian-mps.png'), '关闭时不应加载国徽图标');
});

test('备案：非法开关值被 API 拒绝', async () => {
  if (!HAS_BUILD) return;
  await c.login();

  const bad1 = await c.put('/api/settings', { beian_icp_enabled: '2' });
  assert.equal(bad1.status, 400, 'beian_icp_enabled 只接受 0/1');

  const bad2 = await c.put('/api/settings', { beian_mps_enabled: 'yes' });
  assert.equal(bad2.status, 400, 'beian_mps_enabled 只接受 0/1');

  const tooLong = await c.put('/api/settings', { beian_icp: 'x'.repeat(65) });
  assert.equal(tooLong.status, 400, '备案号超长应被拒');
});

test('备案：mpsQueryCode 从各种写法里抽出数字编号', () => {
  assert.equal(mpsQueryCode('渝公网安备50022302000935号'), '50022302000935');
  assert.equal(mpsQueryCode('渝公网安备 50022302000935 号'), '50022302000935');
  assert.equal(mpsQueryCode('50022302000935'), '50022302000935');
  assert.equal(mpsQueryCode('渝公网安备50022302000935号-1'), '50022302000935');
  assert.equal(mpsQueryCode('公网安备50022302000935号'), '50022302000935');
  // 抽不出数字时返回空串，调用方回退到查询首页
  assert.equal(mpsQueryCode('公网安备号'), '');
  assert.equal(mpsQueryCode(''), '');
});
