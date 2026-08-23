// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// 按语句拆分迁移 SQL：触发器（BEGIN…END）体内含分号，需跟踪 BEGIN/END 深度与字符串引号状态，
// 不能简单按 ; 切分。e2e 引导与单测建库共用，保证同一份 SQL 两种解析结果一致。
export function readStatements(file: string): string[] {
  const src = readFileSync(resolve(file), 'utf8');
  const statements: string[] = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'") {
      if (inStr && src[i + 1] === "'") {
        cur += "''";
        i++;
        continue;
      }
      inStr = !inStr;
      cur += ch;
      continue;
    }
    if (ch === ';' && !inStr) {
      // 触发器 BEGIN…END 体内含分号，未闭合前不切分
      const begins = (cur.match(/\bBEGIN\b/gi) ?? []).length;
      const ends = (cur.match(/\bEND\b/gi) ?? []).length;
      if (begins > ends) {
        cur += ch;
        continue;
      }
      const s = cur
        .split('\n')
        .filter((l) => !/^\s*--/.test(l))
        .join('\n')
        .trim();
      if (s.length > 0) statements.push(s);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const tail = cur
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n')
    .trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

export function migrationStatements(): string[] {
  return readdirSync(resolve('db/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .flatMap((file) => readStatements(`db/migrations/${file}`));
}
