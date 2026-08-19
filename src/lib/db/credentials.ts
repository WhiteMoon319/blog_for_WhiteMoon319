import type { D1Database } from '@cloudflare/workers-types';

// 哈希格式: v=1,alg=pbkdf2-sha512,iter=100000,salt=<base64url>,hash=<base64url>
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const HASH_ALGORITHM = 'SHA-512';
const DERIVED_KEY_LENGTH = 64; // SHA-512 output bytes

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

function parseHash(formatted: string): {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
} | null {
  const parts = formatted.split(',');
  if (parts.length !== 5) return null;
  const vPart = parts[0]!;
  const algPart = parts[1]!;
  const iterPart = parts[2]!;
  const saltPart = parts[3]!;
  const hashPart = parts[4]!;
  if (vPart !== 'v=1' || algPart !== 'alg=pbkdf2-sha512') return null;
  const iterMatch = /^iter=(\d+)$/.exec(iterPart);
  if (!iterMatch) return null;
  const iterations = parseInt(iterMatch[1]!, 10);
  if (!Number.isFinite(iterations) || iterations < 1) return null;
  const saltMatch = /^salt=(.+)$/.exec(saltPart);
  const hashMatch = /^hash=(.+)$/.exec(hashPart);
  if (!saltMatch || !hashMatch) return null;
  try {
    const salt = fromB64url(saltMatch[1]!);
    const hash = fromB64url(hashMatch[1]!);
    if (salt.length < 8 || hash.length < 16) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: HASH_ALGORITHM, salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS },
    key,
    DERIVED_KEY_LENGTH * 8,
  );
  const hashBytes = new Uint8Array(bits);
  return `v=1,alg=pbkdf2-sha512,iter=${PBKDF2_ITERATIONS},salt=${b64url(salt)},hash=${b64url(hashBytes)}`;
}

export async function verifyPasswordHash(password: string, storedHash: string): Promise<boolean> {
  const parsed = parseHash(storedHash);
  if (!parsed) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: HASH_ALGORITHM, salt: parsed.salt as BufferSource, iterations: parsed.iterations },
    key,
    DERIVED_KEY_LENGTH * 8,
  );
  const hashBytes = new Uint8Array(bits);
  return constantTimeEqual(b64url(hashBytes), b64url(parsed.hash));
}

export interface CredentialRow {
  password_hash: string;
  session_version: number;
}

export async function getCredentials(db: D1Database): Promise<CredentialRow | null> {
  if (_credentialsOverride) return _credentialsOverride(db);
  return db.prepare('SELECT password_hash, session_version FROM admin_credentials WHERE id = 1').first<CredentialRow>();
}

export async function getSessionVersion(db: D1Database): Promise<number> {
  if (_versionOverride) return _versionOverride(db);
  const row = await getCredentials(db);
  return row?.session_version ?? 1;
}

export async function setCredentials(db: D1Database, passwordHash: string, sessionVersion: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_credentials (id, password_hash, session_version, updated_at)
       VALUES (1, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, session_version = excluded.session_version, updated_at = excluded.updated_at`,
    )
    .bind(passwordHash, sessionVersion)
    .run();
}

export async function incrementSessionVersion(db: D1Database): Promise<number> {
  await db
    .prepare(`UPDATE admin_credentials SET session_version = session_version + 1, updated_at = datetime('now') WHERE id = 1`)
    .run();
  const row = await getCredentials(db);
  return row?.session_version ?? 2;
}

// 用于单元测试：替换 getCredentials / getSessionVersion 的实现，避免依赖真实 D1
let _credentialsOverride: ((db: D1Database) => Promise<CredentialRow | null>) | null = null;
let _versionOverride: ((db: D1Database) => Promise<number>) | null = null;

export function __setCredentialsOverride(fn: (db: D1Database) => Promise<CredentialRow | null>): void {
  _credentialsOverride = fn;
}
export function __setVersionOverride(fn: (db: D1Database) => Promise<number>): void {
  _versionOverride = fn;
}