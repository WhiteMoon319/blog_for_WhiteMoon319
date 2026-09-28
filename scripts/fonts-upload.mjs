// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 字体自托管流水线（第二步：把 fonts-prepare 产出的切片批量上传到 R2）
//   用法：node scripts/fonts-upload.mjs <fonts-out 目录> [--prefix fonts/v1] [--bucket blog-images] [--concurrency 6] [--from-file failed.txt]
//
// 为什么不用 S3 API：R2 的 S3 凭据需要在控制台单独签发，而 wrangler 已登录。
// wrangler 一次只能传一个对象、单次冷启动约 59s、热启动约 3.5s，
// 因此这里做并发池（默认 6）把 800+ 个切片压到十分钟级。
// 注意：Windows 上并发过高会让 wrangler 的 libuv 崩（STATUS_STACK_BUFFER_OVERRUN），
// 因此失败名单会写入 <dir>/failed.txt（只在真的有失败时写），可用 --from-file 以低并发补传。
//
// 上传后对象带 `Cache-Control: immutable` 与 `font/woff2`，经 `/api/files/...` 或 R2 自定义域分发。

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const OPTS = ['prefix', 'bucket', 'concurrency', 'from-file'];
const getOpt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
// 位置参数 = 第一个既不是选项、也不是选项取值的参数（不受参数顺序影响）
const optValueIdx = new Set(
  OPTS.map((n) => args.indexOf(`--${n}`))
    .filter((i) => i >= 0)
    .map((i) => i + 1),
);
const dir = resolve(args.find((a, i) => !a.startsWith('--') && !optValueIdx.has(i)) ?? '.pai/temp/fonts-out');
const prefix = getOpt('prefix', 'fonts/v1');
const bucket = getOpt('bucket', 'blog-images');
const concurrency = Number(getOpt('concurrency', '6'));
const fromFile = getOpt('from-file', '');

const wranglerEntry = resolve('node_modules/wrangler/bin/wrangler.js');
const all = readdirSync(join(dir, 'woff2')).filter((f) => f.endsWith('.woff2'));
let files = all;
if (fromFile) {
  const want = readFileSync(resolve(fromFile), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (want.length === 0) {
    console.error(
      `--from-file ${fromFile} 里没有条目。\n` +
        `（failed.txt 只在上传有失败时才写；上一次补传成功后它不会被改回空名单，请直接跑全量上传）`,
    );
    process.exit(1);
  }
  files = want.filter((l) => all.includes(l));
  const unknown = want.filter((l) => !all.includes(l));
  if (unknown.length > 0) {
    console.warn(`⚠️ 名单里 ${unknown.length} 个文件不在产物目录，已忽略：${unknown.slice(0, 3).join('、')}`);
  }
}
if (files.length === 0) {
  console.error(`没有可上传的切片：${join(dir, 'woff2')}（先跑 scripts/fonts-prepare.mjs，或检查 --prefix/目录）`);
  process.exit(1);
}
console.log(`待上传 ${files.length} 个切片 → r2://${bucket}/${prefix}/woff2/（并发 ${concurrency}）`);

function put(file) {
  return new Promise((resolvePromise) => {
    const key = `${bucket}/${prefix}/woff2/${file}`;
    const child = spawn(
      process.execPath,
      [
        wranglerEntry,
        'r2',
        'object',
        'put',
        key,
        '--file',
        join(dir, 'woff2', file),
        '--content-type',
        'font/woff2',
        '--cache-control',
        'public, max-age=31536000, immutable',
        '--remote',
      ],
      // 注意：不能走 node_modules/.bin 的 shell 垫片（Windows 上以 cmd /c 启动会立刻崩：
      // Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) 且上传根本不会发生），
      // 直接跑 wrangler 的 node 入口；也不接管道，只看退出码。
      { stdio: 'ignore' },
    );
    child.on('close', (code) => resolvePromise(code === 0 ? { ok: true } : { ok: false, file, code, err: '' }));
  });
}

let done = 0;
let failed = 0;
let cursor = 0;
const startedAt = Date.now();
const failedNames = [];

async function worker() {
  while (cursor < files.length) {
    const file = files[cursor++];
    const r = await put(file);
    done++;
    if (!r.ok) {
      failed++;
      failedNames.push(file);
      console.error(`❌ ${r.file}（exit ${r.code}）${r.err}`);
    }
    if (done % 50 === 0 || done === files.length) {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      console.log(`… ${done}/${files.length}（失败 ${failed}，用时 ${secs}s）`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`✅ 上传完成：成功 ${done - failed}，失败 ${failed}`);
if (failed > 0) {
  // 只有真的失败才写名单：否则一次成功的补传会把 failed.txt 清空，
  // 之后照提示再跑 --from-file failed.txt 会拿到空名单（此前踩过）。
  writeFileSync(join(dir, 'failed.txt'), failedNames.join('\n'));
  console.log(`失败名单（${failedNames.length}）：${join(dir, 'failed.txt')}`);
  console.log(
    `补传：node scripts/fonts-upload.mjs "${dir}" --prefix ${prefix} --from-file "${join(dir, 'failed.txt')}" --concurrency 2`,
  );
  process.exit(1);
}
