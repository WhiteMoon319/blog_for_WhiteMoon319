// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, safeJsonLd } from '../src/lib/seo.ts';

test('escapeXml：转义 XML 特殊字符', () => {
  assert.equal(escapeXml('a & b'), 'a &amp; b');
  assert.equal(escapeXml('<b>与</b>'), '&lt;b&gt;与&lt;/b&gt;');
  assert.equal(escapeXml('引号"与\'撇'), '引号&quot;与&apos;撇');
  assert.equal(escapeXml('无特殊'), '无特殊');
});

test('safeJsonLd：防 </script> 提前闭合，其余 JSON 原样', () => {
  const out = safeJsonLd({ a: '</script><script>alert(1)</script>', b: 'x<y' });
  assert.ok(!out.includes('</script>'), '不得出现闭合 script 标签');
  assert.ok(out.includes('\\u003c/script>'), '小于号应转义为 \\u003c');
  assert.equal(JSON.parse(out).b, 'x<y');
});

test('safeJsonLd：正常结构保持合法 JSON', () => {
  const obj = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: '标题' };
  assert.equal(JSON.parse(safeJsonLd(obj)).headline, '标题');
});
