// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// Cloudflare 导入器的单元测试
// ============================================================================
//
// 不联网：只测纯本地逻辑（SQL 应用、迁移补登、对象落盘、参数解析）。
// 联网部分（API 调用）靠形状约定 + 真实迁移验证，不在此处 mock HTTP。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  applyDump,
  downloadObjects,
  inspectLocalDatabase,
  listMigrationNames,
  markMigrationsApplied,
  parseArgs,
} from '../server/cf-import.mjs';
import { runMigrations } from '../server/migrate.mjs';

/** 迁移目录 */
const MIG_DIR = join(process.cwd(), 'db', 'migrations');

/**
 * 取单行里的整数值。
 * node:sqlite 的 get() 返回 Record<string, SQLOutputValue> | undefined，
 * 直接 .c 会触发 TS2532/18047，这里统一收口成 number。
 *
 * @param db 已打开的连接
 * @param sql 查询（需返回单列 c）
 */
function scalar(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { c?: number | bigint } | undefined;
  return Number(row?.c ?? 0);
}

/** 判断某个对象（表/触发器）是否存在 */
function objectExists(db: DatabaseSync, type: string, name: string): boolean {
  const row = db.prepare('SELECT 1 AS ok FROM sqlite_master WHERE type = ? AND name = ?').get(type, name);
  return row !== undefined && row !== null;
}

/** 读全部迁移 SQL，拼成一个可执行脚本（含事务，模拟 sqlite3 .dump） */
function buildDumpWithData() {
  const parts = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
  for (const f of readdirSync(MIG_DIR)
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    parts.push(readFileSync(join(MIG_DIR, f), 'utf8'));
  }
  parts.push(
    `INSERT INTO posts (title, slug, summary, content_md, status) VALUES ('标题甲','slug-a','摘要甲','正文甲乙丙','published');`,
  );
  parts.push(
    `INSERT INTO posts (title, slug, summary, content_md, status) VALUES ('标题乙','slug-b','摘要乙','正文丁戊己','published');`,
  );
  parts.push('COMMIT;');
  return parts.join('\n');
}

test('cf-import：parseArgs 解析 --k=v 与裸开关', () => {
  const a = parseArgs(['--token=abc', '--force', '--db-path=/tmp/x.db', 'ignore-me']);
  assert.equal(a.token, 'abc');
  assert.equal(a.force, true);
  assert.equal(a['db-path'], '/tmp/x.db');
  assert.equal(a['ignore-me'], undefined);
});

test('cf-import：inspectLocalDatabase 识别空库与已有库', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-inspect-'));
  try {
    const missing = join(dir, 'none.db');
    assert.deepEqual(inspectLocalDatabase(missing), { tables: [], isNew: true });

    const dbPath = join(dir, 'has.db');
    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec('CREATE TABLE foo (id INTEGER PRIMARY KEY)');
    sqlite.close();

    const state = inspectLocalDatabase(dbPath);
    assert.equal(state.isNew, false);
    assert.deepEqual(state.tables, ['foo']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cf-import：applyDump 能吃下带 FTS5 虚拟表与触发器的 dump', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-dump-'));
  const dbPath = join(dir, 'blog.db');
  try {
    const result = applyDump(dbPath, buildDumpWithData());
    assert.ok(existsSync(dbPath), '数据库文件应被创建');

    const sqlite = new DatabaseSync(dbPath);
    try {
      // 数据完整
      const count = scalar(sqlite, 'SELECT count(*) AS c FROM posts');
      assert.equal(count, 2, '两篇文章都应导入');

      // FTS5 虚拟表存在（sqlite3_cli_only 格式才带，d1 格式会漏）
      const fts = objectExists(sqlite, 'table', 'posts_fts');
      assert.ok(fts, 'posts_fts 虚拟表必须存在，否则全文搜索失效');

      // 触发器保留
      const triggers = scalar(sqlite, "SELECT count(*) AS c FROM sqlite_master WHERE type='trigger'");
      assert.ok(triggers >= 3, 'FTS 同步触发器应保留');

      // 全文搜索可用。
      // 注意：tokenize='trigram' 要求查询串 >= 3 字符，2 字符查不到属分词器特性。
      const hit = scalar(sqlite, "SELECT count(*) AS c FROM posts_fts WHERE posts_fts MATCH '甲乙丙'");
      assert.equal(hit, 1, '导入后应能全文检索（trigram 需 >=3 字符）');

      // d1_migrations 表被补上
      const mig = objectExists(sqlite, 'table', 'd1_migrations');
      assert.ok(mig, 'd1_migrations 应被自动创建');
    } finally {
      sqlite.close();
    }
    assert.ok(result.appliedCount >= 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cf-import：补登迁移后重启不会重复建表', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-mig-'));
  const dbPath = join(dir, 'blog.db');
  try {
    applyDump(dbPath, buildDumpWithData());

    const names = listMigrationNames();
    assert.ok(names.length > 0, '迁移目录里应有迁移文件');

    // 刚导入时 d1_migrations 是空的（dump 不含该表数据）
    const added = markMigrationsApplied(dbPath, names);
    assert.equal(added, names.length, '应把所有迁移登记为已应用');

    // 模拟服务启动：runMigrations 不应再执行任何迁移
    const sqlite = new DatabaseSync(dbPath);
    try {
      const res = runMigrations(sqlite);
      assert.equal(res.applied.length, 0, '不应重复执行迁移（否则会 CREATE TABLE 冲突）');
      assert.equal(res.skipped, names.length);
    } finally {
      sqlite.close();
    }

    // 幂等：再补一次不应重复插入
    assert.equal(markMigrationsApplied(dbPath, names), 0, '补登应幂等');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cf-import：downloadObjects 落盘结构与 NodeR2Bucket 一致', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-blob-'));
  const blobDir = join(dir, 'blobs');
  try {
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const objects = [
      { key: 'uploads/2026/11/a.png', size: 4, http_metadata: { contentType: 'image/png' } },
      { key: 'fonts/x.woff2', size: 4 },
      // 以下都应被跳过
      { key: '../escape.png' },
      { key: '/abs.png' },
      { key: '.meta/evil.json' },
    ];

    const result = await downloadObjects(blobDir, objects, async () => ({
      buf: payload,
      contentType: 'application/octet-stream',
    }));

    assert.equal(result.count, 2, '只应下载合法 key，穿越路径全部跳过');

    // 数据文件
    assert.ok(existsSync(join(blobDir, 'uploads/2026/11/a.png')));
    assert.ok(existsSync(join(blobDir, 'fonts/x.woff2')));

    // 元信息放在 .meta 下，且保留 http_metadata.contentType
    const metaPath = join(blobDir, '.meta/uploads/2026/11/a.png.json');
    assert.ok(existsSync(metaPath), '元信息应写在 .meta/ 下');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    assert.equal(meta.contentType, 'image/png', '应沿用 R2 的 contentType');

    // 无 http_metadata 时退化为下载响应头
    const meta2 = JSON.parse(readFileSync(join(blobDir, '.meta/fonts/x.woff2.json'), 'utf8'));
    assert.equal(meta2.contentType, 'application/octet-stream');

    // 穿越路径不应在目录外产生文件
    assert.ok(!existsSync(join(dir, 'escape.png')), '不得写到根目录之外');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cf-import：applyDump 到已有数据的库时会正确重建 FTS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-rebuild-'));
  const dbPath = join(dir, 'blog.db');
  try {
    // 先建一个干净库并插入数据
    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec(readFileSync(join(MIG_DIR, '0001_init.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(MIG_DIR, '0009_fts_search.sql'), 'utf8'));
    sqlite.exec(
      `INSERT INTO posts (title, slug, content_md, status) VALUES ('重建标题','rebuild','搜索目标文本','published')`,
    );
    // 故意破坏索引：清空 fts 内容表
    sqlite.exec("INSERT INTO posts_fts(posts_fts) VALUES('delete-all')");
    const before = scalar(sqlite, "SELECT count(*) AS c FROM posts_fts WHERE posts_fts MATCH '搜索目标'");
    assert.equal(before, 0, '清空后应搜不到');
    sqlite.close();

    // 用只含 rebuild 指令的 dump 走一遍 applyDump（模拟重新导入后的索引修复）
    writeFileSync(join(dir, 'noop.sql'), `PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nCOMMIT;\n`, 'utf8');
    applyDump(dbPath, readFileSync(join(dir, 'noop.sql'), 'utf8'));

    const out = new DatabaseSync(dbPath);
    try {
      const after = scalar(out, "SELECT count(*) AS c FROM posts_fts WHERE posts_fts MATCH '搜索目标'");
      assert.equal(after, 1, 'applyDump 应重建 FTS，恢复检索能力');
    } finally {
      out.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
