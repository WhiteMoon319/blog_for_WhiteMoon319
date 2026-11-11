// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 发布包打包器：由 CI 发布流程（.github/workflows/release.yml）调用，也可本地手动运行。
//
// 用法：
//   node scripts/pack-release.mjs runtime <win-x64|linux-x64|macos-arm64|macos-x64>
//       下载并组装便携运行环境到 ./runtime/（node + pnpm；Windows 额外含 MinGit）
//   node scripts/pack-release.mjs pack <目标> <平台> <版本号> <输出 zip 路径> [dist 目录]
//       组装发布包：仓库源码（git archive）+ 构建产物 + 便携运行环境
//
// 目标（第 1 个参数）决定装哪一套产物：
//   node        → node 产物，供自托管使用（BLOG_TARGET=node 构建出来的 dist）
//   cloudflare  → cloudflare 产物，供 pnpm cf:deploy 使用
//
// 平台（第 2 个参数）决定带哪个平台的便携运行环境：
//   win-x64 / linux-x64 / macos-arm64 / macos-x64 → 带上对应平台的 node + pnpm
//   none → 不带运行环境（需使用者自备 Node ≥ 22 与 pnpm）
//
// 产物与平台是两个独立维度：两套产物都能配任意平台的环境，也能都不带环境。
// 第五个参数指定产物目录，缺省用 ./dist。
//
// 关于 pnpm：pnpm 11.x 未提供 darwin-x64 的独立可执行文件，因此这里统一取 npm 包
// pnpm@11.18.0（纯 JS，四端通用），用包内自带的 node 运行它，保证四端版本一致。

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  cpSync,
  renameSync,
  readdirSync,
  writeFileSync,
  chmodSync,
  statSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 临时工作目录必须与 runtime/ 同盘（否则 renameSync 会因跨盘报 EXDEV）。
// 放在仓库内已 gitignore 的 .pai/temp 下，CI 首次运行时会自动创建。
const TMP_ROOT = join(ROOT, '.pai', 'temp');

function makeWorkDir(prefix) {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, prefix));
}

// 打包进便携运行时的版本（改动前请确认下载地址真实存在）
const NODE_VERSION = '24.16.0';
const PNPM_VERSION = '11.18.0';
const MINGIT_TAG = 'v2.55.0.windows.5';
const MINGIT_FILE = 'MinGit-2.55.0.5-64-bit.zip';

const NODE_MIRROR = 'https://nodejs.org/dist';
const PNPM_NPM_URL = `https://registry.npmjs.org/pnpm/-/pnpm-${PNPM_VERSION}.tgz`;
const MINGIT_URL = `https://github.com/git-for-windows/git/releases/download/${MINGIT_TAG}/${MINGIT_FILE}`;

const PLATFORMS = {
  'win-x64': { nodeFile: `node-v${NODE_VERSION}-win-x64.zip`, kind: 'zip', git: true },
  'linux-x64': { nodeFile: `node-v${NODE_VERSION}-linux-x64.tar.xz`, kind: 'tarxz' },
  'macos-arm64': { nodeFile: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, kind: 'targz' },
  'macos-x64': { nodeFile: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, kind: 'targz' },
};

// Windows 版 GNU tar 会把 `\` 当转义符、把盘符冒号当远程主机名，
// 因此一律以解压目标目录为 cwd、用正斜杠相对路径调用 tar（相对路径不含冒号，最稳）
function tarExtract(archive, dest, compression, extra = []) {
  const rel = relative(dest, archive).split(sep).join('/');
  // 不要求 tar 完全成功：某些受限环境（容器里无 chmod 权限）会报
  // 「Cannot change mode」并返回非零，但文件其实已正常解出。
  // 这类 chmod 失败不影响产物正确性，真正的内容错误会在后续步骤暴露。
  try {
    execFileSync('tar', [`-x${compression}f`, rel, ...extra], {
      cwd: dest,
      stdio: ['ignore', 'inherit', 'pipe'],
    });
  } catch (err) {
    const stderr = String(err.stderr ?? '');
    if (!/Cannot change mode|Cannot utime|Cannot change ownership/.test(stderr)) throw err;
    log('  （tar 报告权限属性无法恢复，文件已解出，忽略）');
  }
}

function log(msg) {
  console.log(msg);
}

function run(cmd, args, opts = {}) {
  log(`  $ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function download(url, outFile) {
  run('curl', ['-L', '--fail', '--retry', '3', '--retry-delay', '2', '-o', outFile, url]);
  const size = statSync(outFile).size;
  if (size < 1024) throw new Error(`下载内容异常（${size} 字节）：${url}`);
  log(`  [OK] 下载完成：${(size / 1024 / 1024).toFixed(1)} MB`);
}

function extract(archive, dest, kind) {
  mkdirSync(dest, { recursive: true });
  if (kind === 'zip') run('unzip', ['-q', archive, '-d', dest]);
  else tarExtract(archive, dest, kind === 'tarxz' ? 'J' : 'z');
}

/** 归档若只有一个顶层目录，把内容上提一层（node 的 zip/tar 均如此；MinGit 直接是根目录） */
function flattenSingleRoot(dest) {
  const entries = readdirSync(dest);
  if (entries.length !== 1) return;
  const only = join(dest, entries[0]);
  if (!statSync(only).isDirectory()) return;
  for (const child of readdirSync(only)) renameSync(join(only, child), join(dest, child));
  rmSync(only, { recursive: true, force: true });
}

function writePnpmShims(runtimeDir, cfg) {
  const binDir = join(runtimeDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  if (cfg.git) {
    // Windows：pnpm.cmd（cmd.exe 无法直接执行无扩展名的 sh shim）
    writeFileSync(
      join(binDir, 'pnpm.cmd'),
      '@echo off\r\n"%~dp0..\\node\\node.exe" "%~dp0..\\pnpm\\bin\\pnpm.mjs" %*\r\n',
    );
    return;
  }
  const shim = join(binDir, 'pnpm');
  writeFileSync(
    shim,
    '#!/bin/sh\n' +
      '# 由 scripts/pack-release.mjs 生成：用包内 node 运行包内 pnpm\n' +
      'DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n' +
      'exec "$DIR/../node/bin/node" "$DIR/../pnpm/bin/pnpm.mjs" "$@"\n',
  );
  chmodSync(shim, 0o755);
}

function assembleRuntime(platform) {
  const cfg = PLATFORMS[platform];
  if (!cfg) throw new Error(`未知平台：${platform}（可选：${Object.keys(PLATFORMS).join(' / ')}）`);

  const runtimeDir = join(ROOT, 'runtime');
  const work = makeWorkDir('runtime-');
  try {
    rmSync(runtimeDir, { recursive: true, force: true });
    mkdirSync(runtimeDir, { recursive: true });

    log(`\n[1/3] Node.js v${NODE_VERSION}（${platform}）`);
    const nodeArchive = join(work, cfg.nodeFile);
    download(`${NODE_MIRROR}/v${NODE_VERSION}/${cfg.nodeFile}`, nodeArchive);
    const nodeTmp = join(work, 'node');
    extract(nodeArchive, nodeTmp, cfg.kind);
    flattenSingleRoot(nodeTmp);
    renameSync(nodeTmp, join(runtimeDir, 'node'));

    log(`\n[2/3] pnpm ${PNPM_VERSION}（npm 包）`);
    const pnpmArchive = join(work, `pnpm-${PNPM_VERSION}.tgz`);
    download(PNPM_NPM_URL, pnpmArchive);
    mkdirSync(join(runtimeDir, 'pnpm'), { recursive: true });
    tarExtract(pnpmArchive, join(runtimeDir, 'pnpm'), 'z', ['--strip-components=1']);

    if (cfg.git) {
      log('\n[3/3] MinGit（Windows 便携 git）');
      const gitArchive = join(work, MINGIT_FILE);
      download(MINGIT_URL, gitArchive);
      const gitTmp = join(work, 'git');
      extract(gitArchive, gitTmp, 'zip');
      flattenSingleRoot(gitTmp);
      renameSync(gitTmp, join(runtimeDir, 'git'));
    } else {
      log('\n[3/3] git：不打包（该平台使用系统 git）');
    }

    writePnpmShims(runtimeDir, cfg);
    log(`\n[OK] runtime/ 组装完成（${platform}）`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function hasZipCli() {
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function zipWithFflate(srcDir, topName, outFile) {
  // 本地 Windows（Git Bash 无 zip 命令）才走这条兜底路径；CI 用系统 zip 以保留可执行位
  const { zipSync } = await import('fflate');
  const files = {};
  const base = join(srcDir, topName);
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files[relative(srcDir, full).split(sep).join('/')] = new Uint8Array(readFileSync(full));
    }
  };
  walk(base);
  log(`  （未找到 zip 命令，改用 fflate 打包；可执行位不保留）`);
  writeFileSync(outFile, zipSync(files, { level: 9 }));
}

async function pack(target, platform, version, outZip, distDirArg) {
  if (target !== 'node' && target !== 'cloudflare') {
    throw new Error(`未知目标：${target}（可选：node / cloudflare）`);
  }
  const withEnv = platform !== 'none';
  if (withEnv && !PLATFORMS[platform]) {
    throw new Error(`未知平台：${platform}（可选：${Object.keys(PLATFORMS).join(' / ')} / none）`);
  }
  if (!version) throw new Error('缺少版本号');

  // 产物来源。发布流程会把两套产物分别放到 dist-node / dist-cloudflare，
  // 日常本地调用不传第四个参数，仍旧用 ./dist。
  const distDir = resolve(ROOT, distDirArg || 'dist');

  const outAbs = resolve(outZip);
  const pkgName = `blog-${version}`;
  const staging = makeWorkDir('pack-');
  try {
    const pkgRoot = join(staging, pkgName);
    mkdirSync(pkgRoot, { recursive: true });

    log(`\n[1/4] 仓库源码（git archive HEAD）`);
    const srcTar = join(staging, 'src.tar');
    run('git', ['-C', ROOT, 'archive', '--format=tar', '-o', srcTar, 'HEAD']);
    tarExtract(srcTar, pkgRoot, '');

    log(`\n[2/4] 构建产物 ${relative(ROOT, distDir) || 'dist'}/`);
    if (!existsSync(distDir)) {
      throw new Error(`未找到构建产物：${distDir}，请先运行 pnpm run build`);
    }
    cpSync(distDir, join(pkgRoot, 'dist'), { recursive: true });

    log(`\n[3/4] 便携运行环境`);
    if (withEnv) {
      const runtimeSrc = join(ROOT, 'runtime');
      if (!existsSync(runtimeSrc)) {
        throw new Error(`未找到 runtime/，请先运行：node scripts/pack-release.mjs runtime ${platform}`);
      }
      cpSync(runtimeSrc, join(pkgRoot, 'runtime'), { recursive: true });
    } else {
      log('  （不带环境包：跳过 runtime/）');
    }

    log(`\n[4/4] 压缩 → ${outAbs}`);
    mkdirSync(dirname(outAbs), { recursive: true });
    rmSync(outAbs, { force: true });
    if (hasZipCli()) {
      run('zip', ['-q', '-9', '-r', outAbs, pkgName], { cwd: staging });
    } else {
      await zipWithFflate(staging, pkgName, outAbs);
    }
    log(`\n[OK] ${pkgName} 打包完成：${(statSync(outAbs).size / 1024 / 1024).toFixed(1)} MB`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function usage() {
  log(`用法：
  node scripts/pack-release.mjs runtime <${Object.keys(PLATFORMS).join('|')}>
  node scripts/pack-release.mjs pack <node|cloudflare> <${Object.keys(PLATFORMS).join('|')}|none> <版本号> <输出 zip 路径> [dist 目录]`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'runtime') {
    assembleRuntime(args[0]);
  } else if (cmd === 'pack') {
    await pack(args[0], args[1], args[2], args[3], args[4]);
  } else {
    usage();
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e.message || e}`);
  process.exit(1);
});
