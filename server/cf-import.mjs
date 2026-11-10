// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ============================================================================
// Cloudflare 数据导入器
// ============================================================================
//
// 把 Cloudflare 上的 D1 数据与 R2 文件搬到本地 Node 后端。
// 用于从 Workers 版迁移过来：不需要手工导出 SQL、不需要 wrangler 登录。
//
// 用到的 Cloudflare API（全部走 Bearer Token）：
//   GET  /user/tokens/verify                                 校验 token
//   GET  /accounts/{aid}/d1/database                         列出 D1 库
//   POST /accounts/{aid}/d1/database/{did}/export            触发导出（polling）
//   GET  {signed_url}                                        下载导出的 SQL
//   GET  /accounts/{aid}/r2/buckets                          列出 R2 桶
//   GET  /accounts/{aid}/r2/buckets/{name}/objects           列出对象（分页）
//   GET  /accounts/{aid}/r2/buckets/{name}/objects/{key}     下载对象
//
// 几个必须踩对的点：
//   1. D1 导出要用 dump_options.compatibility = 'sqlite3_cli_only'。
//      本项目有 FTS5 外部内容表（posts_fts），默认的 'd1' 格式不会导出虚拟表，
//      导入后全文搜索会直接失效（表不存在）。
//   2. 导出是异步的：output_format='polling' 后要带着 at_bookmark 反复请求，
//      不轮询会被自动取消。
//   3. R2 对象 key 里的 `/` 必须原样发送，不能 percent-encode（官方明确要求）。
//   4. 导入后必须 rebuild FTS 索引，否则 trigram 索引与真实数据对不上。
//
// 安全约定：token 只在内存里存在，不写日志、不落盘、不入库。

import { mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const API = 'https://api.cloudflare.com/client/v4';
const ROOT = resolve(import.meta.dirname, '..');

/** Cloudflare API 出错时抛出，带上 HTTP 状态与官方错误码 */
export class CloudflareError extends Error {
  constructor(message, { status, code, errors } = {}) {
    super(message);
    this.name = 'CloudflareError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

/**
 * 控制台进度输出（导入过程较长，必须能看到进展）
 * @param {string} msg
 */
function log(msg) {
  console.log(`  ${msg}`);
}

/**
 * 统一的 Cloudflare API 请求。
 *
 * @param {string} token
 * @param {string} path 以 / 开头的 API 路径
 * @param {{ method?: string, body?: unknown, expectBinary?: boolean, rawUrl?: string }} [opts]
 */
async function cfFetch(token, path, opts = {}) {
  const url = opts.rawUrl ?? `${API}${path}`;
  const init = {
    method: opts.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}` },
  };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, init);

  // 下载对象是二进制流，不走 JSON 解析
  if (opts.expectBinary) {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new CloudflareError(`下载失败 HTTP ${res.status}：${text.slice(0, 200)}`, {
        status: res.status,
      });
    }
    return res;
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new CloudflareError(`响应不是合法 JSON（HTTP ${res.status}）`, { status: res.status });
  }

  if (!res.ok || payload.success === false) {
    const first = payload.errors?.[0];
    throw new CloudflareError(first?.message ?? `请求失败 HTTP ${res.status}`, {
      status: res.status,
      code: first?.code,
      errors: payload.errors,
    });
  }
  return payload.result;
}

/**
 * 校验 token 是否有效，返回 token 元信息。
 * @param {string} token
 */
export async function verifyToken(token) {
  const result = await cfFetch(token, '/user/tokens/verify');
  return result;
}

/**
 * 列出账号下所有 D1 数据库。
 * @param {string} token
 * @param {string} accountId
 */
export async function listDatabases(token, accountId) {
  const result = await cfFetch(token, `/accounts/${accountId}/d1/database?per_page=100`);
  return Array.isArray(result) ? result : [];
}

/**
 * 列出账号下所有 R2 桶。
 * @param {string} token
 * @param {string} accountId
 */
export async function listBuckets(token, accountId) {
  const result = await cfFetch(token, `/accounts/${accountId}/r2/buckets?per_page=100`);
  // 该接口的 result 结构在不同版本间有差异：可能是数组，也可能包在 buckets 里
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.buckets) ? result.buckets : [];
}

/**
 * 触发 D1 导出并轮询到完成，返回下载 URL。
 *
 * @param {string} token
 * @param {string} accountId
 * @param {string} databaseId
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 * @returns {Promise<{ url: string, filename: string }>}
 */
export async function exportDatabase(token, accountId, databaseId, opts = {}) {
  const base = `/accounts/${accountId}/d1/database/${databaseId}/export`;

  let resp = await cfFetch(token, base, {
    method: 'POST',
    body: {
      output_format: 'polling',
      dump_options: {
        // 关键：只有这个格式会带上 FTS5 等虚拟表，默认 'd1' 会漏
        compatibility: 'sqlite3_cli_only',
      },
    },
  });

  const deadline = Date.now() + 10 * 60 * 1000; // 10 分钟上限
  let polls = 0;

  while (resp?.status !== 'complete') {
    if (resp?.status === 'error') {
      throw new CloudflareError(`导出失败：${resp.error ?? '未知错误'}`);
    }
    if (Date.now() > deadline) {
      throw new CloudflareError('导出超时（10 分钟）；大库请改用 wrangler d1 export 手动导入');
    }

    // 必须持续轮询，否则 Cloudflare 会自动取消
    await new Promise((r) => setTimeout(r, 2000));
    polls += 1;
    resp = await cfFetch(token, base, {
      method: 'POST',
      body: { output_format: 'polling', current_bookmark: resp?.at_bookmark },
    });
    opts.onProgress?.(`导出台 ${polls}：${resp?.status ?? 'pending'}`);
  }

  const signedUrl = resp?.result?.signed_url;
  if (!signedUrl) throw new CloudflareError('导出完成但没有返回下载地址');

  return { url: signedUrl, filename: resp.result.filename ?? 'export.sql' };
}

/**
 * 下载导出的 SQL 文本。
 * @param {string} token
 * @param {string} url 带签名的地址（仍是 Bearer 鉴权）
 */
export async function downloadExport(token, url) {
  const res = await cfFetch(token, '', { rawUrl: url, expectBinary: true });
  return res.text();
}

/**
 * 分页列出 R2 桶内全部对象。
 *
 * @param {string} token
 * @param {string} accountId
 * @param {string} bucket
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 */
export async function listAllObjects(token, accountId, bucket, opts = {}) {
  const all = [];
  let cursor;
  for (;;) {
    const qs = new URLSearchParams({ per_page: '1000' });
    if (cursor) qs.set('cursor', cursor);
    const res = await cfFetch(token, `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects?${qs}`);
    // 同样兼容两种返回形状
    const page = Array.isArray(res) ? res : (res?.objects ?? []);
    all.push(...page);
    opts.onProgress?.(`已列 ${all.length} 个对象`);
    const info = res?.result_info ?? res;
    if (!info?.is_truncated) break;
    cursor = info.cursor;
    if (!cursor) break;
  }
  return all;
}

/**
 * 下载单个 R2 对象。
 * key 中的 `/` 必须原样保留（官方要求），其余字符逐段编码。
 *
 * @param {string} token
 * @param {string} accountId
 * @param {string} bucket
 * @param {string} key
 */
export async function getObject(token, accountId, bucket, key) {
  const encodedKey = key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const res = await cfFetch(
    token,
    `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects/${encodedKey}`,
    { expectBinary: true },
  );
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  return { buf, contentType };
}

/**
 * 检查本地数据库是否适合导入。
 * 返回已有的业务表名（空数组表示是干净库）。
 *
 * @param {string} dbPath
 */
export function inspectLocalDatabase(dbPath) {
  if (!existsSync(dbPath)) return { tables: [], isNew: true };
  const sqlite = new DatabaseSync(dbPath);
  try {
    const rows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    return { tables: rows.map((r) => r.name), isNew: false };
  } finally {
    sqlite.close();
  }
}

/**
 * 备份本地数据库（使用 VACUUM INTO，得到一致性快照）。
 *
 * @param {string} dbPath
 * @returns {string} 备份文件路径
 */
export function backupDatabase(dbPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${dbPath}.backup-${stamp}`;
  const sqlite = new DatabaseSync(dbPath);
  try {
    sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    sqlite.close();
  }
  return target;
}

/**
 * 把导出的 SQL 应用到本地数据库。
 *
 * 注意：不自己包事务。sqlite3 CLI 的 dump 里已带 BEGIN/COMMIT，
 * 再套一层会报 "cannot start a transaction within a transaction"。
 *
 * @param {string} dbPath
 * @param {string} sqlText
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 */
export function applyDump(dbPath, sqlText, opts = {}) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new DatabaseSync(dbPath);
  try {
    sqlite.exec('PRAGMA journal_mode = WAL');

    // sqlite3 的 dump 会写 PRAGMA foreign_keys=OFF，但 node:sqlite 不接受
    // 在事务中切换该 PRAGMA；先关掉再执行，导入完再打开。
    sqlite.exec('PRAGMA foreign_keys = OFF');

    opts.onProgress?.(`执行 SQL（${(sqlText.length / 1024 / 1024).toFixed(1)} MB）`);
    sqlite.exec(sqlText);

    sqlite.exec('PRAGMA foreign_keys = ON');

    // ---- 重建 FTS 索引 ----
    // 导出的数据可能只含表定义、或索引与数据不一致（trigram 索引对内容敏感），
    // 统一 rebuild 一次，成本低且能保证搜索可用。
    try {
      const hasFts = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='posts_fts'").get();
      if (hasFts) {
        sqlite.exec("INSERT INTO posts_fts(posts_fts) VALUES('rebuild')");
        opts.onProgress?.('已重建全文索引（posts_fts）');
      }
    } catch (err) {
      // 索引重建失败不阻断导入：数据已经进去了，可以事后手工修
      opts.onProgress?.(`全文索引重建失败（可稍后手工处理）：${err.message}`);
    }

    // ---- 对齐迁移记录 ----
    // 若 dump 没带 d1_migrations（例如只导业务表），补齐表结构；
    // 具体补登哪些迁移由 markMigrationsApplied 完成。
    // 不这么做的话，下次启动 runMigrations 会对着已有表重复执行
    // CREATE TABLE 而失败，服务直接起不来。
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS d1_migrations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT UNIQUE NOT NULL,
        applied_at TEXT DEFAULT (datetime('now'))
      );
    `);
    const applied = new Set(
      sqlite
        .prepare('SELECT name FROM d1_migrations')
        .all()
        .map((r) => r.name),
    );
    return { appliedCount: applied.size };
  } finally {
    sqlite.close();
  }
}

/**
 * 把迁移目录里已存在的迁移补登到 d1_migrations（仅补缺失项）。
 *
 * @param {string} dbPath
 * @param {string[]} migrationNames
 */
export function markMigrationsApplied(dbPath, migrationNames) {
  const sqlite = new DatabaseSync(dbPath);
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS d1_migrations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT UNIQUE NOT NULL,
        applied_at TEXT DEFAULT (datetime('now'))
      );
    `);
    const applied = new Set(
      sqlite
        .prepare('SELECT name FROM d1_migrations')
        .all()
        .map((r) => r.name),
    );
    const stmt = sqlite.prepare('INSERT INTO d1_migrations (name) VALUES (?)');
    let added = 0;
    for (const name of migrationNames) {
      if (applied.has(name)) continue;
      stmt.run(name);
      added += 1;
    }
    return added;
  } finally {
    sqlite.close();
  }
}

/**
 * 把 R2 对象写入本地 blob 目录（结构与 NodeR2Bucket 一致）。
 *
 * @param {string} blobDir
 * @param {Array<{key: string, http_metadata?: {contentType?: string}}>} objects
 * @param {(key: string) => Promise<{buf: Buffer, contentType: string}>} fetcher
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 */
export async function downloadObjects(blobDir, objects, fetcher, opts = {}) {
  const root = resolve(blobDir);
  const metaRoot = join(root, '.meta');
  let done = 0;
  let bytes = 0;

  for (const obj of objects) {
    const key = String(obj.key ?? '');
    if (!key) continue;

    // 防穿越：与 server/r2.mjs 的 resolveKey 同一套规则
    const normalized = key.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) continue;
    if (normalized.startsWith('.meta/') || normalized === '.meta') continue;
    const abs = resolve(root, normalized);
    const rootWithSep = root.endsWith('/') ? root : root + '/';
    if (!abs.startsWith(rootWithSep)) continue;

    const { buf, contentType } = await fetcher(key);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buf);

    // 元信息与 NodeR2Bucket 保持同一格式，取回时才不会丢失 Content-Type
    const metaPath = join(metaRoot, normalized + '.json');
    mkdirSync(dirname(metaPath), { recursive: true });
    writeFileSync(
      metaPath,
      JSON.stringify({
        contentType: obj.http_metadata?.contentType ?? contentType,
        cacheControl: obj.http_metadata?.cacheControl ?? null,
        customMetadata: obj.custom_metadata ?? null,
        uploaded: obj.last_modified ?? new Date().toISOString(),
      }),
      'utf8',
    );

    done += 1;
    bytes += buf.byteLength;
    if (done % 20 === 0 || done === objects.length) {
      opts.onProgress?.(`已下载 ${done}/${objects.length}（${(bytes / 1024 / 1024).toFixed(1)} MB）`);
    }
  }
  return { count: done, bytes };
}

/**
 * 列出迁移目录里的文件名（供补登使用）。
 * @returns {string[]}
 */
export function listMigrationNames() {
  const dir = join(ROOT, 'db', 'migrations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

// ============================================================================
// CLI
// ============================================================================

/**
 * 解析 --key=value 形式的参数
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) out[arg.slice(2)] = true;
    else out[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return out;
}

if (import.meta.filename === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`
Cloudflare 数据导入

用法：
  node server/cf-import.mjs --token=<API_TOKEN> --account=<ACCOUNT_ID> [选项]

必填：
  --token=<token>      Cloudflare API Token（需 D1:Read + R2:Read）
  --account=<id>       Account ID（仪表盘 URL 里那串 32 位 hex）

可选：
  --database=<name|uuid>  指定 D1 库；默认自动找名为 blog-db 的库
  --bucket=<name>     指定 R2 桶；默认自动找 blog-images
  --db-path=<path>    目标 SQLite 文件；默认 $BLOG_DB_PATH 或 ./data/blog.db
  --blob-dir=<path>   目标文件目录；默认 $BLOG_BLOB_DIR 或 ./data/blobs
  --skip-db           不导入数据库
  --skip-blobs        不导入文件
  --force             目标库已有数据时先备份再覆盖
  --dry-run           只列出可导入的资源，不实际下载
  --help              显示本帮助

也可以改用环境变量：CF_API_TOKEN / CF_ACCOUNT_ID
`);
    process.exit(0);
  }

  const token = String(args.token ?? process.env.CF_API_TOKEN ?? '');
  const accountId = String(args.account ?? process.env.CF_ACCOUNT_ID ?? '');

  if (!token || !accountId) {
    console.error('缺少 --token 或 --account（详见 --help）');
    process.exit(1);
  }

  try {
    console.log('\n=== 1/5 校验 token ===');
    const info = await verifyToken(token);
    log(`token 状态：${info.status}`);
    if (info.expires_on) log(`过期时间：${info.expires_on}`);

    console.log('\n=== 2/5 定位资源 ===');
    const databases = await listDatabases(token, accountId);
    log(`账号下 D1 库：${databases.length} 个`);
    for (const db of databases) log(`  - ${db.name} (${db.uuid})`);

    const wantDb = args.database ? String(args.database) : 'blog-db';
    const targetDb = databases.find((d) => d.uuid === wantDb) ?? databases.find((d) => d.name === wantDb);
    if (!targetDb && !args['skip-db']) {
      throw new CloudflareError(`找不到数据库 "${wantDb}"；可用 --database=<name|uuid> 指定，或用 --skip-db 跳过`);
    }

    const buckets = args['skip-blobs'] ? [] : await listBuckets(token, accountId);
    if (!args['skip-blobs']) {
      log(`账号下 R2 桶：${buckets.length} 个`);
      for (const b of buckets) log(`  - ${b.name}`);
    }

    const wantBucket = args.bucket ? String(args.bucket) : 'blog-images';
    const targetBucket = buckets.find((b) => b.name === wantBucket) ?? buckets[0];
    if (!targetBucket && !args['skip-blobs']) {
      log(`未找到 R2 桶 "${wantBucket}"，将只导入数据库`);
    }

    if (args['dry-run']) {
      console.log('\n[dry-run] 资源确认完毕，未做任何改动');
      if (targetDb) log(`将导入数据库：${targetDb.name}`);
      if (targetBucket) log(`将导入文件桶：${targetBucket.name}`);
      process.exit(0);
    }

    const dbPath = resolve(String(args['db-path'] ?? process.env.BLOG_DB_PATH ?? join(ROOT, 'data', 'blog.db')));
    const blobDir = resolve(String(args['blob-dir'] ?? process.env.BLOG_BLOB_DIR ?? join(ROOT, 'data', 'blobs')));

    // ---- 目标库安全检查 ----
    if (targetDb) {
      const state = inspectLocalDatabase(dbPath);
      if (!state.isNew && state.tables.length > 0) {
        if (!args.force) {
          console.error(
            `\n目标库已存在且含 ${state.tables.length} 张表：${dbPath}\n` +
              `为避免覆盖已有数据已中止。确认要覆盖请加 --force（会自动备份）。`,
          );
          process.exit(1);
        }
        const backup = backupDatabase(dbPath);
        log(`已备份原库到：${backup}`);
      }
    }

    // ---- 导入数据库 ----
    if (targetDb) {
      console.log(`\n=== 3/5 导出 D1：${targetDb.name} ===`);
      const { url, filename } = await exportDatabase(token, accountId, targetDb.uuid, {
        onProgress: log,
      });
      log(`导出完成：${filename}`);

      const sql = await downloadExport(token, url);
      log(`下载完成：${(sql.length / 1024 / 1024).toFixed(2)} MB`);

      // 覆盖导入前把目标库清空（--force 时），避免 CREATE TABLE 冲突
      if (args.force && existsSync(dbPath)) {
        const sqlite = new DatabaseSync(dbPath);
        try {
          const tables = sqlite
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .all();
          sqlite.exec('PRAGMA foreign_keys = OFF');
          for (const t of tables) {
            sqlite.exec(`DROP TABLE IF EXISTS "${String(t.name).replace(/"/g, '""')}"`);
          }
          sqlite.exec('PRAGMA foreign_keys = ON');
          const views = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='view'").all();
          for (const v of views) {
            sqlite.exec(`DROP VIEW IF EXISTS "${String(v.name).replace(/"/g, '""')}"`);
          }
        } finally {
          sqlite.close();
        }
        log('已清空目标库的旧表');
      }

      applyDump(dbPath, sql, { onProgress: log });
      log(`数据库导入完成：${dbPath}`);

      // 补登迁移记录，防止下次启动重复建表
      const names = listMigrationNames();
      const added = markMigrationsApplied(dbPath, names);
      log(`迁移记录已对齐（新增 ${added} 条，共 ${names.length} 个迁移文件）`);
    }

    // ---- 导入文件 ----
    if (targetBucket && !args['skip-blobs']) {
      console.log(`\n=== 4/5 列出 R2 对象：${targetBucket.name} ===`);
      const objects = await listAllObjects(token, accountId, targetBucket.name, {
        onProgress: log,
      });
      log(
        `共 ${objects.length} 个对象，总大小 ${(objects.reduce((s, o) => s + (o.size ?? 0), 0) / 1024 / 1024).toFixed(
          1,
        )} MB`,
      );

      console.log(`\n=== 5/5 下载到 ${blobDir} ===`);
      const result = await downloadObjects(
        blobDir,
        objects,
        (key) => getObject(token, accountId, targetBucket.name, key),
        { onProgress: log },
      );
      log(`文件导入完成：${result.count} 个，${(result.bytes / 1024 / 1024).toFixed(1)} MB`);
    } else {
      console.log('\n=== 4/5 跳过文件导入 ===');
    }

    console.log('\n✓ 全部完成');
    console.log(`  数据库：${targetDb ? dbPath : '（已跳过）'}`);
    console.log(`  文件：  ${targetBucket ? blobDir : '（已跳过）'}`);
    console.log('\n下一步：node server/index.mjs 启动服务，用原账号密码登录后台。');
  } catch (err) {
    console.error('\n导入失败：', err.message);
    if (err.errors?.length) {
      for (const e of err.errors) console.error(`  - [${e.code}] ${e.message}`);
    }
    process.exit(1);
  }
}

export { parseArgs };
