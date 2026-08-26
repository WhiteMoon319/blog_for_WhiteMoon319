// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// pnpm theme:add <来源> —— 安装主题
// 来源：官方 <slug> | 本地 ./x.zip | https://...zip | git 仓库 URL

import { existsSync, readFileSync, readdirSync, statSync, rmSync, mkdtempSync, cpSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { assertInstallableSlug, unpackZip } from './lib/theme-validate.mjs';
import { fetchOfficialZip } from './lib/official-zip.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const THEMES_DIR = join(ROOT, 'src', 'themes');

function installFromBuffer(buf, slug, { official, force = false }) {
  const problems = assertInstallableSlug(slug);
  if (problems.length > 0) {
    console.error(`❌ ${problems.join('；')}（--force 不豁免保留字）`);
    process.exit(1);
  }
  const target = join(THEMES_DIR, slug);
  if (existsSync(target)) {
    if (!force) {
      console.error(`❌ 目标已存在：src/themes/${slug}（覆盖请加 --force）`);
      process.exit(1);
    }
    rmSync(target, { recursive: true, force: true });
  }
  const inspected = unpackZip(buf, target, official ? slug : null);
  if (inspected.errors.length > 0) {
    rmSync(target, { recursive: true, force: true });
    console.error('❌ 校验未通过，已回滚：');
    for (const e of inspected.errors) console.error(`   - ${e}`);
    process.exit(1);
  }
  console.log('✅ 安装完成');
  console.log(`   位置：src/themes/${slug}`);
  console.log(`   版本：${inspected.manifest?.version ?? '?'}（engine ${inspected.manifest?.engine_version ?? '?'}）`);
  console.log(`\n切换：pnpm theme ${slug}   （切后重启 dev server / VSCode Reload TS Server）`);
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--force');
  const force = process.argv.includes('--force');
  const source = argv[0];
  if (!source) {
    console.error('用法：pnpm theme:add <slug | ./x.zip | https://…zip | git-url>');
    process.exit(2);
  }

  // 官方 slug（保留字/合法性先于网络请求；下载走多通道回退）
  if (!source.includes('/') && !source.includes('\\') && !source.endsWith('.zip')) {
    const pre = assertInstallableSlug(source);
    if (pre.length > 0) {
      console.error(`❌ ${pre.join('；')}（--force 不豁免保留字）`);
      process.exit(1);
    }
    const buf = await fetchOfficialZip(source);
    installFromBuffer(buf, source, { official: true, force });
    return;
  }

  // 本地 zip
  if (existsSync(resolve(source))) {
    const slugGuess = basename(source).replace(/\.zip$/i, '');
    installFromBuffer(readFileSync(resolve(source)), slugGuess, { official: false, force });
    return;
  }

  // 远程 zip URL
  if (/^https?:\/\//.test(source) && source.endsWith('.zip')) {
    console.log('⚠️  该来源未经官方审核，安装前请自行确认内容可信。');
    const res = await fetch(source);
    if (!res.ok) {
      console.error(`❌ 下载失败 ${res.status}：${source}`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const slugGuess = basename(new URL(source).pathname).replace(/\.zip$/i, '');
    installFromBuffer(buf, slugGuess, { official: false, force });
    return;
  }

  // git 仓库 URL
  if (/^https?:\/\/.*\.git$/.test(source) || /^https?:\/\/github\.com\/[^/]+\/[^/]+$/.test(source)) {
    console.log('⚠️  该来源未经官方审核，安装前请自行确认内容可信。');
    const tmp = mkdtempSync(join(tmpdir(), 'theme-git-'));
    try {
      execSync(`git clone --depth 1 "${source}" "${tmp}/repo"`, { stdio: 'inherit' });
      const repoDir = join(tmp, 'repo');
      let themeRoot = repoDir;
      if (!existsSync(join(repoDir, 'theme.json'))) {
        const candidates = readdirSync(repoDir).filter((n) => statSync(join(repoDir, n)).isDirectory() && existsSync(join(repoDir, n, 'theme.json')));
        if (candidates.length !== 1) {
          console.error('❌ 仓库根与其子目录中未能唯一定位 theme.json');
          process.exit(1);
        }
        themeRoot = join(repoDir, candidates[0]);
      }
      const slug = basename(themeRoot);
      const problems = assertInstallableSlug(slug);
      if (problems.length > 0) {
        console.error(`❌ ${problems.join('；')}`);
        process.exit(1);
      }
      const target = join(THEMES_DIR, slug);
      if (existsSync(target)) {
        console.error(`❌ 目标已存在：src/themes/${slug}（覆盖请加 --force）`);
        process.exit(1);
      }
      cpSync(themeRoot, target, { recursive: true });
      console.log('✅ 安装完成（git 来源，未经官方审核）');
      console.log(`   切换：pnpm theme ${slug}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return;
  }

  console.error(`❌ 无法识别的来源：${source}`);
  process.exit(2);
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
