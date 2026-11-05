// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// R2 兼容层：用本地文件系统实现 Cloudflare R2Bucket 的调用子集
// ============================================================================
//
// 业务侧只用到这里几个方法（见 api/files、api/media、api/upload、account/avatar）：
//   env.IMAGES.put(key, body, { httpMetadata: { contentType } })
//   env.IMAGES.get(key)            -> { body, size, httpMetadata } | null
//   env.IMAGES.list({ limit, cursor })  -> { objects: [{ key, size, uploaded }], truncated, cursor }
//   env.IMAGES.delete(key)
//
// 存储布局：BLOB_DIR/<key>，key 形如 uploads/2026/05/uuid.png。
// key 里出现的 `..`、绝对路径、盘符必须拒绝，否则等于任意文件读写。

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * 把 key 解析成磁盘绝对路径，并保证不越出根目录。
 * @param {string} root 根目录（绝对路径）
 * @param {string} key 对象 key
 * @returns {string}
 */
function resolveKey(root, key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('R2 兼容层：key 不能为空');
  }
  // 反斜杠统一成正斜杠，避免 Windows 风格路径穿越
  const normalizedKey = key.replace(/\\/g, '/');
  if (normalizedKey.startsWith('/')) {
    throw new Error(`R2 兼容层：key 不允许绝对路径（${key}）`);
  }
  if (/^[a-zA-Z]:/.test(normalizedKey)) {
    throw new Error(`R2 兼容层：key 不允许带盘符（${key}）`);
  }
  if (normalizedKey.startsWith('.meta/') || normalizedKey === '.meta') {
    throw new Error(`R2 兼容层：.meta 是保留目录（${key}）`);
  }
  const abs = resolve(root, normalize(normalizedKey));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  // 必须严格落在根目录内（含根目录本身不允许，因为那是个目录）
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new Error(`R2 兼容层：key 越界（${key}）`);
  }
  if (abs === root) {
    throw new Error(`R2 兼容层：key 解析到根目录，拒绝（${key}）`);
  }
  return abs;
}

/**
 * 把各种 body 形式统一成 Buffer。
 * 业务侧会传 Buffer、Uint8Array、ArrayBuffer、ReadableStream（file.stream()）、string。
 * @param {unknown} body
 * @returns {Promise<Buffer>}
 */
async function toBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body && typeof body === 'object' && typeof body.getReader === 'function') {
    // Web ReadableStream
    const chunks = [];
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  if (body && typeof body.pipe === 'function') {
    // Node Readable
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  if (body && typeof body.arrayBuffer === 'function') {
    return Buffer.from(await body.arrayBuffer());
  }
  throw new TypeError('R2 兼容层：不支持的对象 body 类型');
}

/** 从磁盘路径反推 key（去掉根前缀，统一正斜杠） */
function toKey(root, abs) {
  const rel = abs.slice(root.length);
  return rel.split(sep).join('/').replace(/^\/+/, '');
}

/**
 * 递归列出根目录下所有文件，返回按 key 升序排列的对象数组。
 * R2 的 list 是字典序，这里对齐。
 * @param {string} root
 */
async function walkAll(root) {
  /** @type {{ key: string, size: number, uploaded: Date, abs: string }[]} */
  const out = [];
  /** @param {string} dir */
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // .meta 是内部元信息目录，不属于对象存储的可见内容
      if (entry.name === '.meta') continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const st = await stat(abs);
        out.push({ key: toKey(root, abs), size: st.size, uploaded: st.mtime, abs });
      }
    }
  };
  await walk(root);
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/**
 * R2Bucket 兼容实现。
 */
export class NodeR2Bucket {
  /** @type {string} */
  #root;
  /** @type {string} */
  #metaRoot;

  /**
   * @param {string} root 存储根目录
   */
  constructor(root) {
    this.#root = resolve(root);
    // 元信息单独放一个隐藏目录：如果直接放在数据文件旁边（xxx.png.meta.json），
    // 会被 list() 当成素材列进媒体库，污染后台的图片列表。
    this.#metaRoot = join(this.#root, '.meta');
  }

  /** 存储根目录 */
  get root() {
    return this.#root;
  }

  /**
   * 元信息文件路径（镜像 key 的目录结构，加 .json 后缀）
   * @param {string} key
   */
  #metaPath(key) {
    return join(this.#metaRoot, key.replace(/\\/g, '/') + '.json');
  }

  /**
   * 写入对象。对齐 R2 的 put(key, value, options)。
   * 返回简化版的 R2Object。
   * @param {string} key
   * @param {unknown} value
   * @param {{ httpMetadata?: { contentType?: string, cacheControl?: string }, customMetadata?: Record<string,string> }} [options]
   */
  async put(key, value, options = {}) {
    const abs = resolveKey(this.#root, key);
    await mkdir(dirname(abs), { recursive: true });
    const buf = await toBuffer(value);

    // 元信息必须持久化，否则 /api/files 取回来时 contentType 丢失，
    // 浏览器会把图片当 octet-stream
    const metaPath = this.#metaPath(key);
    const meta = {
      contentType: options.httpMetadata?.contentType ?? 'application/octet-stream',
      cacheControl: options.httpMetadata?.cacheControl ?? null,
      customMetadata: options.customMetadata ?? null,
      uploaded: new Date().toISOString(),
    };
    await mkdir(dirname(metaPath), { recursive: true });
    await writeFile(abs, buf);
    await writeFile(metaPath, JSON.stringify(meta), 'utf8');

    return {
      key,
      size: buf.byteLength,
      uploaded: new Date(meta.uploaded),
      httpMetadata: { contentType: meta.contentType },
    };
  }

  /**
   * 读取对象。对齐 R2 的 get(key)，不存在返回 null。
   * 返回 { body: ReadableStream, size, httpMetadata }，body 用 Web 流
   * （业务侧直接 new Response(object.body) 交给 Astro）。
   * @param {string} key
   */
  async get(key) {
    let abs;
    try {
      abs = resolveKey(this.#root, key);
    } catch {
      return null;
    }
    let st;
    try {
      st = await stat(abs);
    } catch {
      return null;
    }
    if (!st.isFile()) return null;

    let httpMetadata = { contentType: 'application/octet-stream', cacheControl: null };
    try {
      const raw = await readFile(this.#metaPath(key), 'utf8');
      const meta = JSON.parse(raw);
      httpMetadata = {
        contentType: meta.contentType ?? 'application/octet-stream',
        cacheControl: meta.cacheControl ?? null,
      };
    } catch {
      // 元信息缺失时按扩展名兜底
      httpMetadata.contentType = guessContentType(key);
    }

    const nodeStream = createReadStream(abs);
    return {
      key,
      size: st.size,
      uploaded: st.mtime,
      httpMetadata,
      // Web ReadableStream：Response 直接可用
      body: Readable.toWeb(nodeStream),
      arrayBuffer: async () => {
        const b = await readFile(abs);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      },
      text: async () => readFile(abs, 'utf8'),
    };
  }

  /**
   * 判断对象是否存在（R2 的 head 简化版）
   * @param {string} key
   */
  async head(key) {
    let abs;
    try {
      abs = resolveKey(this.#root, key);
    } catch {
      return null;
    }
    try {
      const st = await stat(abs);
      if (!st.isFile()) return null;
      return { key, size: st.size, uploaded: st.mtime };
    } catch {
      return null;
    }
  }

  /**
   * 列出对象。对齐 R2 的 list({ limit, cursor, prefix })，按键名字典序分页。
   * @param {{ limit?: number, cursor?: string, prefix?: string }} [options]
   */
  async list(options = {}) {
    const limit = Math.min(Math.max(Number(options.limit ?? 1000), 1), 1000);
    const prefix = options.prefix ?? '';
    const all = await walkAll(this.#root);
    const filtered = prefix ? all.filter((o) => o.key.startsWith(prefix)) : all;

    // cursor 用「上一页最后一个 key」表示，简单且稳定
    let start = 0;
    if (options.cursor) {
      const idx = filtered.findIndex((o) => o.key > options.cursor);
      start = idx === -1 ? filtered.length : idx;
    }

    const page = filtered.slice(start, start + limit);
    const truncated = start + limit < filtered.length;
    return {
      objects: page.map((o) => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded,
        httpMetadata: { contentType: guessContentType(o.key) },
      })),
      truncated,
      cursor: truncated ? page[page.length - 1].key : undefined,
    };
  }

  /**
   * 删除对象。R2 的 delete 对不存在的 key 也不报错。
   * @param {string | string[]} keys
   */
  async delete(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      let abs;
      try {
        abs = resolveKey(this.#root, key);
      } catch {
        continue;
      }
      await rm(abs, { force: true });
      await rm(this.#metaPath(key), { force: true });
    }
  }
}

/**
 * 按扩展名猜 Content-Type，元信息缺失时的兜底。
 * @param {string} key
 */
function guessContentType(key) {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'avif':
      return 'image/avif';
    case 'svg':
      return 'image/svg+xml';
    case 'woff2':
      return 'font/woff2';
    case 'woff':
      return 'font/woff';
    case 'ttf':
      return 'font/ttf';
    case 'css':
      return 'text/css';
    case 'js':
      return 'text/javascript';
    case 'json':
      return 'application/json';
    case 'html':
      return 'text/html';
    default:
      return 'application/octet-stream';
  }
}

/**
 * ASSETS 绑定兼容层：Cloudflare 的 env.ASSETS.fetch() 用于取静态产物。
 * 这里直接映射到 dist/client 目录，找不到返回 404（与 Workers Assets 一致）。
 */
export class NodeAssetsFetcher {
  /** @type {string} */
  #root;

  /**
   * @param {string} root dist/client 目录
   */
  constructor(root) {
    this.#root = resolve(root);
  }

  /**
   * @param {Request | URL | string} input
   */
  async fetch(input) {
    const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    let abs;
    try {
      abs = resolveKey(this.#root, pathname);
    } catch {
      return new Response('Not Found', { status: 404 });
    }
    try {
      const st = await stat(abs);
      if (!st.isFile()) return new Response('Not Found', { status: 404 });
      const body = await readFile(abs);
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': guessContentType(abs), 'Content-Length': String(st.size) },
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  }
}

export { guessContentType, resolveKey as __resolveKey };

// 保留 pipeline / createWriteStream 引用，供后续大文件流式写入扩展时使用
void pipeline;
void createWriteStream;
