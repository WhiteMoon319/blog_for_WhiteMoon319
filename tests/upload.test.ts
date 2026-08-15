import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectImageType, isInlineSafeType, EXT_BY_TYPE } from '../src/lib/upload.ts';

function bytes(hexes: number[]): Uint8Array {
  return new Uint8Array(hexes);
}

test('上传白名单：魔数匹配的合法类型通过', () => {
  assert.equal(detectImageType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), 'image/png');
  assert.equal(detectImageType(bytes([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), 'image/jpeg');
  assert.equal(detectImageType(bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 'image/gif'), 'image/gif');
  assert.equal(detectImageType(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 'image/webp'), 'image/webp');
  assert.equal(detectImageType(bytes([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]), 'image/avif'), 'image/avif');
});

test('上传白名单：内容与声明不符被拒绝', () => {
  assert.equal(detectImageType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/jpeg'), null);
  assert.equal(detectImageType(bytes([0xff, 0xd8, 0xff, 0xe0]), 'image/png'), null);
});

test('上传白名单：svg 与未知类型一律拒绝', () => {
  assert.equal(detectImageType(bytes([0x3c, 0x73, 0x76, 0x67]), 'image/svg+xml'), null);
  assert.equal(detectImageType(bytes([1, 2, 3, 4]), 'application/octet-stream'), null);
  assert.equal(detectImageType(bytes([0x4d, 0x5a]), ''), null);
  assert.equal(detectImageType(bytes([0x50, 0x4b, 0x03, 0x04]), 'image/png'), null);
});

test('上传白名单：扩展名由实际检测类型决定', () => {
  assert.equal(EXT_BY_TYPE['image/png'], '.png');
  assert.equal(EXT_BY_TYPE['image/jpeg'], '.jpg');
});

test('isInlineSafeType：仅白名单图片可内联', () => {
  assert.equal(isInlineSafeType('image/png'), true);
  assert.equal(isInlineSafeType('image/svg+xml'), false);
  assert.equal(isInlineSafeType('application/pdf'), false);
});