// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 字体自托管流水线（第一步：从 fontsource 包解出细切 woff2 并生成 @font-face CSS）
//   用法：node scripts/fonts-prepare.mjs <fontsource-tgz...> --out <目录> [--base /api/files] [--prefix fonts/v1]
//
// --prefix 是切片在桶里的路径前缀。**它同时是缓存版本号**：
// R2 对象带 immutable 会被边缘缓存一年，改了 CORS/内容却想复用旧路径会一直吃脏缓存
// （实测：重传同 key 不会让 CF 的边缘缓存失效），所以需要变更时就把前缀往上推一版。
//
// 为什么这么做：
//   Google Fonts 在大陆网络下不可达，读者拿到的是系统字体兜底；
//   而 CJK 字体整包体积巨大（单字重全量 ~1.5MB），必须沿用「按 unicode-range 细切」的方案，
//   否则每页要下全量。fontsource 的 `files/<family>-<n>-<weight>-normal.woff2` 正是
//   Google 同粒度的细切产物（每字重约 97 片），因此直接取用，不自己重切。
//
// 产物：
//   <out>/woff2/<file>.woff2        —— 待上传到 R2 的切片
//   <out>/fonts.css                 —— 引用 `--base` 的 @font-face（unicode-range 原样保留）

import { readFileSync, mkdirSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

/** Windows 下 GNU tar / bsdtar 都不吃反斜杠路径，统一转成正斜杠 */
const posix = (p) => p.split('\\').join('/');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const baseIdx = args.indexOf('--base');
const prefixIdx = args.indexOf('--prefix');
const outDir = resolve(outIdx >= 0 ? args[outIdx + 1] : '.pai/temp/fonts-out');
// 默认同源相对路径：本地开发、自托管部署、CSP 的 font-src 'self' 三种场景都对；
// 若把 R2 绑了自定义域，构建期用 FONTS_BASE 改写（见 astro.config.mjs），仓库里始终是相对路径
const base = (baseIdx >= 0 ? args[baseIdx + 1] : '/api/files').replace(/\/+$/, '');
const prefix = (prefixIdx >= 0 ? args[prefixIdx + 1] : 'fonts/v1').replace(/^\/+|\/+$/g, '');
// 注意：只在对应选项真的出现时才排除它的取值，否则 --base 缺省时 baseIdx+1 = 0
// 会把第一个 tarball 当参数值吃掉（此前 serif 包整族 392 条 unicode-range 就是这么丢的）
const tarballs = args.filter(
  (a, i) => !a.startsWith('--') && !(outIdx >= 0 && i === outIdx + 1) && !(baseIdx >= 0 && i === baseIdx + 1),
);

/** 需要自托管的「家族 × 字重」——与主题原先向 Google 请求的档位一致，避免缺字重导致浏览器合成 */
const FACES = [
  { pkg: 'noto-serif-sc', family: 'Noto Serif SC', weights: [400, 500, 600, 700] },
  { pkg: 'noto-sans-sc', family: 'Noto Sans SC', weights: [400, 500, 600, 700] },
  { pkg: 'ma-shan-zheng', family: 'Ma Shan Zheng', weights: [400] },
  // modern 主题的正文拉丁字：只取 latin 切片（latin-ext/cyrillic 等按需再加）
  { pkg: 'inter', family: 'Inter', weights: [400, 500, 600] },
];

if (tarballs.length === 0) {
  console.error(
    '用法：node scripts/fonts-prepare.mjs <fontsource-*.tgz...> --out <目录> [--base https://static.example.com]',
  );
  process.exit(1);
}

mkdirSync(join(outDir, 'woff2'), { recursive: true });

const used = [];
for (const tarball of tarballs) {
  const pkgName = basename(tarball).replace(/(-[0-9]+\.[0-9]+\.[0-9]+)?\.tgz$/, '');
  const face = FACES.find((f) => f.pkg === pkgName);
  if (!face) {
    console.warn(`跳过 ${pkgName}：不在 FACES 清单里`);
    continue;
  }
  // 列出包内文件，挑出「细切」woff2（<family>-<n>-<weight>-normal.woff2）与 latin 子集
  const list = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n');
  for (const weight of face.weights) {
    const wanted = list.filter((f) => {
      if (!f.endsWith(`-${weight}-normal.woff2`)) return false;
      const name = basename(f);
      return /^[a-z-]+-\d+-\d+-normal\.woff2$/.test(name) || /^[a-z-]+-latin-\d+-normal\.woff2$/.test(name);
    });
    if (wanted.length === 0) {
      console.warn(`⚠️ ${face.pkg} ${weight}：包内未找到细切 woff2`);
      continue;
    }
    // 解到暂存目录再逐个复制进 woff2/：直接解到产物目录并在已有文件上改名，
    // 在 Windows 上会漏计数（重复运行只生成部分 @font-face），因此这里保持幂等。
    const staging = join(outDir, 'staging');
    mkdirSync(staging, { recursive: true });
    execFileSync('tar', ['-xzf', posix(tarball), '-C', posix(staging), ...wanted], { stdio: 'inherit' });
    for (const f of wanted) {
      const name = basename(f);
      copyFileSync(join(staging, f), join(outDir, 'woff2', name));
      used.push({ family: face.family, weight, file: name });
    }
  }
}

// 生成 @font-face：以「产物目录里实际存在的切片」为准（重复运行也完整），
// unicode-range 从包内 CSS 解出，保证「按需加载」语义不变。
const rangeByFile = new Map();
for (const tarball of tarballs) {
  const pkgName = basename(tarball).replace(/(-[0-9]+\.[0-9]+\.[0-9]+)?\.tgz$/, '');
  const face = FACES.find((f) => f.pkg === pkgName);
  if (!face) continue;
  for (const weight of face.weights) {
    // 每个包用独立暂存目录：包内 CSS 成员名都叫 package/<weight>.css，共用目录会互相覆盖
    const pkgStage = join(outDir, 'staging', pkgName);
    mkdirSync(pkgStage, { recursive: true });
    try {
      execFileSync('tar', ['-xzf', posix(tarball), '-C', posix(pkgStage), `package/${weight}.css`]);
    } catch (e) {
      console.warn(`⚠️ ${pkgName} ${weight}：包内 CSS 解压失败 ${String(e).slice(0, 60)}`);
      continue;
    }
    const cssPath = join(pkgStage, `package/${weight}.css`);
    if (!existsSync(cssPath)) continue;
    const css = readFileSync(cssPath, 'utf8');
    let n = 0;
    for (const block of css.split('@font-face').slice(1)) {
      const file = /url\(["']?\.?\/?files\/([^"')]+)["']?\)/.exec(block)?.[1];
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
      if (file && range) {
        rangeByFile.set(file, range);
        n++;
      }
    }
    console.log(`   ${pkgName} ${weight}: ${n} 条 unicode-range`);
  }
}

/** 从切片文件名反推家族与字重（产物目录是唯一事实来源） */
function faceOfFile(name) {
  // 形如 noto-serif-sc-100-400-normal.woff2 / inter-latin-400-normal.woff2
  const m = /^(noto-serif-sc|noto-sans-sc|ma-shan-zheng|inter)-(.+?)-(\d+)-normal\.woff2$/.exec(name);
  if (!m) return null;
  const family = {
    'noto-serif-sc': 'Noto Serif SC',
    'noto-sans-sc': 'Noto Sans SC',
    'ma-shan-zheng': 'Ma Shan Zheng',
    inter: 'Inter',
  }[m[1]];
  return family ? { family, weight: Number(m[3]) } : null;
}

const present = readdirSync(join(outDir, 'woff2'))
  .filter((f) => f.endsWith('.woff2'))
  .sort();
const missingRange = [];
const blocks = [];
for (const file of present) {
  const face = faceOfFile(file);
  if (!face) continue;
  const range = rangeByFile.get(file);
  if (!range) {
    missingRange.push(file);
    continue;
  }
  blocks.push(
    [
      '@font-face {',
      `  font-family: '${face.family}';`,
      '  font-style: normal;',
      `  font-weight: ${face.weight};`,
      '  font-display: swap;',
      `  src: url('${base}/${prefix}/woff2/${file}') format('woff2');`,
      `  unicode-range: ${range};`,
      '}',
    ].join('\n'),
  );
}
if (missingRange.length > 0) {
  console.warn(`⚠️ ${missingRange.length} 个切片没有 unicode-range（未在包内 CSS 里找到），已跳过`);
}

writeFileSync(join(outDir, 'fonts.css'), blocks.join('\n') + '\n');
console.log(`✅ 产物切片 ${present.length} 个 → ${join(outDir, 'woff2')}`);
console.log(`✅ @font-face ${blocks.length} 条 → ${join(outDir, 'fonts.css')}`);
