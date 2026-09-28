// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 字体切片同步（第三步：把公开源上的细切 woff2 拉下来，传进你自己的 R2 桶）
//   用法：node scripts/fonts-sync.mjs [--from https://static.example.com] [--prefix fonts/v2]
//                                    [--bucket blog-images] [--concurrency 3] [--limit N] [--dir <缓存目录>] [--dry-run]
//
// 为什么需要它：主题的 styles/fonts.css 指向 /api/files/fonts/<prefix>/woff2/…，
// 而**切片是站点侧资源**——新部署的 R2 桶里一个都没有，字体就会整批 404、静默回退系统字体。
// 本脚本按主题 CSS 里的 879 个文件名，从公开源（默认作者站点的自定义域）逐个下载并上传到
// 调用者自己的桶；下载到本地缓存后重复运行只补缺失项，中断可重跑。
//
// 注意：切片内容与 Google Fonts 同粒度（fontsource 的细切产物，OFL 许可），
// 换源用 --from 指向任意镜像（该源需提供同样的 <prefix>/woff2/<file> 路径）。

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const OPTS = ['from', 'prefix', 'bucket', 'concurrency', 'limit', 'dir'];
const getOpt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const FLAGS = ['dry-run'];
const unknown = args.filter((a) => a.startsWith('--') && !OPTS.includes(a.slice(2)) && !FLAGS.includes(a.slice(2)));
if (unknown.length > 0) {
  console.error(`未知参数：${unknown.join(' ')}`);
  process.exit(2);
}

const from = getOpt('from', process.env.FONTS_SYNC_FROM || 'https://static.whitemoon319.xyz').replace(/\/+$/, '');
const prefix = getOpt('prefix', 'fonts/v2').replace(/^\/+|\/+$/g, '');
const bucket = getOpt('bucket', 'blog-images');
const concurrency = Number(getOpt('concurrency', '3'));
const limit = Number(getOpt('limit', '0'));
const dir = resolve(getOpt('dir', '.pai/temp/fonts-cache'));
const dryRun = args.includes('--dry-run');

const wranglerEntry = resolve('node_modules/wrangler/bin/wrangler.js');

/** 名单以主题 CSS 里的 url() 为准——那是运行时真正会去取的路径，不另立清单 */
function sliceNames() {
  const themesDir = 'src/themes';
  if (!existsSync(themesDir)) return [];
  const names = new Set();
  for (const t of readdirSync(themesDir)) {
    const css = join(themesDir, t, 'styles', 'fonts.css');
    if (!existsSync(css)) continue;
    for (const m of readFileSync(css, 'utf8').matchAll(/url\('\/api\/files\/fonts\/[^/]+\/woff2\/([^']+)'\)/g)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

let files = sliceNames();
if (files.length === 0) {
  console.error('没有在 src/themes/*/styles/fonts.css 里找到切片名单（先确认主题文件存在）');
  process.exit(1);
}
if (limit > 0) files = files.slice(0, limit);

console.log(`字体切片同步：${files.length} 个文件`);
console.log(`  源     ：${from}/${prefix}/woff2/`);
console.log(`  目标   ：r2://${bucket}/${prefix}/woff2/（并发 ${concurrency}）`);
console.log(`  本地缓存：${dir}`);
if (dryRun) {
  console.log('\n--dry-run：只列出前 5 个待处理项');
  for (const f of files.slice(0, 5)) console.log(`  ${f}`);
  process.exit(0);
}

mkdirSync(dir, { recursive: true });

let done = 0;
let failed = 0;
const failedNames = [];
let cursor = 0;
const startedAt = Date.now();

/** 下载单个切片到本地缓存（已存在且非空即跳过），返回本地路径 */
async function fetchSlice(name) {
  const local = join(dir, name);
  if (existsSync(local)) return local;
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // 必须带超时：个别网络环境下 fetch 会一直挂着（本机实测），超时后重试一次
      const res = await fetch(`${from}/${prefix}/woff2/${name}`, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 512) throw new Error(`内容异常（${buf.length} 字节）`);
      writeFileSync(local, buf);
      return local;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** 上传单个切片；不接管道，只看退出码（Windows 上管道会触发 wrangler 的 libuv 断言） */
function putSlice(local, name) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [
        wranglerEntry,
        'r2',
        'object',
        'put',
        `${bucket}/${prefix}/woff2/${name}`,
        '--file',
        local,
        '--content-type',
        'font/woff2',
        '--cache-control',
        'public, max-age=31536000, immutable',
        '--remote',
      ],
      { stdio: 'ignore' },
    );
    child.on('close', (code) => resolvePromise(code === 0));
  });
}

async function worker() {
  while (cursor < files.length) {
    const name = files[cursor++];
    try {
      const local = await fetchSlice(name);
      const ok = await putSlice(local, name);
      if (!ok) throw new Error('wrangler 退出码非 0');
    } catch (e) {
      failed++;
      failedNames.push(name);
      console.error(`❌ ${name}：${e.message}`);
    }
    done++;
    if (done % 25 === 0 || done === files.length) {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      console.log(`… ${done}/${files.length}（失败 ${failed}，用时 ${secs}s）`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`\n✅ 同步完成：成功 ${done - failed}，失败 ${failed}`);
if (failed > 0) {
  writeFileSync(join(dir, 'failed.txt'), failedNames.join('\n'));
  console.log(`失败名单：${join(dir, 'failed.txt')}`);
  console.log(`补跑：node scripts/fonts-sync.mjs --from ${from} --prefix ${prefix}（已下载的会跳过，只补失败项）`);
  process.exit(1);
}
