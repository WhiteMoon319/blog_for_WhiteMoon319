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
// 因此失败名单会写入 <dir>/failed.txt，可用 --from-file 以低并发补传。
//
// 上传后对象带 `Cache-Control: immutable` 与 `font/woff2`，经 `/api/files/...` 或 R2 自定义域分发。

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const getOpt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.pai/temp/fonts-out');
const prefix = getOpt('prefix', 'fonts/v1');
const bucket = getOpt('bucket', 'blog-images');
const concurrency = Number(getOpt('concurrency', '6'));
const fromFile = getOpt('from-file', '');

const wranglerEntry = resolve('node_modules/wrangler/bin/wrangler.js');
const all = readdirSync(join(dir, 'woff2')).filter((f) => f.endsWith('.woff2'));
const files = fromFile
  ? readFileSync(resolve(fromFile), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => all.includes(l))
  : all;
if (files.length === 0) {
  console.error(`没有找到切片：${join(dir, 'woff2')}（先跑 scripts/fonts-prepare.mjs）`);
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
writeFileSync(join(dir, 'failed.txt'), failedNames.join('\n'));
console.log(`✅ 上传完成：成功 ${done - failed}，失败 ${failed}`);
if (failed > 0) {
  console.log(
    `失败名单：${join(dir, 'failed.txt')}（补传：node scripts/fonts-upload.mjs ${dir} --from-file ${join(dir, 'failed.txt')} --concurrency 2）`,
  );
  process.exit(1);
}
