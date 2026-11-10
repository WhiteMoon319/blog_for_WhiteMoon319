#!/usr/bin/env node
// 月下独酌 · blog（blog_for_WhiteMoon319）
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 字体切片同步（Node 后端版）
//
// 与原版 scripts/fonts-sync.mjs 的区别：
//   原版用 wrangler r2 object put 上传到 Cloudflare R2 桶；
//   Node 后端没有 R2，对象存在本地 data/blobs/，因此本脚本直接写文件系统。
//
// 写入布局（与 server/r2.mjs 的 NodeR2Bucket 完全一致）：
//   内容   data/blobs/<key>
//   元信息 data/blobs/.meta/<key>.json  →  { contentType, size, uploaded }
//
// 用法：
//   node scripts/fonts-sync-local.mjs [--from https://...] [--prefix fonts/v2]
//                                     [--concurrency 3] [--limit N] [--dry-run]
//
// 默认源为作者站点静态域（切片内容与 Google Fonts 同粒度，OFL 许可）。

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const OPTS = ['from', 'prefix', 'concurrency', 'limit', 'dir', 'data'];
const getOpt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const unknown = args.filter((a) => a.startsWith('--') && a.slice(2) !== 'dry-run' && !OPTS.includes(a.slice(2)));
if (unknown.length > 0) {
  console.error(`未知参数：${unknown.join(' ')}`);
  process.exit(2);
}

const from = getOpt('from', process.env.FONTS_SYNC_FROM || 'https://static.whitemoon319.top').replace(/\/+$/, '');
const prefix = getOpt('prefix', 'fonts/v2').replace(/^\/+|\/+$/g, '');
const concurrency = Math.max(1, Number(getOpt('concurrency', '4')));
const limit = Number(getOpt('limit', '0'));
const dataRoot = resolve(getOpt('data', 'data/blobs'));
const cacheDir = resolve(getOpt('dir', '.pai/temp/fonts-cache'));
const dryRun = args.includes('--dry-run');

/** 名单以主题 CSS 里的 url() 为准——运行时真正会去取的路径，不另立清单 */
function sliceNames() {
  const themesDir = 'src/themes';
  if (!existsSync(themesDir)) return [];
  const names = new Set();
  const re = /url\('\/api\/files\/fonts\/[^/]+\/woff2\/([^']+)'\)/g;
  for (const t of readdirSync(themesDir)) {
    const css = join(themesDir, t, 'styles', 'fonts.css');
    if (!existsSync(css)) continue;
    const text = readFileSync(css, 'utf8');
    for (const m of text.matchAll(re)) names.add(m[1]);
  }
  return [...names].sort();
}

/** 该切片是否已在本地存储里（内容存在且非空即视为已同步） */
function alreadyStored(key) {
  const abs = join(dataRoot, key);
  try {
    return existsSync(abs) && statSync(abs).size > 512;
  } catch {
    return false;
  }
}

/** 按 NodeR2Bucket 的布局落盘：内容 + .meta 元信息 */
function putLocal(key, buf) {
  const abs = join(dataRoot, key);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buf);
  const metaPath = join(dataRoot, '.meta', key + '.json');
  mkdirSync(dirname(metaPath), { recursive: true });
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        contentType: 'font/woff2',
        size: buf.length,
        // 与 R2 一致用 ISO 时间串；r2.mjs 读取时会转成 Date
        uploaded: new Date().toISOString(),
        cacheControl: 'public, max-age=31536000, immutable',
      },
      null,
      0,
    ),
    'utf8',
  );
}

let files = sliceNames();
if (files.length === 0) {
  console.error('没有在 src/themes/*/styles/fonts.css 里找到切片名单（先确认主题文件存在）');
  process.exit(1);
}
if (limit > 0) files = files.slice(0, limit);

const todo = files.filter((n) => !alreadyStored(`${prefix}/woff2/${n}`));
console.log(`字体切片同步（本地存储）`);
console.log(`  名单总数：${files.length}`);
console.log(`  待同步  ：${todo.length}（已有 ${files.length - todo.length}）`);
console.log(`  源      ：${from}/${prefix}/woff2/`);
console.log(`  目标    ：${join(dataRoot, prefix, 'woff2')}`);
console.log(`  并发    ：${concurrency}`);

if (dryRun) {
  console.log('\n--dry-run：前 5 个待处理项');
  for (const f of todo.slice(0, 5)) console.log(`  ${f}`);
  process.exit(0);
}
if (todo.length === 0) {
  console.log('全部切片已存在，无需同步。');
  process.exit(0);
}

mkdirSync(cacheDir, { recursive: true });

let done = 0;
let failed = 0;
const failedNames = [];
let cursor = 0;
const startedAt = Date.now();

/** 下载到本地缓存（已存在且非空即跳过），返回本地路径 */
async function fetchSlice(name) {
  const local = join(cacheDir, name);
  if (existsSync(local) && statSync(local).size > 512) return local;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${from}/${prefix}/woff2/${name}`, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 512) throw new Error(`内容异常（${buf.length} 字节）`);
      writeFileSync(local, buf);
      return local;
    } catch (e) {
      lastErr = e;
      // 退避后重试，避免偶发网络抖动导致整批失败
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  throw lastErr;
}

async function worker() {
  while (cursor < todo.length) {
    const name = todo[cursor++];
    try {
      const local = await fetchSlice(name);
      putLocal(`${prefix}/woff2/${name}`, readFileSync(local));
      done++;
      if (done % 50 === 0) {
        const rate = (done / ((Date.now() - startedAt) / 1000)).toFixed(1);
        console.log(`  进度：${done}/${todo.length}（${rate}/s）`);
      }
    } catch (e) {
      failed++;
      failedNames.push(name);
      console.error(`❌ ${name}：${e.message}`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n完成：成功 ${done}，失败 ${failed}，耗时 ${secs}s`);
if (failedNames.length > 0) {
  const failFile = resolve('.pai/temp/fonts-failed.txt');
  mkdirSync(dirname(failFile), { recursive: true });
  writeFileSync(failFile, failedNames.join('\n'), 'utf8');
  console.log(`失败清单已写入 ${failFile}（重跑本脚本会自动只补缺失项）`);
  process.exit(1);
}
