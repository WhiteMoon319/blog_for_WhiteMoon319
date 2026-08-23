// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

const encoder = new TextEncoder();

const ALGO = 'AES-GCM';
const IV_LEN = 12;
const TAG_LEN = 128;
const KEY_V = 1;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

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

async function importKey(hexKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', hexToBytes(hexKey) as any, { name: ALGO, length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptApiKey(hexKey: string, plaintext: string): Promise<string> {
  const key = await importKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const aad = encoder.encode('ai_api_key:v1');
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGO, iv: iv as any, additionalData: aad as any, tagLength: TAG_LEN } as any,
    key,
    encoder.encode(plaintext) as any,
  );
  const combined = new Uint8Array(encrypted);
  const tag = combined.slice(combined.length - 16);
  const ct = combined.slice(0, combined.length - 16);
  return `v=${KEY_V}:${b64url(iv)}:${b64url(ct)}.${b64url(tag)}`;
}

export async function decryptApiKey(hexKey: string, encoded: string): Promise<string> {
  const m = encoded.match(/^v=(\d+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('invalid encrypted payload format');
  const v = Number(m[1]);
  const iv = fromB64url(m[2]);
  const [ctB64, tagB64] = m[3].split('.');
  const ct = fromB64url(ctB64);
  const tag = fromB64url(tagB64);
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct);
  combined.set(tag, ct.length);
  const key = await importKey(hexKey);
  const aad = encoder.encode(v === 1 ? 'ai_api_key:v1' : 'ai_api_key:v' + v);
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGO, iv: iv as any, additionalData: aad as any, tagLength: TAG_LEN } as any,
    key,
    combined as any,
  );
  return new TextDecoder().decode(decrypted);
}

export function maskApiKey(plaintext: string): string {
  if (!plaintext || plaintext.length < 8) return '••••••••';
  const prefix = plaintext.slice(0, 3);
  const suffix = plaintext.slice(-4);
  return `${prefix}••••••••${suffix}`;
}