// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// pnpm theme:pack <目录> —— 把主题目录打包为 zip 并自检（作者侧出口）
// 产物：dist/themes/<slug>.zip（gitignore 覆盖）

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { packDir } from './lib/theme-validate.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function main() {
  const dirArg = process.argv[2];
  if (!dirArg) {
    console.error('用法：pnpm theme:pack <主题目录>   例：pnpm theme:pack src/themes/my-theme');
    process.exit(2);
  }
  const dir = resolve(process.cwd(), dirArg);
  const slug = basename(dir);

  console.log(`\n📦 打包 ${dir}\n`);

  // 1. 目录形态校验
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8'));
  } catch (e) {
    console.error(`❌ theme.json 读取失败：${e.message}`);
    process.exit(1);
  }
  if (manifest.slug !== slug) {
    console.error(`❌ theme.json.slug(${manifest.slug}) 与目录名(${slug})不一致`);
    process.exit(1);
  }

  // 2. 打包 + 回读自检
  const { buffer, report } = packDir(dir, slug);
  if (report.errors.length > 0) {
    console.error('❌ 自检未通过：');
    for (const e of report.errors) console.error(`   - ${e}`);
    process.exit(1);
  }

  const outDir = join(ROOT, 'dist', 'themes');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${slug}.zip`);
  writeFileSync(outPath, buffer);

  console.log('✅ 自检通过');
  console.log(`   条目数：${report.entryCount}`);
  console.log(`   大小：${(buffer.length / 1024).toFixed(1)} KB`);
  console.log(`   版本：${manifest.version}（engine ${manifest.engine_version}）`);
  if (report.warnings.length > 0) {
    console.log('\n⚠️ 提示（不阻断）：');
    for (const w of report.warnings) console.log(`   - ${w}`);
  }
  console.log(`\n📄 产物：${outPath}`);
  console.log('下一步：投稿 PR 三件套见官方主题仓库 CONTRIBUTING.md');
}

main();
