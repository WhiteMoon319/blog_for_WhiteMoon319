// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// SSR-first 静态分发
// ============================================================================
//
// 问题背景：
//   Cloudflare 版在 wrangler.jsonc 里配了 run_worker_first: true，
//   所有请求先进 Worker（= Astro 路由），路由自己决定是否取静态资源。
//
//   @astrojs/node 的 standalone handler 是反过来的：staticHandler 先跑，
//   命中 dist/client 下的文件就直接返回。这带来三个实际差异：
//     1. /admin/ 与 /write/ 命中磁盘上的 index.html，绕过路由设置的
//        no-store / X-Robots-Tag / CSP 头
//     2. /write/assets/*.js 由 send 直接发，拿不到路由承诺的
//        `max-age=31536000, immutable`
//     3. 目录存在时会触发 trailingSlash 重定向，把本该交给 SSR 的路径改写掉
//
// 解决方式：
//   把"哪些路径走 SSR、哪些走静态"的判断权拿回到这里，语义对齐 Workers Assets：
//     - 有对应 Astro 路由的 → 一律 SSR（由 app.match 判定）
//     - 没有路由的、且是带扩展名的真实文件 → 走静态
//     - 其余 → SSR（让它渲染 404）
//
// 这样既保留了静态资源的性能，也让行为与 Cloudflare 版一致。

import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

/**
 * 判断给定 URL 路径是否应作为静态文件直接返回。
 *
 * 规则（对齐 Workers Assets 的默认行为）：
 *   - 必须以已知静态扩展名结尾（.js/.css/.woff2/.png ...）
 *   - 不能落在 SPA 外壳上（/admin/、/write/ 的 index.html 已被 merge 脚本移除，
 *     这里再显式挡一层，防止将来构建流程变化又把它带回来）
 *   - 文件必须真实存在于 client 目录，且在目录内（防穿越）
 *
 * @param {string} clientDir dist/client 绝对路径
 * @param {string} urlPath 浏览器请求的路径（已去掉 query）
 * @returns {string | null} 命中则返回绝对文件路径，否则 null
 */
export function resolveStaticFile(clientDir, urlPath) {
  // 只处理带扩展名的路径：无扩展名的都是路由（/, /archive, /posts/foo/）
  const ext = extname(urlPath).toLowerCase();
  if (!ext) return null;

  const STATIC_EXTS = new Set([
    '.js',
    '.mjs',
    '.css',
    '.map',
    '.json',
    '.txt',
    '.xml',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.webp',
    '.avif',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.eot',
    '.mp4',
    '.webm',
    '.wasm',
  ]);
  if (!STATIC_EXTS.has(ext)) return null;

  // SPA 外壳不通过静态通道发（必须走路由，才有正确的安全头）
  const normalizedPath = urlPath.replace(/\\/g, '/');
  if (normalizedPath === '/admin/index.html' || normalizedPath === '/write/index.html') {
    return null;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(normalizedPath);
  } catch {
    return null;
  }

  const abs = resolve(clientDir, '.' + normalize(decoded));
  const rootWithSep = clientDir.endsWith(sep) ? clientDir : clientDir + sep;
  if (!abs.startsWith(rootWithSep)) return null;

  try {
    const st = statSync(abs);
    if (!st.isFile()) return null;
    return abs;
  } catch {
    return null;
  }
}

/**
 * 给静态响应按路径计算缓存头。
 *
 * 带内容 hash 的产物（vite 输出 /assets/xxx-HaSh.js）可以永久缓存；
 * 其余（robots.txt、_assets 下未哈希的 vendor css 等）走短缓存 + 回源校验。
 *
 * @param {string} urlPath
 */
export function staticCacheControl(urlPath) {
  // 带内容 hash 的产物有两类前缀：
  //   /_astro/  ← Astro 自身的构建产物（post.CHZWw8XF.css）
  //   /assets/  ← Vite/admin 的构建产物（index-CH8ghIYu.js）
  // 文件名里带 8 位以上 hash 即可安全长缓存；其余走回源校验。
  const isHashedAsset = /\/(?:_astro|assets)\/.+[-.][A-Za-z0-9_-]{8,}\.(?:js|mjs|css)$/i.test(urlPath);
  return isHashedAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate';
}

/**
 * 把绝对路径转成 Content-Type（覆盖项目实际用到的类型）。
 * 不用 mime 库：这里类型集合固定，省一个依赖。
 * @param {string} filePath
 */
export function contentTypeOf(filePath) {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.map':
      return 'application/json; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.xml':
      return 'application/xml; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.avif':
      return 'image/avif';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

void existsSync;
void join;
