// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const EXT_BY_TYPE: Record<AllowedImageType, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const AVIF_BRANDS = ['avif', 'avis', 'mif1'];

function hasMagic(buf: Uint8Array, offset: number, magic: number[]): boolean {
  if (buf.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[offset + i] !== magic[i]) return false;
  }
  return true;
}

function ascii(buf: Uint8Array, offset: number, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += String.fromCharCode(buf[offset + i] ?? 0);
  return out;
}

export function detectImageType(buf: Uint8Array, declared: string): AllowedImageType | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(declared)) return null;

  switch (declared) {
    case 'image/png':
      return hasMagic(buf, 0, PNG) ? 'image/png' : null;
    case 'image/jpeg':
      return hasMagic(buf, 0, JPEG) ? 'image/jpeg' : null;
    case 'image/gif':
      return hasMagic(buf, 0, GIF87) || hasMagic(buf, 0, GIF89) ? 'image/gif' : null;
    case 'image/webp':
      return ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP' ? 'image/webp' : null;
    case 'image/avif':
      return ascii(buf, 4, 4) === 'ftyp' && AVIF_BRANDS.includes(ascii(buf, 8, 4))
        ? 'image/avif'
        : null;
    default:
      return null;
  }
}

export function isInlineSafeType(contentType: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType);
}