// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 主题包共享校验器：pack / add / CI 三处复用的唯一实现。
//
// CLI 用法：
//   node scripts/lib/theme-validate.mjs check-zip <file.zip>   硬限制+契约+敏感导入，退出码表结果
//   node scripts/lib/theme-validate.mjs check-dir <dir>        目录形态校验（theme.json/BaseLayout/必需模板）
//   node scripts/lib/theme-validate.mjs meta <file.zip>        输出 manifest JSON（CI 取 version 用）
//   node scripts/lib/theme-validate.mjs unpack <file.zip> <目标目录>

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const HARD_LIMITS = {
  maxZipBytes: 10 * 1024 * 1024,
  maxEntries: 200,
  maxFileBytes: 512 * 1024,
  maxCompressionRatio: 20,
  allowedExtensions: ['.astro', '.ts', '.json', '.css', '.png', '.jpg', '.svg', '.woff', '.woff2', '.md'],
  slugPattern: /^[a-z0-9][a-z0-9-]{1,30}$/,
  reservedSlugs: ['classic', 'modern'],
  coreTemplates: ['home', 'collection', 'post', 'standalone', 'archive', 'search', 'not-found', 'tag-index', 'tag-detail'],
};

const REQUIRED_MANIFEST_FIELDS = ['name', 'slug', 'version', 'engine_version', 'author', 'license'];

function fail(errors, msg) {
  errors.push(msg);
}

/** 校验 manifest 对象；返回错误数组。allowReserved=true 时跳过保留字检查（系统主题自检用） */
export function validateManifest(manifest, expectedSlug = null, allowReserved = false) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    fail(errors, 'theme.json 缺失或非对象');
    return errors;
  }
  for (const f of REQUIRED_MANIFEST_FIELDS) {
    if (typeof manifest[f] !== 'string' || !manifest[f].trim()) fail(errors, `theme.json 缺少字段 ${f}`);
  }
  if (manifest.slug && !HARD_LIMITS.slugPattern.test(manifest.slug)) {
    fail(errors, `slug 需匹配 ^[a-z0-9][a-z0-9-]{1,30}$，得到 "${manifest.slug}"`);
  }
  if (manifest.slug && HARD_LIMITS.reservedSlugs.includes(manifest.slug)) {
    // 保留字仅对第三方安装非法；系统主题自身校验时跳过（见 assertInstallableSlug）
    if (!allowReserved) fail(errors, `slug "${manifest.slug}" 是系统保留字，不可作为第三方主题安装`);
  }
  if (expectedSlug && manifest.slug !== expectedSlug) {
    fail(errors, `manifest.slug(${manifest.slug}) 与目录名(${expectedSlug})不一致`);
  }
  return errors;
}

/** 安装入口专用：slug 必须合法且非保留字（--force 不豁免保留字） */
export function assertInstallableSlug(slug) {
  const problems = [];
  if (!HARD_LIMITS.slugPattern.test(slug)) problems.push(`slug 需匹配 ^[a-z0-9][a-z0-9-]{1,30}$，得到 "${slug}"`);
  if (HARD_LIMITS.reservedSlugs.includes(slug)) problems.push(`slug "${slug}" 是系统保留字，不可作为第三方主题安装`);
  return problems;
}

/** 敏感导入扫描：files 为 { 相对路径: 文本 } 映射 */
export function scanImports(files) {
  const violations = [];
  const importRe = /(?:^|[^\w$])(?:import\s+[^'"]*?from\s*|import\s*\(\s*|export\s+(?:\*|{[^}]*})\s*from\s*|require\s*\(\s*)(['"])([^'"]+)\1/g;
  for (const [relPath, text] of Object.entries(files)) {
    if (!/\.(astro|ts)$/.test(relPath)) continue;
    let m;
    while ((m = importRe.exec(text)) !== null) {
      const spec = m[2];
      if (/^(lib\/db|.*\/lib\/db)/.test(spec)) violations.push(`${relPath}: 引用 lib/db → ${spec}`);
      else if (/^(lib\/auth|.*\/lib\/auth)/.test(spec)) violations.push(`${relPath}: 引用 lib/auth → ${spec}`);
      else if (spec.startsWith('astro:env')) violations.push(`${relPath}: 引用 astro:env`);
      else if (spec.startsWith('node:')) violations.push(`${relPath}: 引用 node 内建 → ${spec}`);
      else if (spec.startsWith('cloudflare:')) violations.push(`${relPath}: 引用 cloudflare: → ${spec}`);
    }
  }
  return violations;
}

/** 校验解压后的文件映射（相对路径 → Uint8Array）；返回 { errors, warnings, manifest } */
export function validateExtracted(files, expectedSlug = null, allowReserved = false) {
  const errors = [];
  const warnings = [];

  const entries = Object.keys(files);
  // 找顶层目录（允许无顶层目录的双层兼容）
  let topDir = '';
  const tops = new Set(entries.map((e) => e.split('/')[0]));
  if (!(entries.includes('theme.json') || entries.some((e) => e.endsWith('/theme.json') === false && e === 'theme.json'))) {
    // noop——统一在下方归一化处理
  }
  const hasRootManifest = entries.includes('theme.json');
  if (!hasRootManifest) {
    if (tops.size === 1) topDir = [...tops][0] + '/';
    else fail(errors, `zip 根缺 theme.json 且存在多个顶层目录（${[...tops].join(', ')}），无法定位主题根`);
  }

  const rel = (p) => (topDir ? p.slice(topDir.length) : p);
  const themed = {};
  for (const [p, data] of Object.entries(files)) {
    const r = rel(p);
    if (!r || r.startsWith('/') || p.includes('..') || /^[a-zA-Z]:/.test(p)) {
      fail(errors, `非法路径：${p}`);
      continue;
    }
    if (r) themed[r] = data;
  }
  if (themed['theme.json'] === undefined && !errors.some((e) => e.includes('theme.json'))) {
    fail(errors, '主题根缺少 theme.json');
  }

  let manifest = null;
  if (themed['theme.json']) {
    try {
      manifest = JSON.parse(new TextDecoder().decode(themed['theme.json']));
    } catch (e) {
      fail(errors, `theme.json 解析失败：${e.message}`);
    }
  }
  if (manifest) {
    for (const e of validateManifest(manifest, expectedSlug, allowReserved)) fail(errors, e);
  }

  // 条目与单文件限制、扩展名白名单
  if (entries.length > HARD_LIMITS.maxEntries) fail(errors, `条目数 ${entries.length} 超上限 ${HARD_LIMITS.maxEntries}`);
  for (const [r, data] of Object.entries(themed)) {
    if (data.length > HARD_LIMITS.maxFileBytes) fail(errors, `单文件超限(≤512KB)：${r}`);
    const dot = r.lastIndexOf('.');
    const ext = dot === -1 ? '' : r.slice(dot).toLowerCase();
    if (ext && !HARD_LIMITS.allowedExtensions.includes(ext)) fail(errors, `扩展名不在白名单：${r}`);
    if (!ext && !r.endsWith('/')) warnings.push(`无扩展名文件：${r}`);
  }

  // 契约文件
  if (!themed['layouts/BaseLayout.astro']) fail(errors, '缺少 layouts/BaseLayout.astro（硬必需）');
  for (const t of HARD_LIMITS.coreTemplates) {
    if (!themed[`templates/${t}.astro`]) warnings.push(`模板缺失（运行时回退 classic）：templates/${t}.astro`);
  }
  if (!themed['styles/tokens.css']) warnings.push('styles/tokens.css 缺失（BaseLayout 需自行引入样式）');

  // 敏感导入（仅文本类）
  const textFiles = {};
  for (const [r, data] of Object.entries(themed)) {
    if (/\.(astro|ts)$/.test(r)) textFiles[r] = new TextDecoder().decode(data);
  }
  for (const v of scanImports(textFiles)) fail(errors, `敏感导入：${v}`);

  return { errors, warnings, manifest };
}

/** zip buffer → { files: {相对路径: Uint8Array}, ...validateExtracted 结果 } */
export function inspectZip(buf, expectedSlug = null, allowReserved = false) {
  if (buf.length > HARD_LIMITS.maxZipBytes) {
    return { errors: [`zip 超过 ${HARD_LIMITS.maxZipBytes / 1024 / 1024}MB 上限`], warnings: [], manifest: null };
  }
  let entries;
  try {
    entries = unzipSync(buf);
  } catch (e) {
    return { errors: [`zip 解析失败：${e.message}`], warnings: [], manifest: null };
  }
  // 压缩比炸弹检测：总解压大小 vs 压缩大小由 fflate 解出后按字节近似
  let totalUncompressed = 0;
  for (const data of Object.values(entries)) totalUncompressed += data.length;
  if (buf.length > 0 && totalUncompressed / buf.length > HARD_LIMITS.maxCompressionRatio) {
    return { errors: [`压缩比 ${(totalUncompressed / buf.length).toFixed(1)} 超过 ${HARD_LIMITS.maxCompressionRatio}，疑似炸弹`], warnings: [], manifest: null };
  }
  const result = validateExtracted(entries, expectedSlug, allowReserved);
  return { ...result, files: entries };
}

/** 打包目录为 zip buffer（顶层目录=dirName），并回读自检 */
export function packDir(dir, dirName) {
  const files = {};
  const walk = (abs, relBase) => {
    for (const name of readdirSync(abs)) {
      const absP = join(abs, name);
      const relP = relBase ? `${relBase}/${name}` : name;
      if (statSync(absP).isDirectory()) walk(absP, relP);
      else files[`${dirName}/${relP}`] = new Uint8Array(readFileSync(absP));
    }
  };
  walk(dir, '');
  const zipped = zipSync(files);
  const back = inspectZip(zipped, dirName, true);
  return { buffer: zipped, report: { errors: back.errors, warnings: back.warnings, manifest: back.manifest, entryCount: Object.keys(files).length } };
}

/** 解压 zip 到目标目录（已做路径安全校验） */
export function unpackZip(buf, destDir, expectedSlug = null, allowReserved = false) {
  const inspected = inspectZip(buf, expectedSlug, allowReserved);
  if (inspected.errors.length > 0) return inspected;
  // 剥离单一公共顶层目录（zip 通常带 <slug>/ 前缀，安装时应收平一层）
  const rels = Object.keys(inspected.files);
  const firstTop = rels.length ? rels[0].split('/')[0] : null;
  const singleTop = firstTop != null && rels.every((r) => r.startsWith(`${firstTop}/`));
  for (const [p, data] of Object.entries(inspected.files)) {
    const rel = singleTop ? p.slice(firstTop.length + 1) : p;
    const target = resolve(destDir, rel);
    if (!target.startsWith(resolve(destDir))) {
      inspected.errors.push(`路径逃逸：${p}`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return inspected;
}

// ---------- CLI ----------
function isMain() {
  const entry = process.argv[1];
  return entry && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const [, , cmd, a, b] = process.argv;
  const print = (r) => {
    console.log(JSON.stringify({ ok: r.errors.length === 0, errors: r.errors, warnings: r.warnings }, null, 2));
    return r.errors.length === 0 ? 0 : 1;
  };
  switch (cmd) {
    case 'check-zip': {
      const r = inspectZip(readFileSync(resolve(a)));
      process.exit(print(r));
      break;
    }
    case 'check-dir': {
      const dir = resolve(a);
      const files = {};
      const walk = (absP, relP) => {
        for (const n of readdirSync(absP)) {
          const ap = join(absP, n);
          const rp = relP ? `${relP}/${n}` : n;
          if (statSync(ap).isDirectory()) walk(ap, rp);
          else files[rp] = new Uint8Array(readFileSync(ap));
        }
      };
      walk(dir, '');
      process.exit(print(validateExtracted(files, null, true)));
      break;
    }
    case 'meta': {
      try {
        const r = inspectZip(readFileSync(resolve(a)));
        if (r.manifest) console.log(JSON.stringify(r.manifest));
        process.exit(r.manifest ? 0 : 1);
      } catch (e) {
        console.error(e.message);
        process.exit(1);
      }
      break;
    }
    case 'unpack': {
      const r = unpackZip(readFileSync(resolve(a)), resolve(b));
      if (r.errors.length > 0) {
        console.log(JSON.stringify({ ok: false, errors: r.errors }, null, 2));
        process.exit(1);
      }
      console.log(JSON.stringify({ ok: true, entries: Object.keys(r.files).length }));
      break;
    }
    default:
      console.error('用法：theme-validate.mjs <check-zip|check-dir|meta|unpack> <参数…>');
      process.exit(2);
  }
}
