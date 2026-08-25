// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { D1Database } from '@cloudflare/workers-types';
import { verifyPasswordHash } from './credentials.ts';

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  email: string;
  email_verified: number;
  password_hash: string;
  role: 'reader' | 'author' | 'admin';
  website_url: string;
  avatar_url: string;
  status: 'active' | 'banned';
  session_version: number;
  notify_email: number;
  created_at: string;
}

export async function getUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function getUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE username = ?').bind(username.trim().toLowerCase()).first<UserRow>();
}

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email.trim().toLowerCase()).first<UserRow>();
}

export async function createUser(
  db: D1Database,
  data: { username: string; email: string; password_hash: string; display_name?: string; role?: 'reader' | 'author' | 'admin' },
): Promise<UserRow | null> {
  const { username, email, password_hash, display_name, role } = data;
  const res = await db
    .prepare(
      `INSERT INTO users (username, display_name, email, password_hash, role)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      username.trim().toLowerCase(),
      (display_name ?? username).trim(),
      email.trim().toLowerCase(),
      password_hash,
      role ?? 'reader',
    )
    .first<UserRow>();
  return res ?? null;
}

export async function incrementUserSessionVersion(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare(`UPDATE users SET session_version = session_version + 1 WHERE id = ? RETURNING session_version`)
    .bind(userId)
    .first<{ session_version: number }>();
  return row?.session_version ?? 0;
}

export async function updatePassword(db: D1Database, userId: number, passwordHash: string): Promise<boolean> {
  const row = await db
    .prepare(`UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ? RETURNING id`)
    .bind(passwordHash, userId)
    .first<{ id: number }>();
  return !!row;
}

export async function verifyUserPassword(db: D1Database, userOrEmail: string, password: string): Promise<UserRow | null> {
  const user = await getUserByUsername(db, userOrEmail) ?? await getUserByEmail(db, userOrEmail);
  if (!user) return null;
  if (user.password_hash && user.password_hash.length > 0) {
    if (!verifyPasswordHash(password, user.password_hash)) return null;
  } else {
    // 空密码哈希：回退到 env BLOG_ADMIN_PASSWORD 明文比对（仅管理员迁移过渡）
    // 此分支在用户数据层通过调用方注入 env 处理
    return null;
  }
  return user;
}

export async function setUserEmailVerified(db: D1Database, userId: number): Promise<void> {
  await db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).bind(userId).run();
}

export async function banUser(db: D1Database, userId: number): Promise<boolean> {
  const row = await db
    .prepare(`UPDATE users SET status = CASE WHEN status = 'active' THEN 'banned' ELSE 'active' END, session_version = session_version + 1 WHERE id = ? AND role != 'admin' RETURNING id`)
    .bind(userId)
    .first<{ id: number }>();
  return !!row;
}

export async function updateProfile(db: D1Database, userId: number, data: { display_name?: string; avatar_url?: string; notify_email?: number }): Promise<boolean> {
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (data.display_name !== undefined) { sets.push('display_name = ?'); vals.push(data.display_name.trim()); }
  if (data.avatar_url !== undefined) { sets.push('avatar_url = ?'); vals.push(data.avatar_url); }
  if (data.notify_email !== undefined) { sets.push('notify_email = ?'); vals.push(data.notify_email); }
  if (sets.length === 0) return false;
  const row = await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? RETURNING id`).bind(...vals, userId).first<{ id: number }>();
  return !!row;
}

export async function updateEmail(db: D1Database, userId: number, email: string): Promise<boolean> {
  const row = await db.prepare(`UPDATE users SET email = ?, email_verified = 0 WHERE id = ? RETURNING id`).bind(email.trim().toLowerCase(), userId).first<{ id: number }>();
  return !!row;
}

export async function listUsers(db: D1Database, role?: string): Promise<UserRow[]> {
  let sql = 'SELECT * FROM users';
  const args: string[] = [];
  if (role) {
    sql += ' WHERE role = ?';
    args.push(role);
  }
  sql += ' ORDER BY created_at DESC';
  const rows = await db.prepare(sql).bind(...args).all<UserRow>();
  return rows.results ?? [];
}