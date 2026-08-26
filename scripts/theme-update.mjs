// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// pnpm theme:update <slug>[@version] —— 从官方源升级/回滚已安装主题

import { existsSync, readFileSync, rmSync, renameSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unpackZip } from './lib/theme-validate.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const THEMES_DIR = join(ROOT, 'src', 'themes');

function readEnvRepo() {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) {
    const m = /^THEMES_REPO=(.+)$/m.exec(readFileSync(envFile, 'utf8'));
    if (m) return m[1].trim();
  }
  return 'WhiteMoon319/themes_for_blog';
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg.includes('/') || arg.endsWith('.zip')) {
    console.error('用法：pnpm theme:update <slug>[@version]');
    process.exit(2);
  }
  const [slug, wantVersion] = arg.split('@');
  const target = join(THEMES_DIR, slug);
  if (!existsSync(join(target, 'theme.json'))) {
    console.error(`❌ 本地未安装：src/themes/${slug}（首次请用 theme:add ${slug}）`);
    process.exit(1);
  }
  const local = JSON.parse(readFileSync(join(target, 'theme.json'), 'utf8'));

  const repo = readEnvRepo();
  const ref = wantVersion ? `refs/tags/${slug}-v${wantVersion}` : 'main';
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${slug}/${slug}.zip`;
  console.log(`⬇️  拉取 ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`❌ 下载失败 ${res.status}（${wantVersion ? `tag ${slug}-v${wantVersion} 不存在？` : '检查网络或仓库名'}）`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  // 校验通过后原子替换：先解到临时目录再整体换名
  const staging = join(THEMES_DIR, `.${slug}.staging`);
  rmSync(staging, { recursive: true, force: true });
  const inspected = unpackZip(buf, staging, slug);
  if (inspected.errors.length > 0) {
    rmSync(staging, { recursive: true, force: true });
    console.error('❌ 校验未通过，未做任何改动：');
    for (const e of inspected.errors) console.error(`   - ${e}`);
    process.exit(1);
  }

  const remote = inspected.manifest;
  if (!wantVersion && remote.version === local.version) {
    rmSync(staging, { recursive: true, force: true });
    console.log(`✅ 已是最新版本 ${local.version}`);
    return;
  }

  rmSync(target, { recursive: true, force: true });
  renameOrMove(staging, target);

  console.log(`✅ ${local.version} → ${remote.version}`);
  console.log(`   更新日志：https://github.com/${repo}/blob/main/${slug}/README.md`);
}

function renameOrMove(from, to) {
  try {
    renameSync(from, to);
  } catch {
    // Windows 跨盘/占用兜底
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
